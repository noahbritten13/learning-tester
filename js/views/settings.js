import { store } from '../store.js';
import { DEFAULT_SETTINGS } from '../scheduler.js';
import { formatRelative } from '../util.js';
import { esc, header, go, render, toast, syncPill, downloadOrShare, readFile } from '../ui.js';

export const APP_VERSION = '1.1.0 (phase 1 + sub-themes)';
const FSRS_VERSION = 'ts-fsrs 5.4.2';

function guessDeviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Macintosh/.test(ua)) return 'Mac';
  return 'My device';
}

function githubForm(prefill = {}) {
  return `
    <form class="form" data-submit="connect" autocomplete="off">
      <label>GitHub username<input name="owner" value="${esc(prefill.owner ?? '')}" autocapitalize="none" autocorrect="off" spellcheck="false" required></label>
      <label>Data repository name<input name="repo" value="${esc(prefill.repo ?? 'learning-data')}" autocapitalize="none" autocorrect="off" spellcheck="false" required></label>
      <label>Access key<input name="token" type="password" placeholder="github_pat_…" autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="off" required></label>
      <p class="muted small">The access key is stored only on this device and sent only to GitHub. Create it with access to the data repository only (see the setup guide).</p>
      <div id="connect-error"></div>
      <button type="submit" class="btn btn-block">Connect</button>
    </form>`;
}

async function connect(form) {
  const errEl = document.getElementById('connect-error');
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'Connecting…';
  errEl.innerHTML = '';
  try {
    await store.connectGitHub({ owner: form.owner.value, repo: form.repo.value, token: form.token.value });
    toast('Connected and synced');
    return true;
  } catch (e) {
    errEl.innerHTML = `<div class="errors">${esc(e.message)}</div>`;
    btn.disabled = false;
    btn.textContent = 'Connect';
    return false;
  }
}

// ---------- First run ----------

export function setupView() {
  return {
    html: `
      <main class="page setup">
        <h1>Learning Tester</h1>
        <p>Spaced-repetition flashcards for what you're learning.</p>
        <label>Name for this device<input id="device-name" value="${esc(store.device?.name ?? guessDeviceName())}"></label>
        <p class="muted small">Used to label reviews made here, e.g. “iPhone” or “Mac”.</p>
        <h2>Sync with GitHub</h2>
        <p class="muted small">Keeps your cards backed up and the same on all your devices. You can also do this later in Settings.</p>
        ${githubForm()}
        <div class="or">or</div>
        <button type="button" class="btn btn-secondary btn-block" data-action="local">Start without sync for now</button>
      </main>`,
    hideTabs: true,
    actions: {
      async connect(form) {
        const name = document.getElementById('device-name').value.trim() || guessDeviceName();
        await store.setDevice(name);
        if (await connect(form)) go('#/home');
      },
      async local() {
        const name = document.getElementById('device-name').value.trim() || guessDeviceName();
        await store.setDevice(name);
        go('#/home');
      },
    },
  };
}

// ---------- Settings ----------

const STEP = /^\d+(\.\d+)?[mhd]$/;
const parseSteps = s => s.split(/[\s,]+/).filter(Boolean);

export function settingsView() {
  const s = store.settings;
  const gh = store.github;
  const sync = store.syncState;
  const tree = store.themeTree();
  const themeRow = (t, sub = false) => `
    <li class="theme-row admin ${sub ? 'sub' : ''}">
      <div class="theme-name">${esc(t.name)}</div>
      <div class="row tight">
        ${sub ? '' : `<button type="button" class="link" data-action="addSubTheme" data-id="${t.id}">+ Sub-theme</button>`}
        <button type="button" class="link" data-action="renameTheme" data-id="${t.id}">Rename</button>
        <button type="button" class="link danger" data-action="deleteTheme" data-id="${t.id}">Delete</button>
      </div>
    </li>`;
  const archived = store.liveCards().filter(c => c.status === 'archived').length;

  const syncSection = gh
    ? `<p>Syncing with <strong>${esc(gh.owner)}/${esc(gh.repo)}</strong> as <strong>${esc(store.device.name)}</strong>.</p>
       <p class="muted small">${sync.lastSync ? `Last synced ${formatRelative(sync.lastSync)}.` : 'Not synced yet.'}${sync.dirty ? ' Changes waiting to sync.' : ''}</p>
       ${sync.error ? `<div class="errors">${esc(sync.error)}</div>` : ''}
       <div class="row"><button type="button" class="btn" data-action="syncNow2">Sync now</button>
       <button type="button" class="btn btn-secondary" data-action="disconnect">Disconnect</button></div>`
    : `<p class="muted small">This device isn't syncing. Your cards are only stored here.</p>${githubForm()}`;

  return {
    html: `
      ${header('Settings', { right: syncPill() })}
      <main class="page">
        <section class="card-section"><h2>Sync</h2>${syncSection}</section>

        <section class="card-section">
          <h2>Reviewing</h2>
          <form class="form" data-submit="saveSettings">
            <label>Desired retention <span class="muted">(0.70 to 0.99; higher means more reviews)</span>
              <input name="retention" type="number" min="0.7" max="0.99" step="0.01" value="${s.retention}"></label>
            <div class="two">
              <label>New cards a day<input name="newPerDay" type="number" min="0" max="9999" value="${s.newPerDay}"></label>
              <label>Maximum reviews a day<input name="maxReviewsPerDay" type="number" min="0" max="99999" value="${s.maxReviewsPerDay}"></label>
            </div>
            <div class="two">
              <label>Learning steps<input name="learningSteps" value="${esc(s.learningSteps.join(' '))}"></label>
              <label>Relearning steps<input name="relearningSteps" value="${esc(s.relearningSteps.join(' '))}"></label>
            </div>
            <p class="muted small">Steps are short waits before a new or forgotten card goes back on the normal schedule, e.g. “1m 10m”.</p>
            <label class="check-row"><input type="checkbox" name="fuzz" ${s.fuzz ? 'checked' : ''}> Fuzz: vary intervals slightly so cards don't bunch up</label>
            <label class="check-row"><input type="checkbox" name="strictAccents" ${s.strictAccents ? 'checked' : ''}> Strict accents: “arbol” for “árbol” counts as wrong</label>
            <div id="settings-error"></div>
            <div class="row"><button type="submit" class="btn">Save</button>
            <button type="button" class="link" data-action="defaults">Reset to defaults</button></div>
          </form>
        </section>

        <section class="card-section">
          <h2>Themes</h2>
          ${tree.length ? `<ul class="list themes">${tree.map(({ theme, children }) => themeRow(theme) + children.map(c => themeRow(c, true)).join('')).join('')}</ul>` : '<p class="muted">No themes yet.</p>'}
          <form class="row" data-submit="addTheme"><input name="name" placeholder="New theme" class="grow"><button type="submit" class="btn btn-secondary">Add</button></form>
        </section>

        <section class="card-section">
          <h2>Cards</h2>
          <p><a href="#/cards?show=archived">Archive</a> <span class="muted">(${archived} card${archived === 1 ? '' : 's'})</span></p>
          <p><a href="#/coach">Instructions for Claude</a> <span class="muted">(paste into your claude.ai Project)</span></p>
        </section>

        <section class="card-section">
          <h2>Backup</h2>
          <p class="muted small">${gh ? 'GitHub keeps every version of your data. ' : ''}You can also save everything as one file, and restore from it later. Restoring adds to what's here; it never deletes anything.</p>
          <div class="row"><button type="button" class="btn btn-secondary" data-action="download">Download everything</button>
          <label class="btn btn-secondary file-btn">Restore from file<input type="file" accept=".json,application/json" data-change="restore" hidden></label></div>
        </section>

        <section class="card-section">
          <h2>This device</h2>
          <form class="row" data-submit="rename"><input name="name" value="${esc(store.device?.name ?? '')}" class="grow"><button type="submit" class="btn btn-secondary">Rename</button></form>
          <p class="muted small">Learning Tester ${APP_VERSION} · ${FSRS_VERSION}</p>
        </section>
      </main>`,
    tab: 'settings',
    live: false,
    onStoreChange() {
      const pill = document.querySelector('.bar .pill');
      if (pill) pill.outerHTML = syncPill();
    },
    actions: {
      async connect(form) {
        if (await connect(form)) render();
      },
      syncNow2() {
        store.sync().then(() => { toast('Synced'); render(); }).catch(e => { toast(e.message); render(); });
      },
      async disconnect() {
        if (!confirm('Stop syncing this device? Your cards stay on this device and on GitHub.')) return;
        await store.disconnectGitHub();
        render();
      },
      async saveSettings(form) {
        const errEl = document.getElementById('settings-error');
        const learningSteps = parseSteps(form.learningSteps.value);
        const relearningSteps = parseSteps(form.relearningSteps.value);
        const retention = Number(form.retention.value);
        const errors = [];
        if (!(retention >= 0.7 && retention <= 0.99)) errors.push('Desired retention must be between 0.70 and 0.99.');
        if (![...learningSteps, ...relearningSteps].every(x => STEP.test(x))) errors.push('Steps must look like “1m”, “10m”, “1h” or “1d”.');
        if (errors.length) {
          errEl.innerHTML = `<div class="errors">${errors.map(esc).join('<br>')}</div>`;
          return;
        }
        await store.saveSettings({
          retention,
          newPerDay: Math.max(0, Math.round(Number(form.newPerDay.value) || 0)),
          maxReviewsPerDay: Math.max(0, Math.round(Number(form.maxReviewsPerDay.value) || 0)),
          learningSteps,
          relearningSteps,
          fuzz: form.fuzz.checked,
          strictAccents: form.strictAccents.checked,
        });
        toast('Settings saved');
        render();
      },
      async defaults() {
        if (!confirm('Reset the reviewing settings to their defaults?')) return;
        await store.saveSettings({ ...DEFAULT_SETTINGS });
        render();
      },
      async addTheme(form) {
        const name = form.name.value.trim();
        if (!name) return;
        await store.addTheme(name);
        render();
      },
      async addSubTheme(el) {
        const parent = store.themes.get(el.dataset.id);
        const name = prompt(`Name of the new sub-theme of “${parent.name}”`);
        if (!name?.trim()) return;
        await store.addTheme(name, parent.id);
        render();
      },
      async renameTheme(el) {
        const t = store.themes.get(el.dataset.id);
        const name = prompt('New name for this theme', t.name);
        if (!name?.trim()) return;
        await store.renameTheme(t.id, name);
        render();
      },
      async deleteTheme(el) {
        const t = store.themes.get(el.dataset.id);
        if (store.themeInUse(t.id)) return toast('This theme still has cards. Move them first (Cards → Select).');
        if (store.hasSubThemes(t.id)) return toast('Delete its sub-themes first.');
        if (!confirm(`Delete the theme “${t.name}”?`)) return;
        await store.deleteTheme(t.id);
        render();
      },
      download() {
        const date = new Date().toISOString().slice(0, 10);
        downloadOrShare(`learning-tester-backup-${date}.json`, JSON.stringify(store.backup(), null, 1));
      },
      async rename(form) {
        const name = form.name.value.trim();
        if (!name) return;
        store.device = { ...store.device, name };
        await store.setKv('device', store.device);
        toast('Renamed');
      },
    },
    changes: {
      async restore(el) {
        const f = el.files?.[0];
        if (!f) return;
        try {
          const r = await store.restore(JSON.parse(await readFile(f)));
          toast(`Restored: ${r.cards} cards, ${r.reviews} reviews, ${r.themes} themes added or updated.`);
        } catch (e) {
          toast(e.message);
        }
        el.value = '';
      },
    },
  };
}

// ---------- Coach instructions ----------

export function coachView() {
  const text = store.coachText || 'The instructions could not be loaded. Connect to the internet and reopen this page.';
  return {
    html: `
      ${header('Instructions for Claude', { back: '#/settings' })}
      <main class="page">
        <p>Paste these into your claude.ai Project's instructions (or another AI's custom instructions). Then, in a chat, say “help me make cards on this”. Claude will ask you to write your cards first, coach you on them, and give you something to paste into Import.</p>
        <div class="row">
          <button type="button" class="btn" data-action="copy">Copy instructions</button>
          ${store.github ? `<button type="button" class="btn btn-secondary" data-action="saveToGitHub">Save a copy to GitHub</button>` : ''}
        </div>
        <pre class="instructions">${esc(text)}</pre>
      </main>`,
    tab: 'settings',
    actions: {
      async copy() {
        try {
          await navigator.clipboard.writeText(text);
          toast('Copied');
        } catch {
          const range = document.createRange();
          range.selectNodeContents(document.querySelector('.instructions'));
          getSelection().removeAllRanges();
          getSelection().addRange(range);
          toast('Selected: use Copy from the menu');
        }
      },
      async saveToGitHub() {
        try {
          await store.updateCoachFile();
          toast('Saved to coach/INSTRUCTIONS.md');
        } catch (e) {
          toast(e.message);
        }
      },
    },
  };
}
