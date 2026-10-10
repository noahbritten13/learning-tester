// Scheduling with FSRS (ts-fsrs). A card's schedule is never stored: it is
// worked out by replaying the card's review log, so reviews made offline on
// different devices always combine into the right answer.

import { fsrs, generatorParameters, createEmptyCard, Rating, State } from '../vendor/ts-fsrs.mjs';
import { dayStart, nextDayStart, shuffle, interleave } from './util.js';

export { Rating, State };

export const DEFAULT_SETTINGS = {
  retention: 0.9,
  newPerDay: 20,
  maxReviewsPerDay: 200,
  learningSteps: ['1m', '10m'],
  relearningSteps: ['10m'],
  fuzz: true,
  maxIntervalDays: 36500,
  strictAccents: false,
};

// Cards still in learning can be shown up to this early if nothing else is waiting.
export const LEARN_AHEAD_MS = 20 * 60 * 1000;

export function makeScheduler(settings = {}) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  return fsrs(generatorParameters({
    request_retention: s.retention,
    maximum_interval: s.maxIntervalDays,
    enable_fuzz: s.fuzz,
    enable_short_term: true,
    learning_steps: s.learningSteps,
    relearning_steps: s.relearningSteps,
  }));
}

// Which log entries change the schedule. Follow-up checks only count when
// they were wrong (decision E): right answers leave the schedule alone.
export function affectsSchedule(review) {
  if (review.kind === 'followup') return review.rating === Rating.Again;
  return true;
}

export function sortReviews(list) {
  return list.slice().sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id < b.id ? -1 : 1));
}

// Replays one card's history. Returns its current FSRS state plus counts
// used for daily limits.
export function replayCard(card, reviews, f, since = null) {
  let state = createEmptyCard(new Date(card.created ?? 0));
  let firstReviewTs = null;
  let reviewCardsSince = 0; // reviews of already-learnt cards since `since`
  let shownCount = 0;
  for (const r of sortReviews(reviews)) {
    shownCount++;
    if (!affectsSchedule(r)) continue;
    const when = new Date(r.ts);
    if (since && when >= since && state.state === State.Review) reviewCardsSince++;
    try {
      state = f.next(state, when, r.rating).card;
      firstReviewTs ??= r.ts;
    } catch {
      // A malformed entry shouldn't break the whole card; skip it.
    }
  }
  return { state, firstReviewTs, reviewCardsSince, shownCount };
}

export function computeStates(cards, reviewsByCard, f, now = new Date()) {
  const since = dayStart(now);
  const states = new Map();
  for (const card of cards) {
    states.set(card.id, replayCard(card, reviewsByCard.get(card.id) ?? [], f, since));
  }
  return states;
}

export const isActive = c => !c.deleted && c.status !== 'archived';

// Counts and the ordered list of cards to show in a session.
// themeIds: null for everything, or an array of theme ids.
export function buildQueue({ cards, states, settings, themeIds = null, now = new Date() }) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const since = dayStart(now);

  // Daily limits are shared across themes, like a single Anki collection.
  let newToday = 0, reviewsToday = 0;
  for (const c of cards) {
    const st = states.get(c.id);
    if (!st) continue;
    if (st.firstReviewTs && new Date(st.firstReviewTs) >= since) newToday++;
    reviewsToday += st.reviewCardsSince;
  }

  const inScope = cards.filter(c => isActive(c) && (!themeIds || themeIds.includes(c.theme)));
  const learning = [], waiting = [], review = [], fresh = [];
  for (const c of inScope) {
    const st = states.get(c.id)?.state;
    if (!st) continue;
    const due = new Date(st.due);
    if (st.state === State.New) fresh.push(c);
    else if (st.state === State.Review) { if (due <= now) review.push(c); }
    else if (due <= now) learning.push(c);
    // Cards still being learnt that come back within a few minutes count as due,
    // but wait their turn in the session.
    else if (due - now <= LEARN_AHEAD_MS) waiting.push({ id: c.id, due });
  }

  const reviewRoom = Math.max(0, s.maxReviewsPerDay - reviewsToday);
  const newRoom = Math.max(0, s.newPerDay - newToday);
  const dueReviews = review
    .sort((a, b) => new Date(states.get(a.id).state.due) - new Date(states.get(b.id).state.due))
    .slice(0, reviewRoom);
  const newCards = fresh
    .sort((a, b) => (a.created < b.created ? -1 : a.created > b.created ? 1 : 0))
    .slice(0, newRoom);

  // Mixed order: learning cards first (they're time-sensitive), then
  // reviews shuffled across themes with new cards spread among them.
  const order = [...shuffle(learning), ...interleave(shuffle(dueReviews), newCards)];
  return {
    ids: order.map(c => c.id),
    later: waiting,
    counts: { learning: learning.length + waiting.length, review: dueReviews.length, new: newCards.length },
    totals: { reviewsToday, newToday, reviewWaiting: review.length, newWaiting: fresh.length },
  };
}

// Due counts for the home screen: what "Review all" would show, and what
// reviewing each theme on its own would show (daily limits still apply).
export function dueByTheme({ cards, states, settings, now = new Date() }) {
  const all = buildQueue({ cards, states, settings, now });
  const out = new Map();
  for (const theme of new Set(cards.map(c => c.theme))) {
    const q = buildQueue({ cards, states, settings, themeIds: [theme], now });
    out.set(theme, { due: q.counts.learning + q.counts.review, new: q.counts.new });
  }
  return { byTheme: out, total: all.counts };
}

// What each rating would do, for the labels on the rating buttons.
export function previewRatings(state, f, now = new Date()) {
  const rec = f.repeat(state, now);
  const out = {};
  for (const r of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]) {
    out[r] = new Date(rec[r].card.due) - now;
  }
  return out;
}

// A review session: a fixed queue plus cards in learning that come back
// a few minutes later.
export class Session {
  constructor(ids, { now = new Date(), later = [] } = {}) {
    this.queue = ids.slice();
    this.later = later.slice(); // { id, due }: cards in learning coming back soon
    this.done = 0;
    this.lastId = null;
    this.dayEnd = nextDayStart(now);
  }

  next(now = new Date()) {
    this.later.sort((a, b) => a.due - b.due);
    const dueLater = this.later[0] && this.later[0].due <= now ? this.later[0] : null;
    let id = null;
    if (dueLater) {
      id = dueLater.id;
    } else if (this.queue.length) {
      id = this.queue[0];
    } else if (this.later[0] && this.later[0].due - now <= LEARN_AHEAD_MS) {
      id = this.later[0].id;
    }
    // Avoid showing the same card twice in a row when there's an alternative.
    if (id && id === this.lastId && this.queue.length && this.queue[0] !== id) id = this.queue[0];
    return id;
  }

  // Remove a card from everything waiting (after rating, archiving or editing out).
  take(id) {
    this.queue = this.queue.filter(x => x !== id);
    this.later = this.later.filter(x => x.id !== id);
  }

  answered(id, newState) {
    this.take(id);
    this.done++;
    this.lastId = id;
    const due = new Date(newState.due);
    if (newState.state !== State.Review && due < this.dayEnd) this.later.push({ id, due });
  }

  get remaining() {
    return this.queue.length + this.later.length;
  }

  nextLaterDue() {
    return this.later.length ? new Date(Math.min(...this.later.map(x => +x.due))) : null;
  }
}

// Which wording to show: rotate through a card's alternatives.
export function promptIndex(card, shownCount) {
  const n = card.prompts?.length || 1;
  return shownCount % n;
}
