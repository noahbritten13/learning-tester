import { store } from '../store.js';
import { buildQueue, Session, previewRatings, promptIndex, isActive, Rating, State, parseKey, schedKey, keysOf } from '../scheduler.js';
import { checkAnswer, checkMeaning, splitMeanings, isRight } from '../match.js';
import { formatInterval, formatDuration, formatRelative } from '../util.js';
import { esc, multiline, go, render, toast } from '../ui.js';
import { todayPanel } from './home.js';

const MAX_MS = 5 * 60 * 1000; // ignore time beyond 5 minutes on one card (you probably walked away)
let rv = null;
let waitTimer = null;

function start(themeIds) {
  store.refreshIfNewDay();
  // Reviewing a theme includes its sub-themes.
  if (themeIds) themeIds = [...new Set(themeIds.flatMap(id => store.themeScope(id)))];
  const q = buildQueue({ cards: store.liveCards(), states: store.states, settings: store.settings, themeIds, dirOf: store.dirOf });
  rv = { session: new Session(q.ids, { later: q.later }), themeIds, current: null, ms: 0, started: q.ids.length + q.later.length > 0 };
  advance();
}

function advance(force = false) {
  const s = rv.session;
  let key = s.next(new Date());
  if (!key && force && s.later.length) key = s.later.sort((a, b) => a.due - b.due)[0].id;
  if (!key) {
    rv.current = null;
    return;
  }
  const { id, dir } = parseKey(key);
  const card = store.cards.get(id);
  if (!card || !isActive(card) || (dir === 'rev' && card.type !== 'word')) {
    s.take(key);
    return advance(force);
  }
  const st = store.cardState(key);
  rv.current = {
    key,
    id,
    dir,
    prompt: card.type === 'word' ? 0 : promptIndex(card, st.shownCount),
    shownAt: Date.now(),
    phase: 'ask',
    typed: '',
    result: null,
    overridden: false,
    menu: false,
    isNew: st.state.state === State.New,
    fu: null,  // testing linked words
    own: null, // typing your own related words
  };
}

// ---------- Words ----------

const language = card => store.themeLanguage(card.theme) || 'Word';
const dirLabel = (card, dir) => (dir === 'rev' ? `English → ${language(card)}` : `${language(card)} → English`);
const wordPrompt = (card, dir) => (dir === 'rev' ? card.answer : card.prompts[0]);

// Marks a typed answer to a word card in either direction.
function markWord(card, dir, typed, showOnly) {
  const strictAccents = store.settings.strictAccents;
  if (showOnly) return { result: 'blank', expected: '' };
  if (dir === 'fwd') return checkMeaning(typed, [...splitMeanings(card.answer), ...card.accept], { strictAccents });
  const r = checkAnswer(typed, card.prompts, { strictAccents });
  if (isRight(r.result) || r.result === 'blank') return r;
  // Another of your words with the same meaning also counts (e.g. echar for "to throw").
  for (const other of store.synonyms(card)) {
    const o = checkAnswer(typed, other.prompts, { strictAccents });
    if (isRight(o.result)) return { result: 'synonym', expected: card.prompts[0], other };
  }
  return r;
}

const wordRight = (res, overridden) => overridden || isRight(res.result) || res.result === 'synonym';

function verdictHtml(res, overridden, card, dir) {
  if (overridden) return `<div class="verdict ok">Marked as right</div>`;
  if (res.result === 'correct') return `<div class="verdict ok">✓ Correct</div>`;
  if (res.result === 'accent') return `<div class="verdict ok">✓ Accepted. Correct spelling: <strong>${esc(res.expected)}</strong></div>`;
  if (res.result === 'synonym') {
    return `<div class="verdict ok">✓ Also right: <strong>${esc(res.other.prompts[0])}</strong> (${esc(res.other.answer)}). This card's word is <strong>${esc(card.prompts[0])}</strong>.</div>`;
  }
  if (res.result === 'blank') return `<div class="verdict bad">Not answered</div>`;
  return `<div class="verdict bad">✗ Not quite</div>`;
}

// The full word, its meaning and its note, shown after answering in either direction.
function wordAnswerHtml(card, typed) {
  return `
    <div class="compare">
      ${typed ? `<div class="compare-box"><div class="label">Your answer</div><div>${esc(typed)}</div></div>` : ''}
      <div class="compare-box model">
        <div class="label">Answer</div>
        <div class="word-line"><strong>${esc(card.prompts[0])}</strong> = ${esc(card.answer)}</div>
        ${card.prompts.length > 1 ? `<div class="muted small">Also: ${card.prompts.slice(1).map(esc).join(', ')}</div>` : ''}
        ${card.accept.length ? `<div class="muted small">Also accepted: ${card.accept.map(esc).join(', ')}</div>` : ''}
      </div>
    </div>
    ${card.note ? `<div class="word-note">${multiline(card.note)}</div>` : ''}`;
}

const wordPlaceholder = (card, dir) => (dir === 'rev' ? `Type the ${language(card)}` : 'Type the English');

// placeholder: a one-line answer (auto-marked); none: a free answer you mark yourself.
function askForm({ placeholder = null, submit = 'check', skip = 'showOnly' }) {
  return `
    <form class="answer-form" data-submit="${submit}" autocomplete="off">
      ${placeholder
        ? `<input class="answer-input" name="answer" type="text" placeholder="${esc(placeholder)}" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="done">`
        : `<textarea class="answer-input" name="answer" rows="3" placeholder="Type your answer"></textarea>`}
      <div class="row">
        <button type="submit" class="btn btn-grow">Check</button>
        <button type="button" class="btn btn-secondary" data-action="${skip}">${placeholder ? "I don't know" : 'Just show me'}</button>
      </div>
    </form>`;
}

// ---------- Screens ----------

function ratingButtons(ratings, previews) {
  const names = { [Rating.Again]: 'Again', [Rating.Hard]: 'Hard', [Rating.Good]: 'Good', [Rating.Easy]: 'Easy' };
  const cls = { [Rating.Again]: 'again', [Rating.Hard]: 'hard', [Rating.Good]: 'good', [Rating.Easy]: 'easy' };
  return `<div class="ratings ratings-${ratings.length}">${ratings.map(r => `
    <button type="button" class="rate rate-${cls[r]}" data-action="rate" data-rating="${r}">
      <span>${names[r]}</span><small>${formatInterval(previews[r])}</small>
    </button>`).join('')}</div>`;
}

const kindLabel = kind => (kind === 'opposite' ? 'Opposite' : 'Related');

// Optional extras after answering a word: test its linked words, or type related words you know.
function wordExtras(card) {
  const links = store.linksOf(card.id);
  return `<div class="word-extras">
    ${links.length ? `<p class="muted small">Linked: ${links.map(l => `${esc(l.card.prompts[0])} <span class="muted">(${l.kind})</span>`).join(' · ')}</p>` : ''}
    <div class="row">
      ${links.length ? `<button type="button" class="btn btn-small btn-secondary" data-action="startLinked">Test linked words (${links.length})</button>` : ''}
      <button type="button" class="btn btn-small btn-secondary" data-action="startOwn">Add related words</button>
    </div>
  </div>`;
}

function mainCardScreen(cur, card) {
  const word = card.type === 'word';
  const exact = card.type === 'exact';
  const prompt = word ? wordPrompt(card, cur.dir) : card.prompts[cur.prompt] ?? card.prompts[0];
  const chips = [
    `<span class="chip">${esc(store.themeName(card.theme))}</span>`,
    word ? `<span class="chip chip-dir">${esc(dirLabel(card, cur.dir))}</span>` : '',
    cur.isNew ? '<span class="chip chip-new">New</span>' : '',
    card.unverified ? '<span class="chip chip-warn" title="Not yet verified">Unverified</span>' : '',
  ].join('');

  let body;
  if (cur.phase === 'ask') {
    body = askForm({ placeholder: word ? wordPlaceholder(card, cur.dir) : exact ? 'Type the answer' : null });
  } else {
    const typed = cur.typed.trim();
    let verdict = '';
    let ratings;
    if (word || exact) {
      const right = word ? wordRight(cur.result, cur.overridden) : isRight(cur.result.result) || cur.overridden;
      verdict = verdictHtml(cur.result, cur.overridden, card, cur.dir);
      ratings = right ? [Rating.Hard, Rating.Good, Rating.Easy] : [Rating.Again];
    } else {
      ratings = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];
    }
    const others = exact && card.accept.length ? `<div class="muted small">Also accepted: ${card.accept.map(esc).join(', ')}</div>` : '';
    const wrongShown = (word || exact) && !cur.overridden && !['correct', 'accent', 'synonym', 'blank'].includes(cur.result.result);
    body = `
      ${verdict}
      ${word ? wordAnswerHtml(card, typed) : `
      <div class="compare">
        ${typed ? `<div class="compare-box"><div class="label">Your answer</div><div>${multiline(typed)}</div></div>` : ''}
        <div class="compare-box model"><div class="label">Answer</div><div>${multiline(card.answer)}</div>${others}</div>
      </div>`}
      ${card.source ? `<p class="muted small">Source: ${esc(card.source)}</p>` : ''}
      ${ratingButtons(ratings, cur.previews)}
      ${wrongShown ? `<button type="button" class="link center-block" data-action="override">I was actually right</button>` : ''}
      ${word ? wordExtras(card) : ''}`;
  }
  return `
    <div class="chips">${chips}</div>
    <div class="prompt ${word ? 'prompt-word' : ''}">${multiline(prompt)}</div>
    ${body}`;
}

// Testing linked words, one at a time, in the same direction as the main card.
function linkedScreen(cur, card) {
  const fu = cur.fu;
  const item = fu.items[fu.i];
  const other = item.card;
  const last = fu.i === fu.items.length - 1;
  const chips = `
    <span class="chip chip-dir">${esc(dirLabel(other, cur.dir))}</span>
    <span class="chip">${esc(kindLabel(item.kind))} of ${esc(card.prompts[0])}</span>
    <span class="chip">${fu.i + 1} of ${fu.items.length}</span>`;
  let body;
  if (fu.phase === 'ask') {
    body = askForm({ placeholder: wordPlaceholder(other, cur.dir), submit: 'fuCheck', skip: 'fuShowOnly' });
  } else {
    const wrong = !wordRight(fu.result, fu.overridden);
    body = `
      ${verdictHtml(fu.result, fu.overridden, other, cur.dir)}
      ${wordAnswerHtml(other, fu.typed.trim())}
      ${wrong ? `<p class="muted small fu-effect">This counts as “Again” for ${esc(other.prompts[0])}, so it comes back soon.</p>` : `<p class="muted small fu-effect">Right: ${esc(other.prompts[0])}'s schedule doesn't change.</p>`}
      <div class="row"><button type="button" class="btn btn-grow" data-action="fuNext">${last ? `Back to ${esc(card.prompts[0])}` : 'Next linked word'}</button></div>
      ${wrong && fu.result.result !== 'blank' ? `<button type="button" class="link center-block" data-action="fuOverride">I was actually right</button>` : ''}`;
  }
  return `
    <div class="chips">${chips}</div>
    <div class="prompt prompt-word">${multiline(wordPrompt(other, cur.dir))}</div>
    ${body}
    <button type="button" class="link center-block" data-action="fuStop">Stop testing linked words</button>`;
}

// Typing related words you know. They're checked against your own words and never count against you.
function ownScreen(cur, card) {
  const lang = language(card);
  const rows = cur.own.results.map(r => {
    if (r.status === 'linked') return `<li><span class="ok-text">✓</span> <strong>${esc(r.card.prompts[0])}</strong> = ${esc(r.card.answer)} <span class="muted small">(already linked, ${r.kind})</span></li>`;
    if (r.status === 'same') return `<li><span class="muted">That's ${esc(card.prompts[0])} itself.</span></li>`;
    if (r.status === 'yours') {
      return `<li><span class="ok-text">✓</span> <strong>${esc(r.card.prompts[0])}</strong> = ${esc(r.card.answer)} <span class="muted small">(one of your words)</span>
        ${r.linked ? `<span class="muted small"> · linked as ${r.linked}</span>` : `<div class="row tight">
          <button type="button" class="link small" data-action="ownLink" data-id="${r.card.id}" data-kind="related">Link as related</button>
          <button type="button" class="link small" data-action="ownLink" data-id="${r.card.id}" data-kind="opposite">Link as opposite</button></div>`}</li>`;
    }
    return `<li><span class="new-text">＋</span> <strong>${esc(r.word)}</strong> <span class="muted small">is not in your cards yet. You can add it at the end of the session.</span></li>`;
  }).join('');
  return `
    <div class="chips"><span class="chip">${esc(store.themeName(card.theme))}</span></div>
    <div class="prompt prompt-word">${esc(card.prompts[0])} <span class="muted">= ${esc(card.answer)}</span></div>
    <p>Type ${esc(lang)} words you know that are related to <strong>${esc(card.prompts[0])}</strong>: opposites, similar words or words from the same family. They never count against you.</p>
    <form class="answer-form" data-submit="ownAdd" autocomplete="off">
      <input class="answer-input" name="answer" type="text" placeholder="A related ${esc(lang)} word" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="send">
      <div class="row"><button type="submit" class="btn btn-grow">Add</button></div>
    </form>
    ${rows ? `<ul class="own-results">${rows}</ul>` : ''}
    <div class="row"><button type="button" class="btn btn-secondary btn-grow" data-action="ownDone">Back to ${esc(card.prompts[0])}</button></div>`;
}

function cardScreen() {
  const cur = rv.current;
  const card = store.cards.get(cur.id);
  const inner = cur.fu ? linkedScreen(cur, card) : cur.own ? ownScreen(cur, card) : mainCardScreen(cur, card);
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
    <main class="page review">${inner}</main>`;
}

// Related words you typed that have no card yet, with a quick way to add them.
function pendingHtml() {
  const list = store.pendingWords.filter(w => store.themes.get(w.theme) && !store.themes.get(w.theme).deleted);
  if (!list.length) return '';
  return `<section class="pending">
    <h2>Words to add</h2>
    <p class="muted small">Related words you typed that aren't in your cards yet. Add the English meaning to make a card, linked to the word you were reviewing.</p>
    <ul class="list">${list.map((w, i) => {
      const from = store.cards.get(w.from);
      return `<li class="pending-item">
        <form class="form" data-submit="addPending" data-i="${i}" autocomplete="off">
          <div class="pending-head"><strong>${esc(w.word)}</strong>
            <span class="muted small">${from && !from.deleted ? `related to ${esc(from.prompts[0])} · ` : ''}${esc(store.themeName(w.theme))}</span>
            <button type="button" class="icon-btn" data-action="dismissPending" data-i="${i}" aria-label="Don't add ${esc(w.word)}">✕</button></div>
          <input name="meaning" placeholder="English meaning, e.g. to go down" autocapitalize="none">
          <input name="note" placeholder="Note (optional), e.g. o→ue">
          <div class="row">
            ${from && !from.deleted ? `<select name="kind" aria-label="Link type"><option value="related">Related</option><option value="opposite">Opposite</option></select>` : ''}
            <button type="submit" class="btn btn-small">Add card</button>
          </div>
        </form>
      </li>`;
    }).join('')}</ul>
  </section>`;
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
      ${pendingHtml()}
      ${todayPanel()}
    </main>`;
}

function focusAnswer() {
  const input = document.querySelector('.answer-input');
  if (input && !matchMedia('(pointer: coarse)').matches) input.focus({ preventScroll: true });
}

function rate(rating) {
  const cur = rv.current;
  const ms = Math.min(Date.now() - cur.shownAt, MAX_MS);
  // addReview updates memory straight away; saving to storage finishes in the background.
  store.addReview({ card: cur.id, rating, ms, prompt: cur.prompt, dir: cur.dir }).catch(e => toast(`Couldn't save: ${e.message}`));
  rv.ms += ms;
  rv.session.answered(cur.key, store.cardState(cur.key).state);
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
    rv.session.take(rv.current.key);
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
  const fuStep = cur?.fu ? `fu${cur.fu.i}` : cur?.own ? 'own' : '';
  return {
    html: cur ? cardScreen() : finishedScreen(),
    step: cur ? `${cur.key}${fuStep}` : 'done',
    hideTabs: !!cur,
    tab: 'home',
    mount() {
      const asking = cur && (cur.fu ? cur.fu.phase === 'ask' : cur.own ? true : cur.phase === 'ask');
      if (asking) {
        const input = document.querySelector('.answer-input');
        if (!cur.fu && !cur.own && cur.typed) input.value = cur.typed;
        focusAnswer();
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
        const card = store.cards.get(id);
        await store.archiveCard(id);
        keysOf(card).forEach(k => rv.session.take(k));
        advance();
        render();
        toast('Card archived.', {
          label: 'Undo',
          run: async () => {
            await store.restoreCard(id);
            rv.session.queue.unshift(cur.key);
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

      // ----- Linked words -----
      startLinked() {
        const items = store.linksOf(cur.id);
        if (!items.length) return;
        cur.fu = { items, i: 0, phase: 'ask', typed: '', result: null, overridden: false, shownAt: Date.now() };
        render();
      },
      fuCheck(form) {
        fuReveal(form.answer.value, false);
      },
      fuShowOnly() {
        fuReveal(document.querySelector('.answer-input')?.value ?? '', true);
      },
      fuOverride() {
        cur.fu.overridden = true;
        render();
      },
      fuNext() {
        fuNext();
      },
      fuStop() {
        cur.fu = null;
        render();
      },

      // ----- Your own related words -----
      startOwn() {
        cur.own = { results: [] };
        render();
      },
      async ownAdd(form) {
        const card = store.cards.get(cur.id);
        const words = form.answer.value.split(/[,;\n]/).map(w => w.trim()).filter(Boolean);
        const links = store.linksOf(card.id);
        const batch = [];
        for (const w of words) {
          const found = store.findWord(w, card.theme);
          let r;
          if (found?.id === card.id) r = { status: 'same', word: w };
          else if (found && links.some(l => l.card.id === found.id)) r = { status: 'linked', word: w, card: found, kind: links.find(l => l.card.id === found.id).kind };
          else if (found) r = { status: 'yours', word: w, card: found };
          else {
            r = { status: 'new', word: w };
            await store.addPendingWord({ word: w, theme: card.theme, also_in: card.also_in, from: card.id });
          }
          batch.push(r);
        }
        cur.own.results.unshift(...batch);
        render();
        document.querySelector('.answer-input')?.focus({ preventScroll: true });
      },
      async ownLink(el) {
        const r = cur.own.results.find(x => x.card?.id === el.dataset.id);
        await store.linkWords(cur.id, el.dataset.id, el.dataset.kind);
        if (r) r.linked = el.dataset.kind;
        render();
      },
      ownDone() {
        cur.own = null;
        render();
      },

      // ----- Words to add (end of session) -----
      async addPending(form) {
        const list = store.pendingWords.filter(w => store.themes.get(w.theme) && !store.themes.get(w.theme).deleted);
        const w = list[Number(form.dataset.i)];
        const meaning = form.meaning.value.trim();
        if (!w) return;
        if (!meaning) {
          form.meaning.focus();
          return toast('Add the English meaning first.');
        }
        const from = store.cards.get(w.from);
        const kind = form.kind?.value ?? 'related';
        const link = from && !from.deleted ? [w.from] : [];
        await store.addCards([{
          theme: w.theme, also_in: w.also_in ?? [], type: 'word', prompts: [w.word], answer: meaning, note: form.note.value.trim(), author: 'me',
          opposites: kind === 'opposite' ? link : [], related: kind === 'related' ? link : [],
        }]);
        await store.removePendingWord(w.word, w.theme);
        toast(`Added ${w.word}`);
        render();
      },
      async dismissPending(el) {
        const list = store.pendingWords.filter(w => store.themes.get(w.theme) && !store.themes.get(w.theme).deleted);
        const w = list[Number(el.dataset.i)];
        if (w) await store.removePendingWord(w.word, w.theme);
        render();
      },
    },
    onKey(e) {
      if (!cur || !location.hash.startsWith('#/review')) return;
      const inField = e.target.matches?.('textarea, input');
      if (cur.fu || cur.own) {
        if (cur.fu?.phase === 'answer' && !inField && e.key === 'Enter') {
          e.preventDefault();
          fuNext();
        }
        return;
      }
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
    if (card.type === 'word') {
      cur.result = markWord(card, cur.dir, cur.typed, showOnly);
    } else if (card.type === 'exact') {
      cur.result = showOnly
        ? { result: 'blank', expected: card.answer }
        : checkAnswer(cur.typed, [card.answer, ...card.accept], { strictAccents: store.settings.strictAccents });
    }
    cur.previews = previewRatings(store.cardState(cur.key).state, store.f, new Date());
    render();
    document.activeElement?.blur?.();
  }

  function fuReveal(typed, showOnly) {
    const fu = cur.fu;
    fu.typed = typed;
    fu.phase = 'answer';
    fu.result = markWord(fu.items[fu.i].card, cur.dir, typed, showOnly);
    render();
    document.activeElement?.blur?.();
  }

  // Record the linked word's result, then move on. Right leaves its schedule
  // alone; wrong is a real Again (decision E), so it comes back soon.
  function fuNext() {
    const fu = cur.fu;
    const other = fu.items[fu.i].card;
    const right = wordRight(fu.result, fu.overridden);
    const ms = Math.min(Date.now() - fu.shownAt, MAX_MS);
    store.addReview({ card: other.id, rating: right ? Rating.Good : Rating.Again, ms, prompt: 0, kind: 'followup', dir: cur.dir })
      .catch(e => toast(`Couldn't save: ${e.message}`));
    if (!right) rv.session.relearn(schedKey(other.id, cur.dir), store.cardState(schedKey(other.id, cur.dir)).state);
    if (fu.i < fu.items.length - 1) {
      Object.assign(fu, { i: fu.i + 1, phase: 'ask', typed: '', result: null, overridden: false, shownAt: Date.now() });
    } else {
      cur.fu = null;
    }
    render();
  }
}
