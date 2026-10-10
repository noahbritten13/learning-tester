// Starts the app and switches between screens (#/home, #/review, ...).

import { store } from './store.js';
import { setRenderer, go, toast } from './ui.js';
import { homeView } from './views/home.js';
import { reviewView } from './views/review.js';
import { cardsView, cardEditView, archiveView } from './views/cards.js';
import { importView } from './views/import.js';
import { settingsView, setupView, coachView } from './views/settings.js';

const routes = {
  home: homeView,
  review: reviewView,
  cards: cardsView,
  card: cardEditView,
  new: cardEditView,
  archive: archiveView,
  import: importView,
  settings: settingsView,
  setup: setupView,
  coach: coachView,
};

const root = document.getElementById('app');
const tabs = document.getElementById('tabs');
let current = null;
let lastScreen = null;

function parseHash() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [name, ...rest] = path.split('/');
  return { name: name || 'home', rest, params: Object.fromEntries(new URLSearchParams(query)) };
}

function render() {
  const { name, rest, params } = parseHash();
  if (!store.device && name !== 'setup') {
    location.replace('#/setup');
    return;
  }
  const view = routes[name] ?? homeView;
  current = view(params, rest, name);
  root.innerHTML = current.html;
  // A different screen (or a different step within one) starts at the top.
  const screen = `${name}/${rest.join('/')}/${current.step ?? ''}`;
  if (screen !== lastScreen) window.scrollTo(0, 0);
  lastScreen = screen;
  document.body.classList.toggle('focus-mode', !!current.hideTabs);
  for (const a of tabs.querySelectorAll('a')) a.classList.toggle('active', a.dataset.tab === (current.tab ?? name));
  current.mount?.(root);
}

setRenderer(render);

function delegate(type, attr, handlers) {
  root.addEventListener(type, e => {
    const el = e.target.closest(`[${attr}]`);
    if (!el || !root.contains(el)) return;
    const fn = current?.[handlers]?.[el.getAttribute(attr)];
    if (fn) {
      if (type === 'click' || type === 'submit') e.preventDefault();
      fn(el, e);
    }
  });
}
delegate('click', 'data-action', 'actions');
delegate('input', 'data-input', 'inputs');
delegate('change', 'data-change', 'changes');
delegate('submit', 'data-submit', 'actions');
document.addEventListener('keydown', e => current?.onKey?.(e));

// Shared action: the sync pill on several screens.
root.addEventListener('click', e => {
  if (!e.target.closest('[data-action="syncNow"]')) return;
  if (!store.github) return go('#/settings');
  if (store.syncState.status === 'error') toast(store.syncState.error ?? 'Sync problem');
  store.sync().then(r => r && toast(r.pushed || r.pulled ? 'Synced' : 'Up to date')).catch(err => toast(err.message));
});

store.addEventListener('change', () => {
  if (current?.live) render();
  else current?.onStoreChange?.();
});
window.addEventListener('hashchange', render);

function syncSoon() {
  if (store.github) store.sync().catch(() => {});
}
window.addEventListener('online', syncSoon);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    store.refreshIfNewDay();
    const last = store.syncState.lastSync ? Date.parse(store.syncState.lastSync) : 0;
    if (Date.now() - last > 60_000) syncSoon();
  } else if (store.syncState.dirty) {
    syncSoon();
  }
});

async function start() {
  try {
    await store.load();
  } catch (e) {
    root.innerHTML = `<div class="page"><h1>Couldn't open storage</h1><p>${e.message}</p><p>Private browsing can block storage. Try opening the app normally.</p></div>`;
    return;
  }
  store.coachText = await fetch('coach/INSTRUCTIONS.md').then(r => (r.ok ? r.text() : '')).catch(() => '');
  render();
  syncSoon();
  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch(() => {});
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded || !hadController) return;
      reloaded = true;
      toast('The app has been updated.', { label: 'Reload', run: () => location.reload() });
    });
  }
}

start();
