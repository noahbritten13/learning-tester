// The data model, and how it's written to and read from plain-text files.
// Everything here is pure (no storage, no network) so it can be tested.

import { slugify } from './util.js';

export const FORMAT = 'learning-tester/1';

// ---------- Item shapes ----------

export function newCard(fields, { id, now }) {
  return cleanCard({
    id,
    theme: fields.theme,
    entry: fields.entry ?? null,
    also_in: fields.also_in ?? [],
    type: fields.type,
    prompts: fields.prompts,
    answer: fields.answer,
    accept: fields.accept ?? [],
    note: fields.note ?? '',
    opposites: fields.opposites ?? [],
    related: fields.related ?? [],
    builds_on: fields.builds_on ?? [],
    author: fields.author === 'claude' ? 'claude' : 'me',
    source: fields.source ?? '',
    unverified: !!fields.unverified,
    tags: fields.tags ?? [],
    status: 'active',
    created: now,
    updated: now,
  });
}

const trimList = v => (Array.isArray(v) ? v : []).map(x => String(x ?? '').trim()).filter(Boolean);
const uniq = list => [...new Set(list)];

// Card types: 'concept' (you mark yourself), 'exact' (typed answer marked
// automatically) and 'word' (a word in a language theme, tested both ways:
// prompts[0] is the word, answer its meaning(s), note grammar shown after answering).
export const CARD_TYPES = ['concept', 'exact', 'word'];
const cardType = t => (CARD_TYPES.includes(t) ? t : 'concept');

export function cleanCard(c) {
  if (c.deleted) return { id: c.id, deleted: true, created: c.created, updated: c.updated };
  return {
    id: c.id,
    theme: c.theme ?? null,
    // Other sub-themes (of the same theme) the card also belongs to.
    also_in: uniq(trimList(c.also_in)).filter(id => id !== c.theme),
    entry: c.entry ?? null,
    type: cardType(c.type),
    prompts: trimList(c.prompts),
    answer: String(c.answer ?? '').trim(),
    accept: trimList(c.accept),
    note: String(c.note ?? '').trim(),
    // Linked words (card ids). A link is stored on one card and shown on both.
    opposites: uniq(trimList(c.opposites)).filter(id => id !== c.id),
    related: uniq(trimList(c.related)).filter(id => id !== c.id),
    builds_on: trimList(c.builds_on),
    author: c.author === 'claude' ? 'claude' : 'me',
    source: String(c.source ?? '').trim(),
    unverified: !!c.unverified,
    tags: trimList(c.tags),
    status: c.status === 'archived' ? 'archived' : 'active',
    created: c.created,
    updated: c.updated,
  };
}

export const tombstone = (item, now) => ({ id: item.id, deleted: true, created: item.created, updated: now });

// ---------- Merging ----------

// The newer edit wins; ties are broken the same way on every device. On a
// tie the fuller copy wins, so an older app version that drops fields it
// doesn't know can't wipe them out.
export function isNewer(a, b) {
  if (!b) return true;
  if (a.updated !== b.updated) return (a.updated ?? '') > (b.updated ?? '');
  const ja = JSON.stringify(a), jb = JSON.stringify(b);
  if (ja.length !== jb.length) return ja.length > jb.length;
  return ja > jb;
}

// Merge remote items into a local Map. Returns the items that were taken.
export function mergeInto(localMap, remoteItems) {
  const taken = [];
  for (const item of remoteItems) {
    if (!item?.id) continue;
    const mine = localMap.get(item.id);
    if (!mine || (JSON.stringify(mine) !== JSON.stringify(item) && isNewer(item, mine))) {
      localMap.set(item.id, item);
      taken.push(item);
    }
  }
  return taken;
}

// ---------- Themes (with one level of sub-themes) ----------
// A theme may have `parent`: the id of a top-level theme. A sub-theme whose
// parent is missing or deleted is treated as a top-level theme.

const byName = (a, b) => a.name.localeCompare(b.name);

export function isTopTheme(themes, t) {
  const p = t.parent ? themes.get(t.parent) : null;
  return !p || p.deleted;
}

// [{ theme, children: [theme, ...] }, ...] sorted by name.
export function themeTree(themes) {
  const live = [...themes.values()].filter(t => !t.deleted);
  const tops = live.filter(t => isTopTheme(themes, t)).sort(byName);
  return tops.map(theme => ({ theme, children: live.filter(c => c.parent === theme.id && c.id !== theme.id).sort(byName) }));
}

// A theme plus its sub-themes: what "review Spanish" or "filter by Spanish" covers.
export function themeAndChildren(themes, id) {
  const kids = [...themes.values()].filter(t => !t.deleted && t.parent === id && t.id !== id).map(t => t.id);
  return [id, ...kids];
}

export function topThemeOf(themes, id) {
  const t = themes.get(id);
  return t && !isTopTheme(themes, t) ? t.parent : id;
}

// Every theme id a card belongs to: its main one and any extra sub-themes.
export const cardThemes = c => (c.also_in?.length ? [c.theme, ...c.also_in] : [c.theme]);
export const inThemes = (c, ids) => cardThemes(c).some(id => ids.includes(id));

// The language a theme (or its parent theme) is set to, e.g. "Spanish", or ''.
export function themeLanguage(themes, id) {
  const t = themes.get(id);
  if (!t || t.deleted) return '';
  const top = isTopTheme(themes, t) ? t : themes.get(t.parent);
  return top?.language ?? '';
}

export function themeLabel(themes, id) {
  const t = themes.get(id);
  if (!t || t.deleted) return 'No theme';
  return isTopTheme(themes, t) ? t.name : `${themes.get(t.parent).name} › ${t.name}`;
}

// Folder-style paths for files: "spanish" or "spanish/verbs".
export function themePaths(themes) {
  const tree = themeTree(themes);
  const top = assignSlugs(tree.map(n => n.theme), t => t.name);
  const out = new Map();
  for (const { theme, children } of tree) {
    out.set(theme.id, top.get(theme.id));
    const kids = assignSlugs(children, t => t.name);
    for (const c of children) out.set(c.id, `${top.get(theme.id)}/${kids.get(c.id)}`);
  }
  return out;
}

// ---------- Writing files ----------

function assignSlugs(items, nameOf) {
  const used = new Set();
  const out = new Map();
  for (const it of items.slice().sort((a, b) => ((a.created ?? '') < (b.created ?? '') ? -1 : 1))) {
    let slug = slugify(nameOf(it));
    if (used.has(slug)) slug = `${slug}-${it.id.slice(-5)}`;
    used.add(slug);
    out.set(it.id, slug);
  }
  return out;
}

const byCreated = (a, b) => ((a.created ?? '') < (b.created ?? '') ? -1 : (a.created ?? '') > (b.created ?? '') ? 1 : a.id < b.id ? -1 : 1);
const json = v => JSON.stringify(v, null, 2) + '\n';

// q: a YAML-safe quoted string (JSON strings are valid YAML).
const q = s => JSON.stringify(String(s ?? ''));

export function entryToMarkdown(e, themeName) {
  const lines = ['---', `id: ${e.id}`, `title: ${q(e.title)}`, `theme: ${e.theme ?? ''}`, `theme_name: ${q(themeName ?? '')}`];
  lines.push(`added: ${e.added ?? ''}`, `created: ${e.created ?? ''}`, `updated: ${e.updated ?? ''}`);
  for (const key of ['sources', 'builds_on', 'related']) {
    const list = e[key] ?? [];
    if (!list.length) lines.push(`${key}: []`);
    else lines.push(`${key}:`, ...list.map(x => `  - ${q(x)}`));
  }
  lines.push('---', '', '## What I learnt (in my own words)', '', (e.summary ?? '').trim(), '');
  if (e.questions?.length) lines.push('## My questions', '', ...e.questions.map(x => `- ${x}`), '');
  return lines.join('\n');
}

const unq = v => {
  const t = v.trim();
  if (t.startsWith('"')) {
    try { return JSON.parse(t); } catch { return t.slice(1, -1); }
  }
  return t;
};

export function markdownToEntry(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const e = { sources: [], builds_on: [], related: [], questions: [], summary: '' };
  let listKey = null;
  for (const line of m[1].split('\n')) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && listKey) {
      e[listKey].push(unq(item[1]));
      continue;
    }
    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, value] = kv;
    if (['sources', 'builds_on', 'related'].includes(key)) {
      listKey = key;
      if (value.trim() && value.trim() !== '[]') e[key] = JSON.parse(value);
    } else {
      listKey = null;
      e[key] = unq(value);
    }
  }
  delete e.theme_name;
  const body = m[2];
  const summary = body.match(/## What I learnt[^\n]*\n([\s\S]*?)(?=\n## My questions|\s*$)/);
  if (summary) e.summary = summary[1].trim();
  const qs = body.match(/## My questions[^\n]*\n([\s\S]*?)(?=\n## |\s*$)/);
  if (qs) e.questions = qs[1].split('\n').map(l => l.match(/^\s*-\s+(.*)$/)?.[1]).filter(Boolean);
  if (!e.id) return null;
  if (e.theme === '') e.theme = null;
  return e;
}

// data: { themes: Map, cards: Map, entries: Map, reviews: Map, settings }
// Returns Map path -> text for every file the app manages.
export function toFiles(data) {
  const files = new Map();
  const themes = [...data.themes.values()];
  const themeSlug = themePaths(data.themes);
  const themeName = new Map([...themeSlug.keys()].map(id => [id, themeLabel(data.themes, id)]));

  files.set('themes.json', json({ format: FORMAT, themes: themes.sort(byCreated) }));
  if (data.settings) files.set('settings.json', json({ format: FORMAT, ...data.settings }));

  const cardFiles = new Map();
  for (const c of data.cards.values()) {
    const path = c.deleted
      ? 'cards/_deleted.json'
      : themeSlug.has(c.theme) ? `cards/${themeSlug.get(c.theme)}.json` : 'cards/_unsorted.json';
    if (!cardFiles.has(path)) cardFiles.set(path, { theme: c.deleted ? null : themeName.get(c.theme) ?? null, cards: [] });
    cardFiles.get(path).cards.push(c);
  }
  for (const [path, f] of cardFiles) {
    files.set(path, json({ format: FORMAT, theme_name: f.theme, cards: f.cards.sort(byCreated) }));
  }

  const entriesByTheme = new Map();
  for (const e of data.entries.values()) {
    const folder = themeSlug.get(e.theme) ?? '_unsorted';
    if (!entriesByTheme.has(folder)) entriesByTheme.set(folder, []);
    entriesByTheme.get(folder).push(e);
  }
  for (const [folder, list] of entriesByTheme) {
    const slugs = assignSlugs(list, e => e.title);
    for (const e of list) files.set(`library/${folder}/${slugs.get(e.id)}.md`, entryToMarkdown(e, themeName.get(e.theme)));
  }

  const reviewFiles = new Map();
  for (const r of data.reviews.values()) {
    const path = `reviews/${r.device}/${r.ts.slice(0, 7)}.jsonl`;
    if (!reviewFiles.has(path)) reviewFiles.set(path, []);
    reviewFiles.get(path).push(r);
  }
  for (const [path, list] of reviewFiles) {
    list.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id < b.id ? -1 : 1));
    files.set(path, list.map(r => JSON.stringify(r)).join('\n') + '\n');
  }
  return files;
}

// Paths the app owns: it may rewrite or remove these. Anything else in the
// repository (README, coach instructions, your own notes) is left alone.
export const isManagedPath = p =>
  p === 'themes.json' || p === 'settings.json' ||
  /^cards\/([^/]+\/)?[^/]+\.json$/.test(p) || /^library\/[^/]+\/([^/]+\/)?[^/]+\.md$/.test(p) || /^reviews\/[^/]+\/[^/]+\.jsonl$/.test(p);

// ---------- Reading files ----------

export function fromFiles(files) {
  const out = { themes: [], cards: [], entries: [], reviews: [], settings: null, errors: [] };
  for (const [path, text] of files) {
    if (!isManagedPath(path)) continue;
    try {
      if (path === 'themes.json') out.themes.push(...(JSON.parse(text).themes ?? []));
      else if (path === 'settings.json') {
        const { format, ...settings } = JSON.parse(text);
        out.settings = settings;
      } else if (path.startsWith('cards/')) out.cards.push(...(JSON.parse(text).cards ?? []).map(cleanCard));
      else if (path.startsWith('library/')) {
        const e = markdownToEntry(text);
        if (e) out.entries.push(e);
        else out.errors.push(`${path}: couldn't read this entry.`);
      } else if (path.startsWith('reviews/')) {
        for (const line of text.split('\n')) if (line.trim()) out.reviews.push(JSON.parse(line));
      }
    } catch (err) {
      out.errors.push(`${path}: ${err.message}`);
    }
  }
  return out;
}

// ---------- Full backup ----------

export function toBackup(data) {
  return {
    format: FORMAT,
    kind: 'backup',
    exported: new Date().toISOString(),
    settings: data.settings,
    themes: [...data.themes.values()],
    entries: [...data.entries.values()],
    cards: [...data.cards.values()],
    reviews: [...data.reviews.values()],
  };
}
