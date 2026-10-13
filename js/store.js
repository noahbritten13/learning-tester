// This device's copy of the data: kept in memory, saved to IndexedDB so it
// survives closing the app, and synced with GitHub when online.

import { uid, nowISO, debounce, dayStart, utf8ToBase64 } from './util.js';
import {
  cleanCard, newCard, tombstone, mergeInto, toFiles, fromFiles, isManagedPath, toBackup, FORMAT,
  themeTree, themeAndChildren, themeLabel, topThemeOf, isTopTheme,
} from './model.js';
import { DEFAULT_SETTINGS, makeScheduler, computeStates, replayCard, sortReviews } from './scheduler.js';
import { GitHubClient, runSync } from './sync.js';
import { DATA_README } from './texts.js';

const DB_NAME = 'learning-tester';
const STORES = ['themes', 'cards', 'entries', 'reviews', 'kv'];

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, s === 'kv' ? undefined : { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const promisify = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

class Store extends EventTarget {
  constructor() {
    super();
    this.themes = new Map();
    this.cards = new Map();
    this.entries = new Map();
    this.reviews = new Map();
    this.reviewsByCard = new Map();
    this.settings = { ...DEFAULT_SETTINGS, updated: '' };
    this.device = null;   // { id, name }
    this.github = null;   // { owner, repo, token }
    this.syncState = { status: 'idle', lastSync: null, error: null, dirty: false };
    this.remoteCache = new Map();
    this.f = makeScheduler(this.settings);
    this.states = new Map();
    this.scheduleSync = debounce(() => this.sync().catch(() => {}), 20000);
  }

  // ---------- Loading and saving ----------

  async load() {
    this.db = await openDb();
    const tx = this.db.transaction(STORES, 'readonly');
    const all = s => promisify(tx.objectStore(s).getAll());
    const kv = k => promisify(tx.objectStore('kv').get(k));
    const [themes, cards, entries, reviews, settings, device, github, syncState, cache] = await Promise.all([
      all('themes'), all('cards'), all('entries'), all('reviews'),
      kv('settings'), kv('device'), kv('github'), kv('syncState'), kv('remoteCache'),
    ]);
    themes.forEach(t => this.themes.set(t.id, t));
    cards.forEach(c => this.cards.set(c.id, c));
    entries.forEach(e => this.entries.set(e.id, e));
    reviews.forEach(r => this.reviews.set(r.id, r));
    if (settings) this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.device = device ?? null;
    this.github = github ?? null;
    if (syncState) this.syncState = { ...this.syncState, ...syncState, status: 'idle', error: null };
    if (cache) this.remoteCache = new Map(cache);
    this.rebuild();
    navigator.storage?.persist?.().catch(() => {});
  }

  async put(storeName, items) {
    const tx = this.db.transaction(storeName, 'readwrite');
    for (const it of items) tx.objectStore(storeName).put(it);
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  }

  async setKv(key, value) {
    const tx = this.db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  }

  rebuild() {
    this.f = makeScheduler(this.settings);
    this.reviewsByCard = new Map();
    for (const r of this.reviews.values()) {
      if (!this.reviewsByCard.has(r.card)) this.reviewsByCard.set(r.card, []);
      this.reviewsByCard.get(r.card).push(r);
    }
    this.states = computeStates(this.liveCards(), this.reviewsByCard, this.f);
    this.statesDay = dayStart().getTime();
    this.emit();
  }

  // Daily counts are worked out from 4am; recompute after the day rolls over.
  refreshIfNewDay() {
    if (this.statesDay !== dayStart().getTime()) this.rebuild();
  }

  emit() {
    this.dispatchEvent(new Event('change'));
  }

  async changed() {
    this.syncState.dirty = true;
    await this.setKv('syncState', this.persistableSyncState());
    this.emit();
    if (this.github) this.scheduleSync();
  }

  persistableSyncState() {
    const { lastSync, dirty } = this.syncState;
    return { lastSync, dirty };
  }

  // ---------- Reading ----------

  liveThemes() {
    return [...this.themes.values()].filter(t => !t.deleted).sort((a, b) => a.name.localeCompare(b.name));
  }

  liveCards() {
    return [...this.cards.values()].filter(c => !c.deleted);
  }

  // "Spanish" or "Spanish › Verbs"
  themeName(id) {
    return themeLabel(this.themes, id);
  }

  themeTree() {
    return themeTree(this.themes);
  }

  // A theme plus its sub-themes.
  themeScope(id) {
    return themeAndChildren(this.themes, id);
  }

  topThemeOf(id) {
    return topThemeOf(this.themes, id);
  }

  isTopTheme(id) {
    const t = this.themes.get(id);
    return !!t && isTopTheme(this.themes, t);
  }

  cardState(id) {
    return this.states.get(id);
  }

  reviewsSince(date) {
    const iso = date.toISOString();
    return [...this.reviews.values()].filter(r => r.ts >= iso);
  }

  // ---------- Themes ----------

  // parent: a top-level theme's id to make a sub-theme (only one level is allowed).
  async addTheme(name, parent = null) {
    const clean = name.trim();
    if (parent && !this.isTopTheme(parent)) parent = this.topThemeOf(parent);
    const existing = this.liveThemes().find(t =>
      t.name.toLowerCase() === clean.toLowerCase() && (parent ? t.parent === parent : this.isTopTheme(t.id)));
    if (existing) return existing;
    const now = nowISO();
    const t = { id: uid('t'), name: clean, parent: parent || null, created: now, updated: now };
    this.themes.set(t.id, t);
    await this.put('themes', [t]);
    await this.changed();
    return t;
  }

  async renameTheme(id, name) {
    const t = { ...this.themes.get(id), name: name.trim(), updated: nowISO() };
    this.themes.set(id, t);
    await this.put('themes', [t]);
    await this.changed();
  }

  themeInUse(id) {
    return this.liveCards().some(c => c.theme === id) || [...this.entries.values()].some(e => e.theme === id && !e.deleted);
  }

  hasSubThemes(id) {
    return this.themeScope(id).length > 1;
  }

  async deleteTheme(id) {
    if (this.themeInUse(id)) throw new Error('Move or remove the cards in this theme first.');
    if (this.hasSubThemes(id)) throw new Error('Delete or move its sub-themes first.');
    const t = { ...this.themes.get(id), deleted: true, updated: nowISO() };
    this.themes.set(id, t);
    await this.put('themes', [t]);
    await this.changed();
  }

  // ---------- Cards ----------

  async addCards(list) {
    const now = nowISO();
    const cards = list.map(fields => newCard(fields, { id: uid('c'), now }));
    cards.forEach(c => this.cards.set(c.id, c));
    await this.put('cards', cards);
    for (const c of cards) this.states.set(c.id, replayCard(c, [], this.f));
    await this.changed();
    return cards;
  }

  async updateCard(id, fields) {
    const c = cleanCard({ ...this.cards.get(id), ...fields, id, updated: nowISO() });
    this.cards.set(id, c);
    await this.put('cards', [c]);
    if (!this.states.has(id)) this.states.set(id, replayCard(c, this.reviewsByCard.get(id) ?? [], this.f));
    await this.changed();
    return c;
  }

  // Change several cards at once (e.g. move to a sub-theme), with one save.
  async updateCards(ids, fields) {
    const now = nowISO();
    const changed = ids.map(id => cleanCard({ ...this.cards.get(id), ...fields, id, updated: now }));
    changed.forEach(c => this.cards.set(c.id, c));
    await this.put('cards', changed);
    await this.changed();
    return changed;
  }

  archiveCard(id) {
    return this.updateCard(id, { status: 'archived' });
  }

  restoreCard(id) {
    return this.updateCard(id, { status: 'active' });
  }

  async deleteCardForever(id) {
    const c = tombstone(this.cards.get(id), nowISO());
    this.cards.set(id, c);
    this.states.delete(id);
    await this.put('cards', [c]);
    await this.changed();
  }

  // ---------- Entries (browsing and editing come in phase 2) ----------

  async addEntry(fields) {
    const now = nowISO();
    const e = {
      id: uid('e'),
      title: fields.title,
      theme: fields.theme,
      added: now.slice(0, 10),
      created: now,
      updated: now,
      sources: fields.sources ?? [],
      builds_on: [],
      related: [],
      summary: fields.summary ?? '',
      questions: fields.questions ?? [],
    };
    this.entries.set(e.id, e);
    await this.put('entries', [e]);
    await this.changed();
    return e;
  }

  // ---------- Reviews ----------

  // kind: 'review' (normal) or 'followup' (a related-word check, phase 3)
  async addReview({ card, rating, ms, prompt, kind = 'review' }) {
    const ts = nowISO();
    const r = {
      id: `${this.device.id}-${Date.now().toString(36)}-${uid('r').slice(2, 6)}`,
      card,
      ts,
      rating,
      kind,
      ms: Math.max(0, Math.round(ms)),
      prompt,
      device: this.device.id,
    };
    this.reviews.set(r.id, r);
    if (!this.reviewsByCard.has(card)) this.reviewsByCard.set(card, []);
    this.reviewsByCard.get(card).push(r);
    this.states.set(card, replayCard(this.cards.get(card), this.reviewsByCard.get(card), this.f, dayStart()));
    await this.put('reviews', [r]);
    await this.changed();
    return { review: r, state: this.states.get(card).state };
  }

  // ---------- Settings and device ----------

  async saveSettings(patch) {
    this.settings = { ...this.settings, ...patch, updated: nowISO() };
    await this.setKv('settings', this.settings);
    this.rebuild();
    await this.changed();
  }

  async setDevice(name) {
    const slug = name.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'device';
    this.device = this.device?.name === name ? this.device : { id: `${slug}-${uid('d').slice(2, 6)}`, name };
    await this.setKv('device', this.device);
  }

  async connectGitHub({ owner, repo, token }) {
    const client = new GitHubClient({ owner, repo, token });
    await client.req('GET', ''); // throws a helpful error if the details are wrong
    this.github = { owner: owner.trim(), repo: repo.trim(), token: token.trim() };
    this.remoteCache = new Map();
    await this.setKv('github', this.github);
    await this.setKv('remoteCache', []);
    return this.sync();
  }

  async disconnectGitHub() {
    this.github = null;
    this.remoteCache = new Map();
    await this.setKv('github', null);
    await this.setKv('remoteCache', []);
    this.emit();
  }

  // ---------- Sync ----------

  dataSnapshot() {
    return { themes: this.themes, cards: this.cards, entries: this.entries, reviews: this.reviews, settings: this.settings };
  }

  // Merge items from GitHub (or a backup) into this device's data.
  async mergeData(parsed) {
    const themes = mergeInto(this.themes, parsed.themes);
    const cards = mergeInto(this.cards, parsed.cards);
    const entries = mergeInto(this.entries, parsed.entries);
    const reviews = parsed.reviews.filter(r => r?.id && !this.reviews.has(r.id));
    reviews.forEach(r => this.reviews.set(r.id, r));
    let settingsChanged = false;
    if (parsed.settings && (parsed.settings.updated ?? '') > (this.settings.updated ?? '')) {
      this.settings = { ...DEFAULT_SETTINGS, ...parsed.settings };
      await this.setKv('settings', this.settings);
      settingsChanged = true;
    }
    if (themes.length) await this.put('themes', themes);
    if (cards.length) await this.put('cards', cards);
    if (entries.length) await this.put('entries', entries);
    if (reviews.length) await this.put('reviews', reviews);
    const any = themes.length || cards.length || entries.length || reviews.length || settingsChanged;
    if (any) this.rebuild();
    return { themes: themes.length, cards: cards.length, entries: entries.length, reviews: reviews.length, settings: settingsChanged };
  }

  async sync() {
    if (!this.github || !this.device) return;
    if (this._syncing) return this._syncing;
    this.syncState.status = 'syncing';
    this.syncState.error = null;
    this.emit();
    const client = new GitHubClient(this.github);
    this._syncing = (async () => {
      try {
        const res = await runSync(client, {
          cache: this.remoteCache,
          wanted: p => isManagedPath(p) || p === 'README.md' || p === 'coach/INSTRUCTIONS.md',
          isManaged: isManagedPath,
          merge: async texts => {
            const parsed = fromFiles(texts);
            if (parsed.errors.length) console.warn('Some files could not be read:', parsed.errors);
            await this.mergeData(parsed);
          },
          desired: remoteFiles => {
            const files = toFiles(this.dataSnapshot());
            const readme = remoteFiles.get('README.md')?.text ?? '';
            if (!readme.includes('learning-tester:data-readme v2')) files.set('README.md', DATA_README);
            // Add the coach instructions, or update them when the app has a newer version.
            const coachVersion = t => Number(t?.match(/learning-tester:coach v(\d+)/)?.[1] ?? 0);
            const remoteCoach = remoteFiles.get('coach/INSTRUCTIONS.md')?.text;
            if (this.coachText && (!remoteCoach || coachVersion(remoteCoach) < coachVersion(this.coachText))) {
              files.set('coach/INSTRUCTIONS.md', this.coachText);
            }
            return files;
          },
          initialReadme: DATA_README,
          message: `Sync from ${this.device.name}`,
        });
        this.syncState = { status: 'idle', lastSync: nowISO(), error: null, dirty: false };
        await this.setKv('remoteCache', [...this.remoteCache]);
        await this.setKv('syncState', this.persistableSyncState());
        return res;
      } catch (e) {
        this.syncState.status = e.kind === 'offline' ? 'offline' : 'error';
        this.syncState.error = e.message;
        throw e;
      } finally {
        this._syncing = null;
        this.emit();
      }
    })();
    return this._syncing;
  }

  // Write the coach instructions to GitHub even if a copy already exists.
  async updateCoachFile() {
    if (!this.github) throw new Error('Connect GitHub first.');
    this.remoteCache.delete('coach/INSTRUCTIONS.md');
    const client = new GitHubClient(this.github);
    const path = '/contents/coach/INSTRUCTIONS.md';
    let sha;
    try { sha = (await client.req('GET', path)).sha; } catch (e) { if (e.kind !== 'notfound') throw e; }
    await client.req('PUT', path, { message: 'Update coach instructions', content: utf8ToBase64(this.coachText), ...(sha ? { sha } : {}) });
  }

  // ---------- Backup ----------

  backup() {
    return toBackup(this.dataSnapshot());
  }

  async restore(backup) {
    if (backup?.format !== FORMAT || backup.kind !== 'backup') throw new Error("This file isn't a Learning Tester backup.");
    const result = await this.mergeData({
      themes: backup.themes ?? [],
      cards: (backup.cards ?? []).map(cleanCard),
      entries: backup.entries ?? [],
      reviews: backup.reviews ?? [],
      settings: backup.settings ?? null,
    });
    await this.changed();
    return result;
  }
}

export const store = new Store();
export { sortReviews };
