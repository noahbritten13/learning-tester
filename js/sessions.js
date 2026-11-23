// Review sessions, worked out from the review log (spec 02). Each review
// written during a session carries the same `session` id, so nothing about a
// session is stored separately and the numbers always match the review history.
// Pure functions: no DOM, no store, so they are easy to test.

import { Rating, reviewKey, isActive } from './scheduler.js';
import { dayStart } from './util.js';

export const newSessionId = deviceId => `${deviceId}-s-${Math.random().toString(36).slice(2, 6)}`;

// A device id is "<name>-<4 chars>", e.g. "iphone-ab12" → "iphone".
export const deviceLabel = id => String(id ?? '').replace(/-[a-z0-9]{4}$/, '');

const byTime = (a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id < b.id ? -1 : 1);

// All tagged sessions, newest first: [{ id, device, start, end, reviews }].
// Reviews without a `session` field (from before this feature) are skipped.
export function listSessions(reviews) {
  const groups = new Map();
  for (const r of reviews) {
    if (!r.session) continue;
    if (!groups.has(r.session)) groups.set(r.session, []);
    groups.get(r.session).push(r);
  }
  const out = [...groups].map(([id, list]) => {
    list.sort(byTime);
    return { id, device: list[0].device, start: list[0].ts, end: list[list.length - 1].ts, reviews: list };
  });
  return out.sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0));
}

// One session's numbers, from its review lines.
//   cards:  different cards answered in normal reviews (both directions of a word = one card)
//   ms:     time spent on all its reviews (each already capped)
//   wrong:  cards whose first normal review in the session was Again
//   followupsWrong: linked-word checks rated Again
export function summariseSession(reviews) {
  const list = reviews.slice().sort(byTime);
  const cards = new Set();
  const firstByKey = new Map();
  const followupsWrong = [];
  let ms = 0;
  for (const r of list) {
    ms += r.ms ?? 0;
    if (r.kind === 'followup') {
      if (r.rating === Rating.Again) followupsWrong.push({ card: r.card, key: reviewKey(r), dir: r.dir === 'rev' ? 'rev' : 'fwd' });
      continue;
    }
    cards.add(r.card);
    const key = reviewKey(r);
    if (!firstByKey.has(key)) firstByKey.set(key, r);
  }
  const wrongCards = new Set();
  const wrong = [];
  for (const [key, r] of firstByKey) {
    if (r.rating !== Rating.Again) continue;
    wrong.push({ card: r.card, key, prompt: r.prompt ?? 0, dir: r.dir === 'rev' ? 'rev' : 'fwd' });
    wrongCards.add(r.card);
  }
  return {
    start: list[0]?.ts ?? null,
    end: list[list.length - 1]?.ts ?? null,
    device: list[0]?.device ?? null,
    cards: cards.size,
    ms,
    wrong,
    wrongCards: wrongCards.size,
    rightFirstTime: cards.size - wrongCards.size,
    followupsWrong,
  };
}

// The first learning day (4 am) of the last `days` days, today included.
export function periodStart(days, now = new Date()) {
  const d = dayStart(now);
  d.setDate(d.getDate() - (days - 1));
  return d;
}

// Cards rated Again in the last `days` learning days, from all review history
// (tagged or not). One entry per schedule key, so a word card is practised in
// the direction(s) it was got wrong. Archived and deleted cards are left out.
export function recentMistakes(reviews, cardsById, { days, now = new Date() }) {
  const since = periodStart(days, now).toISOString();
  const nowIso = now.toISOString();
  const misses = new Map();
  for (const r of reviews) {
    if (r.rating !== Rating.Again || r.ts < since || r.ts > nowIso) continue;
    const card = cardsById.get(r.card);
    if (!card || !isActive(card) || (r.dir === 'rev' && card.type !== 'word')) continue;
    const key = reviewKey(r);
    const m = misses.get(key) ?? { key, card: r.card, dir: r.dir === 'rev' ? 'rev' : 'fwd', misses: 0 };
    m.misses++;
    misses.set(key, m);
  }
  return [...misses.values()];
}
