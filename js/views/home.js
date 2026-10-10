import { store } from '../store.js';
import { dueByTheme, isActive, State } from '../scheduler.js';
import { dayStart, formatDuration, formatRelative } from '../util.js';
import { esc, go, syncPill } from '../ui.js';

let selecting = false;
const selected = new Set();

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
    const st = store.cardState(c.id)?.state;
    if (!st || st.state === State.New) continue;
    const due = new Date(st.due);
    if (due > new Date() && (!soonest || due < soonest)) soonest = due;
  }
  return soonest ? `Next review due ${formatRelative(soonest)}.` : '';
}

export function homeView() {
  store.refreshIfNewDay();
  const themes = store.liveThemes();
  const active = store.liveCards().filter(isActive);
  const { byTheme, total } = dueByTheme({ cards: store.liveCards(), states: store.states, settings: store.settings });
  const dueNow = total.learning + total.review;
  const anyDue = dueNow + total.new > 0;

  const themeRows = themes.map(t => {
    const row = byTheme.get(t.id) ?? { due: 0, new: 0 };
    const count = active.filter(c => c.theme === t.id).length;
    const meta = [row.due ? `${row.due} due` : '', row.new ? `${row.new} new` : ''].filter(Boolean).join(' · ') || (count ? 'Nothing due' : 'No cards yet');
    const control = selecting
      ? `<input type="checkbox" class="check" data-change="pick" value="${t.id}" ${selected.has(t.id) ? 'checked' : ''} aria-label="Select ${esc(t.name)}">`
      : row.due + row.new
        ? `<a class="btn btn-small" href="#/review?start=${t.id}">Review</a>`
        : '';
    return `<li class="theme-row">
      <div><div class="theme-name">${esc(t.name)}</div><div class="muted small">${count} card${count === 1 ? '' : 's'} · ${meta}</div></div>
      ${control}
    </li>`;
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
      ${themes.length ? `
        <section>
          <div class="section-head">
            <h2>Themes</h2>
            <button type="button" class="link" data-action="toggleSelect">${selecting ? 'Cancel' : 'Review several'}</button>
          </div>
          <ul class="list">${themeRows}</ul>
          ${selecting ? `<button type="button" class="btn btn-block" data-action="reviewSelected" ${selected.size ? '' : 'disabled'}>Review ${selected.size || ''} selected</button>` : ''}
        </section>` : ''}
      ${!store.github ? `<p class="notice">This device isn't syncing. <a href="#/settings">Connect GitHub</a> to back up and use your cards on other devices.</p>` : ''}
    </main>`;

  return {
    html,
    live: true,
    actions: {
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
