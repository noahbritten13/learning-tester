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

// <option>s for choosing a theme.
export function themeOptions(selected, { allowNew = true, placeholder = '' } = {}) {
  const themes = store.liveThemes();
  let html = placeholder ? `<option value="" ${!selected ? 'selected' : ''} disabled>${esc(placeholder)}</option>` : '';
  html += themes.map(t => `<option value="${t.id}" ${t.id === selected ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
  if (allowNew) html += `<option value="__new" ${selected === '__new' ? 'selected' : ''}>+ New theme…</option>`;
  return html;
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
