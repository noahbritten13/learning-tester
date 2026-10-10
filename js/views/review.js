import { store } from '../store.js';
import { buildQueue, Session, previewRatings, promptIndex, isActive, Rating, State } from '../scheduler.js';
import { checkAnswer, isRight } from '../match.js';
import { formatInterval, formatDuration, formatRelative } from '../util.js';
import { esc, multiline, go, render, toast } from '../ui.js';
import { todayPanel } from './home.js';

const MAX_MS = 5 * 60 * 1000; // ignore time beyond 5 minutes on one card (you probably walked away)
let rv = null;
let waitTimer = null;

function start(themeIds) {
  store.refreshIfNewDay();
  const q = buildQueue({ cards: store.liveCards(), states: store.states, settings: store.settings, themeIds });
  rv = { session: new Session(q.ids, { later: q.later }), themeIds, current: null, ms: 0, started: q.ids.length + q.later.length > 0 };
  advance();
}

function advance(force = false) {
  const s = rv.session;
  let id = s.next(new Date());
  if (!id && force && s.later.length) id = s.later.sort((a, b) => a.due - b.due)[0].id;
  if (!id) {
    rv.current = null;
    return;
  }
  const card = store.cards.get(id);
  if (!card || !isActive(card)) {
    s.take(id);
    return advance(force);
  }
  const st = store.cardState(id);
  rv.current = {
    id,
    prompt: promptIndex(card, st.shownCount),
    shownAt: Date.now(),
    phase: 'ask',
    typed: '',
    result: null,
    overridden: false,
    menu: false,
    isNew: st.state.state === State.New,
  };
}

function ratingButtons(ratings, previews) {
  const names = { [Rating.Again]: 'Again', [Rating.Hard]: 'Hard', [Rating.Good]: 'Good', [Rating.Easy]: 'Easy' };
  const cls = { [Rating.Again]: 'again', [Rating.Hard]: 'hard', [Rating.Good]: 'good', [Rating.Easy]: 'easy' };
  return `<div class="ratings ratings-${ratings.length}">${ratings.map(r => `
    <button type="button" class="rate rate-${cls[r]}" data-action="rate" data-rating="${r}">
      <span>${names[r]}</span><small>${formatInterval(previews[r])}</small>
    </button>`).join('')}</div>`;
}

function cardScreen() {
  const cur = rv.current;
  const card = store.cards.get(cur.id);
  const prompt = card.prompts[cur.prompt] ?? card.prompts[0];
  const exact = card.type === 'exact';
  const chips = [
    `<span class="chip">${esc(store.themeName(card.theme))}</span>`,
    cur.isNew ? '<span class="chip chip-new">New</span>' : '',
    card.unverified ? '<span class="chip chip-warn" title="Not yet verified">Unverified</span>' : '',
  ].join('');

  let body;
  if (cur.phase === 'ask') {
    body = `
      <form class="answer-form" data-submit="check" autocomplete="off">
        ${exact
          ? `<input class="answer-input" name="answer" type="text" placeholder="Type the answer" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="done">`
          : `<textarea class="answer-input" name="answer" rows="3" placeholder="Type your answer"></textarea>`}
        <div class="row">
          <button type="submit" class="btn btn-grow">Check</button>
          <button type="button" class="btn btn-secondary" data-action="showOnly">${exact ? "I don't know" : 'Just show me'}</button>
        </div>
      </form>`;
  } else {
    const typed = cur.typed.trim();
    let verdict = '';
    let ratings;
    if (exact) {
      const right = isRight(cur.result.result) || cur.overridden;
      if (cur.overridden) verdict = `<div class="verdict ok">Marked as right</div>`;
      else if (cur.result.result === 'correct') verdict = `<div class="verdict ok">✓ Correct</div>`;
      else if (cur.result.result === 'accent') verdict = `<div class="verdict ok">✓ Accepted. Correct spelling: <strong>${esc(cur.result.expected)}</strong></div>`;
      else if (cur.result.result === 'blank') verdict = `<div class="verdict bad">Not answered</div>`;
      else verdict = `<div class="verdict bad">✗ Not quite</div>`;
      ratings = right ? [Rating.Hard, Rating.Good, Rating.Easy] : [Rating.Again];
    } else {
      ratings = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];
    }
    const others = exact && card.accept.length ? `<div class="muted small">Also accepted: ${card.accept.map(esc).join(', ')}</div>` : '';
    body = `
      ${verdict}
      <div class="compare">
        ${typed ? `<div class="compare-box"><div class="label">Your answer</div><div>${multiline(typed)}</div></div>` : ''}
        <div class="compare-box model"><div class="label">Answer</div><div>${multiline(card.answer)}</div>${others}</div>
      </div>
      ${card.source ? `<p class="muted small">Source: ${esc(card.source)}</p>` : ''}
      ${ratingButtons(ratings, cur.previews)}
      ${exact && !isRight(cur.result.result) && !cur.overridden && cur.result.result !== 'blank'
        ? `<button type="button" class="link center-block" data-action="override">I was actually right</button>` : ''}`;
  }

  return `
    <header class="bar review-bar">
      <a class="bar-back" href="#/home" aria-label="End session">✕</a>
      <h1>${rv.session.remaining} left</h1>
      <div class="bar-right"><button type="button" class="icon-btn" data-action="menu" aria-label="Card options">⋯</button></div>
    </header>
    ${cur.menu ? `<div class="menu">
      <a href="#/card/${card.id}?from=review">Edit card</a>
      <button type="button" data-action="toggleUnverified">${card.unverified ? 'Mark as verified' : 'Mark as unverified'}</button>
      <button type="button" data-action="archive">Archive card</button>
    </div>` : ''}
    <main class="page review">
      <div class="chips">${chips}</div>
      <div class="prompt">${multiline(prompt)}</div>
      ${body}
    </main>`;
}

function finishedScreen() {
  const later = rv.session.nextLaterDue();
  const reviewed = rv.session.done;
  let html;
  if (later) {
    html = `
      <h2>Nothing else due right now</h2>
      <p>${rv.session.later.length} card${rv.session.later.length === 1 ? '' : 's'} you're still learning come${rv.session.later.length === 1 ? 's' : ''} back ${formatRelative(later)}.</p>
      <div class="row"><button type="button" class="btn" data-action="showNow">Show now</button><a class="btn btn-secondary" href="#/home">Finish</a></div>`;
  } else if (!rv.started) {
    html = `<h2>Nothing due</h2><p>There are no cards to review here right now.</p><a class="btn" href="#/home">Back</a>`;
  } else {
    html = `<h2>Session complete</h2><a class="btn" href="#/home">Done</a>`;
  }
  return `
    <header class="bar"><a class="bar-back" href="#/home" aria-label="Home">✕</a><h1>Review</h1><span class="bar-spacer"></span></header>
    <main class="page center">
      ${reviewed ? `<p class="big-number">${reviewed}</p><p class="muted">card${reviewed === 1 ? '' : 's'} reviewed · ${formatDuration(rv.ms)}</p>` : ''}
      ${html}
      ${todayPanel()}
    </main>`;
}

function focusAnswer() {
  const input = document.querySelector('.answer-input');
  if (input) input.focus({ preventScroll: true });
}

function rate(rating) {
  const cur = rv.current;
  const ms = Math.min(Date.now() - cur.shownAt, MAX_MS);
  // addReview updates memory straight away; saving to storage finishes in the background.
  store.addReview({ card: cur.id, rating, ms, prompt: cur.prompt }).catch(e => toast(`Couldn't save: ${e.message}`));
  rv.ms += ms;
  rv.session.answered(cur.id, store.cardState(cur.id).state);
  advance();
  render();
  focusAnswer();
  if (!rv.current && store.github) store.sync().catch(() => {});
}

export function reviewView(params) {
  if (params.start) {
    start(params.start === 'all' ? null : params.start.split(','));
    history.replaceState(null, '', '#/review');
  } else if (!rv) {
    start(null);
  } else if (rv.current && !isActive(store.cards.get(rv.current.id) ?? { deleted: true })) {
    rv.session.take(rv.current.id);
    advance();
  }

  clearInterval(waitTimer);
  if (!rv.current && rv.session.later.length) {
    // Check every 15 seconds for learning cards coming back.
    waitTimer = setInterval(() => {
      if (!location.hash.startsWith('#/review')) return clearInterval(waitTimer);
      if (rv.session.next(new Date())) {
        clearInterval(waitTimer);
        advance();
        render();
      }
    }, 15000);
  }

  const cur = rv.current;
  return {
    html: cur ? cardScreen() : finishedScreen(),
    step: cur?.id ?? 'done',
    hideTabs: !!cur,
    tab: 'home',
    mount() {
      if (cur?.phase === 'ask') {
        const input = document.querySelector('.answer-input');
        if (cur.typed) input.value = cur.typed;
        if (!matchMedia('(pointer: coarse)').matches) focusAnswer();
      }
    },
    actions: {
      check(form) {
        cur.typed = form.answer.value;
        reveal(false);
      },
      showOnly() {
        cur.typed = document.querySelector('.answer-input')?.value ?? '';
        reveal(true);
      },
      rate(el) {
        rate(Number(el.dataset.rating));
      },
      override() {
        cur.overridden = true;
        render();
      },
      menu() {
        cur.menu = !cur.menu;
        render();
      },
      async toggleUnverified() {
        const card = store.cards.get(cur.id);
        cur.menu = false;
        await store.updateCard(cur.id, { unverified: !card.unverified });
        render();
      },
      async archive() {
        const id = cur.id;
        await store.archiveCard(id);
        rv.session.take(id);
        advance();
        render();
        toast('Card archived.', {
          label: 'Undo',
          run: async () => {
            await store.restoreCard(id);
            rv.session.queue.unshift(id);
            advance();
            render();
          },
        });
      },
      showNow() {
        advance(true);
        render();
        focusAnswer();
      },
    },
    onKey(e) {
      if (!cur || !location.hash.startsWith('#/review')) return;
      const inField = e.target.matches?.('textarea, input');
      if (cur.phase === 'ask') {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && inField) {
          e.preventDefault();
          cur.typed = e.target.value;
          reveal(false);
        }
        return;
      }
      if (inField) return;
      const shown = [...document.querySelectorAll('[data-action="rate"]')].map(b => Number(b.dataset.rating));
      if (['1', '2', '3', '4'].includes(e.key) && shown.includes(Number(e.key))) {
        e.preventDefault();
        rate(Number(e.key));
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        rate(shown.includes(Rating.Good) ? Rating.Good : shown[0]);
      }
    },
  };

  function reveal(showOnly) {
    const card = store.cards.get(cur.id);
    cur.phase = 'answer';
    if (card.type === 'exact') {
      cur.result = showOnly
        ? { result: 'blank', expected: card.answer }
        : checkAnswer(cur.typed, [card.answer, ...card.accept], { strictAccents: store.settings.strictAccents });
    }
    cur.previews = previewRatings(store.cardState(cur.id).state, store.f, new Date());
    render();
    document.activeElement?.blur?.();
  }
}
