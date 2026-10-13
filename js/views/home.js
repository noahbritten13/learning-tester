import { store } from '../store.js';
import { buildQueue, isActive, State, keysOf } from '../scheduler.js';
import { inThemes } from '../model.js';
import { dayStart, formatDuration, formatRelative } from '../util.js';
import { esc, go, syncPill } from '../ui.js';

let selecting = false;
const selected = new Set();
const expanded = new Set(); // themes whose sub-themes are shown

export function todayStats() {
  const reviews = store.reviewsSince(dayStart());
  const byTheme = new Map();
  let ms = 0;
  const cards = new Set();
  for (const r of reviews) {
    ms += r.ms ?? 0;
    cards.add(r.card);
    const theme = store.cards.get(r.card)?.theme;
    byTheme.set(theme, (byTheme.get(theme) ?? 0) + 1);
  }
  return { reviews: reviews.length, cards: cards.size, ms, byTheme };
}

export function todayPanel() {
  const t = todayStats();
  if (!t.reviews) return `<section class="today"><h2>Today</h2><p class="muted">No reviews yet today.</p></section>`;
  const themes = [...t.byTheme]
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => `<span class="chip">${esc(store.themeName(id))} · ${n}</span>`)
    .join('');
  return `<section class="today">
    <h2>Today</h2>
    <p class="today-stats"><strong>${t.reviews}</strong> review${t.reviews === 1 ? '' : 's'} · <strong>${formatDuration(t.ms)}</strong>${t.cards !== t.reviews ? ` · ${t.cards} cards` : ''}</p>
    <div class="chips">${themes}</div>
  </section>`;
}

function nextDueText() {
  let soonest = null;
  for (const c of store.liveCards()) {
    if (!isActive(c)) continue;
    for (const key of keysOf(c)) {
      const st = store.cardState(key)?.state;
      if (!st || st.state === State.New) continue;
      const due = new Date(st.due);
      if (due > new Date() && (!soonest || due < soonest)) soonest = due;
    }
  }
  return soonest ? `Next review due ${formatRelative(soonest)}.` : '';
}

export function homeView() {
  store.refreshIfNewDay();
  const tree = store.themeTree();
  const all = store.liveCards();
  const active = all.filter(isActive);
  const queueFor = themeIds => buildQueue({ cards: all, states: store.states, settings: store.settings, themeIds, dirOf: store.dirOf }).counts;
  const total = queueFor(null);
  const dueNow = total.learning + total.review;
  const anyDue = dueNow + total.new > 0;

  // One row: a theme (covering its sub-themes) or a single sub-theme.
  const row = (theme, scope, { sub = false, kids = 0 } = {}) => {
    const q = queueFor(scope);
    const due = q.learning + q.review;
    const count = active.filter(c => inThemes(c, scope)).length;
    const meta = [due ? `${due} due` : '', q.new ? `${q.new} new` : ''].filter(Boolean).join(' · ') || (count ? 'Nothing due' : 'No cards yet');
    const control = selecting
      ? `<input type="checkbox" class="check" data-change="pick" value="${theme.id}" ${selected.has(theme.id) ? 'checked' : ''} aria-label="Select ${esc(theme.name)}">`
      : due + q.new ? `<a class="btn btn-small" href="#/review?start=${theme.id}">Review</a>` : '';
    const toggle = kids
      ? `<button type="button" class="expander ${expanded.has(theme.id) ? 'open' : ''}" data-action="expand" data-id="${theme.id}" aria-label="${expanded.has(theme.id) ? 'Hide' : 'Show'} sub-themes of ${esc(theme.name)}" aria-expanded="${expanded.has(theme.id)}">›</button>`
      : sub ? '' : '<span class="expander-space"></span>';
    return `<li class="theme-row ${sub ? 'sub' : ''}">
      ${toggle}
      <div class="grow"><div class="theme-name">${esc(theme.name)}</div><div class="muted small">${count} card${count === 1 ? '' : 's'}${kids ? ` · ${kids} sub-theme${kids === 1 ? '' : 's'}` : ''} · ${meta}</div></div>
      ${control}
    </li>`;
  };

  // Which way language words are asked, chosen per language theme.
  const directionRow = theme => {
    const mode = store.dirMode(theme.id);
    const seg = (value, label) => `<button type="button" class="seg ${mode === value ? 'on' : ''}" data-action="dir" data-theme="${theme.id}" data-value="${value}" aria-pressed="${mode === value}">${label}</button>`;
    const lang = esc(theme.language);
    return `<li class="direction-row"><div class="segmented small" role="group" aria-label="Direction for ${lang}">
      ${seg('fwd', `${lang} → English`)}${seg('rev', `English → ${lang}`)}${seg('mixed', 'Mixed')}</div></li>`;
  };

  const themeRows = tree.map(({ theme, children }) => {
    let html = row(theme, store.themeScope(theme.id), { kids: children.length });
    if (theme.language && !selecting) html += directionRow(theme);
    if (children.length && expanded.has(theme.id)) html += children.map(c => row(c, [c.id], { sub: true })).join('');
    return html;
  }).join('');

  const emptyState = !active.length ? `
    <section class="empty">
      <h2>Add your first cards</h2>
      <p>Paste cards you've made in a chat with Claude, or write one here.</p>
      <div class="row"><a class="btn" href="#/import">Paste cards</a><a class="btn btn-secondary" href="#/new">Write a card</a></div>
    </section>` : '';

  const html = `
    <header class="bar home-bar"><h1>Learning Tester</h1><div class="bar-right">${syncPill()}</div></header>
    <main class="page">
      ${emptyState}
      ${active.length ? `
        <a class="btn btn-hero ${anyDue ? '' : 'disabled'}" href="${anyDue ? '#/review?start=all' : '#/home'}">
          <span>Review all</span>
          <span class="hero-meta">${anyDue ? `${dueNow} due · ${total.new} new` : 'Nothing due right now'}</span>
        </a>
        ${anyDue ? '' : `<p class="muted center small">${esc(nextDueText())}</p>`}` : ''}
      ${todayPanel()}
      ${tree.length ? `
        <section>
          <div class="section-head">
            <h2>Themes</h2>
            <button type="button" class="link" data-action="toggleSelect">${selecting ? 'Cancel' : 'Review several'}</button>
          </div>
          <ul class="list themes">${themeRows}</ul>
          ${selecting ? `<button type="button" class="btn btn-block" data-action="reviewSelected" ${selected.size ? '' : 'disabled'}>Review ${selected.size || ''} selected</button>` : ''}
        </section>` : ''}
      ${!store.github ? `<p class="notice">This device isn't syncing. <a href="#/settings">Connect GitHub</a> to back up and use your cards on other devices.</p>` : ''}
    </main>`;

  return {
    html,
    live: true,
    actions: {
      dir(el) {
        store.setDirMode(el.dataset.theme, el.dataset.value);
      },
      expand(el) {
        const id = el.dataset.id;
        expanded.has(id) ? expanded.delete(id) : expanded.add(id);
        go('#/home');
      },
      toggleSelect() {
        selecting = !selecting;
        selected.clear();
        go('#/home');
      },
      reviewSelected() {
        if (!selected.size) return;
        const ids = [...selected].join(',');
        selecting = false;
        selected.clear();
        go(`#/review?start=${ids}`);
      },
    },
    changes: {
      pick(el) {
        if (el.checked) selected.add(el.value);
        else selected.delete(el.value);
        go('#/home');
      },
    },
  };
}
