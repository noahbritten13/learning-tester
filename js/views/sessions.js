// Past sessions (spec 02): a list of review sessions, one session's summary,
// and practice of recent mistakes.

import { store } from '../store.js';
import { listSessions, summariseSession, recentMistakes, deviceLabel, periodStart } from '../sessions.js';
import { dayStart, formatDuration } from '../util.js';
import { esc, header, go, render } from '../ui.js';
import { startPractice } from './practice.js';
import { dirLabel, wordPrompt } from './review.js';

let shownDays = 30;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// The session's top themes, by name.
export function sessionThemes(reviews) {
  const names = new Set();
  for (const r of reviews) {
    const card = store.cards.get(r.card);
    if (card && !card.deleted) names.add(store.themeName(store.topThemeOf(card.theme)));
  }
  return [...names];
}

function wrongItem(w, from) {
  const card = store.cards.get(w.card);
  if (!card || card.deleted) return `<li class="wrong-item muted">A card you've since deleted</li>`;
  const word = card.type === 'word';
  const q = word ? wordPrompt(card, w.dir) : card.prompts[w.prompt] ?? card.prompts[0];
  const a = word ? (w.dir === 'rev' ? card.prompts[0] : card.answer) : card.answer;
  return `<li class="wrong-item"><a href="#/card/${card.id}?${from}">
    <span class="wrong-q">${esc(q)}</span>
    <span class="wrong-a">${esc(a)}</span>
    ${word ? `<span class="muted small">${esc(dirLabel(card, w.dir))}</span>` : ''}
  </a></li>`;
}

// The numbers and the "got wrong" list, shared by the end of a session and the history.
// from: query string for the card editor's back link.
export function summaryHtml(sum, { from, practice = false, totals = true } = {}) {
  if (!sum.cards && !sum.followupsWrong.length) return '';
  const pct = sum.cards ? Math.round((sum.rightFirstTime / sum.cards) * 100) : 0;
  const followups = sum.followupsWrong.map(f => {
    const card = store.cards.get(f.card);
    return card && !card.deleted ? wrongItem({ ...f, prompt: 0 }, from) : '';
  }).join('');
  return `<section class="session-summary">
    ${totals ? `<p class="big-number">${sum.cards}</p><p class="muted">${sum.cards === 1 ? 'card' : 'cards'} reviewed · ${formatDuration(sum.ms)}</p>` : ''}
    ${sum.cards ? `<p class="first-time"><strong>${sum.rightFirstTime}</strong> right first time (${pct}%)</p>` : ''}
    ${sum.wrong.length ? `
      <h2>Got wrong</h2>
      <ul class="list wrong-list">${sum.wrong.map(w => wrongItem(w, from)).join('')}</ul>
      ${practice ? `<button type="button" class="btn btn-block" data-action="practiseWrong">Practise these again</button>` : ''}`
      : sum.cards ? `<p class="muted">Nothing wrong this session.</p>` : ''}
    ${followups ? `<h3>Linked-word checks missed</h3><ul class="list wrong-list">${followups}</ul>` : ''}
  </section>`;
}

const timeOf = iso => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function dayHeading(day) {
  const today = dayStart().getTime();
  if (day === today) return 'Today';
  if (day === periodStart(2).getTime()) return 'Yesterday';
  return new Date(day).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function listScreen() {
  const reviews = [...store.reviews.values()];
  const all = listSessions(reviews);
  const cutoff = periodStart(shownDays).toISOString();
  const shown = all.filter(s => s.start >= cutoff);
  const older = all.length > shown.length;
  const week = recentMistakes(reviews, store.cards, { days: 7 });
  const month = recentMistakes(reviews, store.cards, { days: 30 });

  const byDay = new Map();
  for (const s of shown) {
    const day = dayStart(new Date(s.start)).getTime();
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(s);
  }
  const days = [...byDay].map(([day, list]) => `
    <h3 class="day-head">${esc(dayHeading(day))}</h3>
    <ul class="list sessions">${list.map(s => {
      const sum = summariseSession(s.reviews);
      const themes = sessionThemes(s.reviews).join(', ');
      return `<li><a class="session-row" href="#/sessions/${encodeURIComponent(s.id)}">
        <span class="grow">
          <span class="session-title">${timeOf(s.start)}${themes ? ` · ${esc(themes)}` : ''}</span>
          <span class="muted small">${plural(sum.cards, 'card')} · ${formatDuration(sum.ms)} · ${sum.wrongCards ? `${sum.wrongCards} wrong` : 'none wrong'} · ${esc(deviceLabel(s.device))}</span>
        </span><span class="chev" aria-hidden="true">›</span></a></li>`;
    }).join('')}</ul>`).join('');

  const btn = (days, list) => `<button type="button" class="btn btn-secondary btn-grow" data-action="practiseRecent" data-days="${days}" ${list.length ? '' : 'disabled'}>Last ${days} days (${list.length})</button>`;
  return `
    ${header('Past sessions', { back: '#/home' })}
    <main class="page">
      <section class="practise-mistakes">
        <h2>Practise mistakes</h2>
        <p class="muted small">Cards you rated Again. Practice doesn't change your schedule.</p>
        <div class="row">${btn(7, week)}${btn(30, month)}</div>
      </section>
      ${days || `<p class="muted">Your sessions will appear here after your next review.</p>`}
      ${older ? `<button type="button" class="btn btn-secondary btn-block" data-action="older">Show older</button>` : ''}
    </main>`;
}

function detailScreen(id) {
  const s = listSessions([...store.reviews.values()].filter(r => r.session === id))[0];
  if (!s) return `${header('Session', { back: '#/sessions' })}<main class="page"><p>This session isn't on this device.</p></main>`;
  const sum = summariseSession(s.reviews);
  const day = dayHeading(dayStart(new Date(s.start)).getTime());
  const themes = sessionThemes(s.reviews).join(', ');
  return `
    ${header(`${day}, ${timeOf(s.start)}`, { back: '#/sessions' })}
    <main class="page">
      <p class="muted small center">${themes ? `${esc(themes)} · ` : ''}${esc(deviceLabel(s.device))}</p>
      ${summaryHtml(sum, { from: `from=sessions&s=${encodeURIComponent(id)}` })}
    </main>`;
}

export function sessionsView(params, rest) {
  const id = rest[0] ? decodeURIComponent(rest[0]) : null;
  return {
    html: id ? detailScreen(id) : listScreen(),
    live: true,
    tab: 'home',
    actions: {
      older() {
        shownDays += 30;
        render();
      },
      practiseRecent(el) {
        const days = Number(el.dataset.days);
        startPractice(recentMistakes([...store.reviews.values()], store.cards, { days }), { back: '#/sessions', title: `Mistakes · ${days} days` });
      },
    },
  };
}
