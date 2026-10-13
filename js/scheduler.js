// Scheduling with FSRS (ts-fsrs). A card's schedule is never stored: it is
// worked out by replaying the card's review log, so reviews made offline on
// different devices always combine into the right answer.

import { fsrs, generatorParameters, createEmptyCard, Rating, State } from '../vendor/ts-fsrs.mjs';
import { dayStart, nextDayStart, shuffle, interleave } from './util.js';
import { inThemes } from './model.js';

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

// Word cards have two schedules, one per direction. A schedule is identified
// by a key: the card id for word → meaning (and every other card), and
// "<id>@r" for meaning → word. Reviews say which with `dir: "rev"`.
const REV = '@r';
export const schedKey = (id, dir) => (dir === 'rev' ? id + REV : id);
export const parseKey = key => (key.endsWith(REV) ? { id: key.slice(0, -REV.length), dir: 'rev' } : { id: key, dir: 'fwd' });
export const reviewKey = r => schedKey(r.card, r.dir);
export const keysOf = card => (card.type === 'word' ? [card.id, card.id + REV] : [card.id]);

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
  let lastTs = null; // the latest normal review (not follow-ups)
  for (const r of sortReviews(reviews)) {
    shownCount++;
    if (r.kind !== 'followup') lastTs = r.ts;
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
  return { state, firstReviewTs, reviewCardsSince, shownCount, lastTs };
}

// reviewsByKey: Map of schedule key -> reviews. Returns Map of schedule key -> state.
export function computeStates(cards, reviewsByKey, f, now = new Date()) {
  const since = dayStart(now);
  const states = new Map();
  for (const card of cards) {
    for (const key of keysOf(card)) states.set(key, replayCard(card, reviewsByKey.get(key) ?? [], f, since));
  }
  return states;
}

export const isActive = c => !c.deleted && c.status !== 'archived';

// Counts and the ordered list of schedule keys to show in a session.
// themeIds: null for everything, or an array of theme ids.
// dirOf(card): for word cards, 'fwd' (word → meaning), 'rev' (meaning → word)
// or 'mixed' (the default). In mixed mode a word is only asked one way per
// day: if both directions are due, one is picked and the other waits.
export function buildQueue({ cards, states, settings, themeIds = null, now = new Date(), dirOf = () => 'mixed' }) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const since = dayStart(now);
  const sinceIso = since.toISOString();

  // Daily limits are shared across themes, like a single Anki collection.
  let newToday = 0, reviewsToday = 0;
  for (const c of cards) {
    for (const key of keysOf(c)) {
      const st = states.get(key);
      if (!st) continue;
      if (st.firstReviewTs && new Date(st.firstReviewTs) >= since) newToday++;
      reviewsToday += st.reviewCardsSince;
    }
  }

  // Where a schedule stands now: learning (due), waiting (learning, back soon), review (due), fresh, or null.
  const where = st => {
    if (!st) return null;
    const due = new Date(st.due);
    if (st.state === State.New) return 'fresh';
    if (st.state === State.Review) return due <= now ? 'review' : null;
    if (due <= now) return 'learning';
    return due - now <= LEARN_AHEAD_MS ? 'waiting' : null;
  };
  const rank = { learning: 0, waiting: 1, review: 2, fresh: 3 };
  const reviewedToday = key => (states.get(key)?.lastTs ?? '') >= sinceIso;

  const inScope = cards.filter(c => isActive(c) && (!themeIds || inThemes(c, themeIds)));
  const learning = [], waiting = [], review = [], fresh = [];
  for (const c of inScope) {
    let keys = [c.id];
    if (c.type === 'word') {
      const [fwd, rev] = keysOf(c);
      const mode = dirOf(c);
      if (mode === 'fwd') keys = [fwd];
      else if (mode === 'rev') keys = [rev];
      else {
        // Mixed: skip a direction if the other was asked today and this one wasn't.
        keys = [fwd, rev].filter(k => !(reviewedToday(k === fwd ? rev : fwd) && !reviewedToday(k)));
        const placed = keys.map(k => ({ k, w: where(states.get(k)?.state) })).filter(x => x.w);
        if (placed.length > 1) {
          placed.sort((a, b) => rank[a.w] - rank[b.w] || Math.random() - 0.5);
          keys = [placed[0].k];
        }
      }
    }
    for (const key of keys) {
      const st = states.get(key)?.state;
      const w = where(st);
      if (w === 'fresh') fresh.push({ key, c });
      else if (w === 'review') review.push({ key, c, due: new Date(st.due) });
      else if (w === 'learning') learning.push({ key, c });
      // Cards still being learnt that come back within a few minutes count as due,
      // but wait their turn in the session.
      else if (w === 'waiting') waiting.push({ id: key, due: new Date(st.due) });
    }
  }

  const reviewRoom = Math.max(0, s.maxReviewsPerDay - reviewsToday);
  const newRoom = Math.max(0, s.newPerDay - newToday);
  const dueReviews = review.sort((a, b) => a.due - b.due).slice(0, reviewRoom);
  const newCards = fresh
    .sort((a, b) => (a.c.created < b.c.created ? -1 : a.c.created > b.c.created ? 1 : a.key < b.key ? -1 : 1))
    .slice(0, newRoom);

  // Mixed order: learning cards first (they're time-sensitive), then
  // reviews shuffled across themes with new cards spread among them.
  const order = [...shuffle(learning), ...interleave(shuffle(dueReviews), newCards)];
  return {
    ids: order.map(x => x.key),
    later: waiting,
    counts: { learning: learning.length + waiting.length, review: dueReviews.length, new: newCards.length },
    totals: { reviewsToday, newToday, reviewWaiting: review.length, newWaiting: fresh.length },
  };
}

// Due counts for the home screen: what "Review all" would show, and what
// reviewing each theme on its own would show (daily limits still apply).
export function dueByTheme({ cards, states, settings, now = new Date(), dirOf }) {
  const all = buildQueue({ cards, states, settings, now, dirOf });
  const out = new Map();
  for (const theme of new Set(cards.flatMap(c => [c.theme, ...(c.also_in ?? [])]))) {
    const q = buildQueue({ cards, states, settings, themeIds: [theme], now, dirOf });
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

  // A card got wrong outside its normal turn (a linked-word check): if it's
  // now being relearnt, bring it back later in this session.
  relearn(id, newState) {
    if (this.queue.includes(id)) return;
    this.later = this.later.filter(x => x.id !== id);
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
