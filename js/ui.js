// Shared bits for the screens.

import { escapeHtml } from './util.js';
import { store } from './store.js';

export const esc = escapeHtml;
export const multiline = s => esc(s).replace(/\n/g, '<br>');

let renderer = () => {};
export const setRenderer = fn => { renderer = fn; };
export const render = () => renderer();

export const go = hash => {
  if (location.hash === hash) render();
  else location.hash = hash;
};

let toastTimer;
export function toast(message, action) {
  const el = document.getElementById('toast');
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  el.classList.add('show');
  if (action) {
    el.querySelector('button').onclick = () => {
      el.classList.remove('show');
      action.run();
    };
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 6000 : 2600);
}

// <option>s for choosing a theme: each theme followed by its sub-themes.
export function themeOptions(selected, { allowNew = true, placeholder = '', topOnly = false } = {}) {
  const tree = store.themeTree();
  const opt = (value, label) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`;
  let html = placeholder ? `<option value="" ${!selected ? 'selected' : ''} disabled>${esc(placeholder)}</option>` : '';
  for (const { theme, children } of tree) {
    html += opt(theme.id, theme.name);
    if (!topOnly) for (const c of children) html += opt(c.id, `${theme.name} › ${c.name}`);
  }
  if (allowNew) {
    html += opt('__new', '+ New theme…');
    if (tree.length) html += opt('__newsub', '+ New sub-theme…');
  }
  return html;
}

// The theme field for writing, importing or moving cards. `pick` holds
// { theme, newTheme, newSub, subParent } and is updated as you choose.
export function themePicker(pick, { label = 'Theme', allowNew = true } = {}) {
  const hasThemes = store.themeTree().length > 0;
  let html = `<label>${esc(label)}<select data-change="pickTheme">${themeOptions(pick.theme, { allowNew, placeholder: hasThemes ? '' : 'Choose…' })}</select></label>`;
  if (pick.theme === '__new') {
    html += `<label>New theme name<input data-input="pickNewTheme" value="${esc(pick.newTheme ?? '')}" placeholder="e.g. Spanish"></label>
      <label>Sub-theme <span class="muted">(optional)</span><input data-input="pickNewSub" value="${esc(pick.newSub ?? '')}" placeholder="e.g. Verbs"></label>`;
  } else if (pick.theme === '__newsub') {
    html += `<label>Sub-theme of<select data-change="pickSubParent">${themeOptions(pick.subParent, { allowNew: false, topOnly: true })}</select></label>
      <label>New sub-theme name<input data-input="pickNewSub" value="${esc(pick.newSub ?? '')}" placeholder="e.g. Verbs"></label>`;
  }
  return html;
}

// Handlers to merge into a screen's `changes` and `inputs`.
export function pickerHandlers(pick) {
  return {
    changes: {
      pickTheme(el) {
        // A new sub-theme goes under the theme that was selected, if any.
        if (store.themes.get(pick.theme)) pick.subParent = store.topThemeOf(pick.theme);
        if (!store.themes.get(pick.subParent)) pick.subParent = store.themeTree()[0]?.theme.id;
        pick.theme = el.value;
        render();
      },
      pickSubParent(el) { pick.subParent = el.value; },
    },
    inputs: {
      pickNewTheme(el) { pick.newTheme = el.value; },
      pickNewSub(el) { pick.newSub = el.value; },
    },
  };
}

export function pickerError(pick) {
  if (!pick.theme) return 'Choose a theme.';
  if (pick.theme === '__new' && !pick.newTheme?.trim()) return 'Give the new theme a name.';
  if (pick.theme === '__newsub' && !pick.newSub?.trim()) return 'Give the new sub-theme a name.';
  if (pick.theme === '__newsub' && !store.themes.get(pick.subParent)) return 'Choose which theme the sub-theme belongs to.';
  return null;
}

// Creates any new theme or sub-theme, and returns the chosen theme's id.
export async function resolvePick(pick) {
  if (pick.theme === '__new') {
    const top = await store.addTheme(pick.newTheme);
    return pick.newSub?.trim() ? (await store.addTheme(pick.newSub, top.id)).id : top.id;
  }
  if (pick.theme === '__newsub') return (await store.addTheme(pick.newSub, pick.subParent)).id;
  return pick.theme;
}

export function header(title, { back, right = '' } = {}) {
  return `<header class="bar">
    ${back ? `<a class="bar-back" href="${back}" aria-label="Back">‹</a>` : '<span class="bar-spacer"></span>'}
    <h1>${esc(title)}</h1>
    <div class="bar-right">${right}</div>
  </header>`;
}

export function syncPill() {
  const s = store.syncState;
  let label, cls;
  if (!store.github) [label, cls] = ['Not syncing', 'muted'];
  else if (s.status === 'syncing') [label, cls] = ['Syncing…', 'busy'];
  else if (s.status === 'offline') [label, cls] = [s.dirty ? 'Offline · saved here' : 'Offline', 'muted'];
  else if (s.status === 'error') [label, cls] = ['Sync problem', 'bad'];
  else if (s.dirty) [label, cls] = ['Changes waiting', 'muted'];
  else [label, cls] = ['Synced', 'ok'];
  return `<button type="button" class="pill pill-${cls}" data-action="syncNow">${esc(label)}</button>`;
}

export function downloadOrShare(filename, text, type = 'application/json') {
  const file = new File([text], filename, { type });
  if (navigator.canShare?.({ files: [file] }) && /iPhone|iPad/.test(navigator.userAgent)) {
    return navigator.share({ files: [file], title: filename }).catch(() => {});
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const readFile = file => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = () => rej(r.error);
  r.readAsText(file);
});
