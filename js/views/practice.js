// Practice (spec 02): go through a list of cards once, answering as in a
// normal review, but with no rating buttons. Nothing is saved and no
// schedule changes: this never calls store.addReview.

import { store } from '../store.js';
import { isActive, parseKey } from '../scheduler.js';
import { checkAnswer, isRight } from '../match.js';
import { shuffle } from '../util.js';
import { esc, multiline, go, render } from '../ui.js';
import { askForm, markWord, wordRight, verdictHtml, wordAnswerHtml, wordPrompt, wordPlaceholder, dirLabel } from './review.js';

let pr = null;

// items: [{ key, misses? }]. back: where ✕ and Done go.
export function startPractice(items, { back = '#/home', title = 'Practice' } = {}) {
  const list = items.filter(it => {
    const { id, dir } = parseKey(it.key);
    const card = store.cards.get(id);
    return card && isActive(card) && (dir !== 'rev' || card.type === 'word');
  });
  pr = { items: shuffle(list), i: 0, right: 0, back, title, cur: null };
  next();
  go('#/practice');
}

function next() {
  const it = pr.items[pr.i];
  pr.cur = it ? { ...it, ...parseKey(it.key), phase: 'ask', typed: '', result: null, overridden: false, selfRight: null } : null;
}

function isCorrect(cur, card) {
  if (card.type === 'word') return wordRight(cur.result, cur.overridden);
  if (card.type === 'exact') return cur.overridden || isRight(cur.result.result);
  return cur.selfRight === true;
}

function cardHtml(cur, card) {
  const word = card.type === 'word';
  const exact = card.type === 'exact';
  const prompt = word ? wordPrompt(card, cur.dir) : card.prompts[0];
  const chips = [
    `<span class="chip">${esc(store.themeName(card.theme))}</span>`,
    word ? `<span class="chip chip-dir">${esc(dirLabel(card, cur.dir))}</span>` : '',
    cur.misses ? `<span class="chip chip-p-wait">missed ${cur.misses}×</span>` : '',
  ].join('');
  let body;
  if (cur.phase === 'ask') {
    body = askForm({ placeholder: word ? wordPlaceholder(card, cur.dir) : exact ? 'Type the answer' : null, submit: 'pCheck', skip: 'pShowOnly' });
  } else {
    const typed = cur.typed.trim();
    const auto = word || exact;
    const wrongShown = auto && !cur.overridden && !['correct', 'accent', 'synonym', 'blank'].includes(cur.result.result);
    const others = exact && card.accept.length ? `<div class="muted small">Also accepted: ${card.accept.map(esc).join(', ')}</div>` : '';
    body = `
      ${auto ? verdictHtml(cur.result, cur.overridden, card, cur.dir) : ''}
      ${word ? wordAnswerHtml(card, typed) : `
      <div class="compare">
        ${typed ? `<div class="compare-box"><div class="label">Your answer</div><div>${multiline(typed)}</div></div>` : ''}
        <div class="compare-box model"><div class="label">Answer</div><div>${multiline(card.answer)}</div>${others}</div>
      </div>`}
      ${auto
        ? `<div class="row"><button type="button" class="btn btn-grow" data-action="pNext">Next</button></div>
           ${wrongShown ? `<button type="button" class="link center-block" data-action="pOverride">I was actually right</button>` : ''}`
        : `<div class="row">
             <button type="button" class="btn btn-secondary btn-grow" data-action="pSelf" data-right="0">I missed it</button>
             <button type="button" class="btn btn-grow" data-action="pSelf" data-right="1">I got it</button>
           </div>`}`;
  }
  return `
    <div class="chips">${chips}</div>
    <div class="prompt ${word ? 'prompt-word' : ''}">${multiline(prompt)}</div>
    ${body}`;
}

export function practiceView() {
  if (!pr) return { html: '', mount: () => go('#/home') };
  const cur = pr.cur;
  const card = cur && store.cards.get(cur.id);
  const total = pr.items.length;
  const html = cur && card ? `
    <header class="bar review-bar">
      <a class="bar-back" href="${pr.back}" aria-label="End practice">✕</a>
      <h1>${esc(pr.title)} · ${pr.i + 1} of ${total}</h1>
      <span class="bar-spacer"></span>
    </header>
    <main class="page review">
      <p class="practice-note">Practice: doesn't change your schedule</p>
      ${cardHtml(cur, card)}
    </main>` : `
    <header class="bar"><a class="bar-back" href="${pr.back}" aria-label="Close">✕</a><h1>${esc(pr.title)}</h1><span class="bar-spacer"></span></header>
    <main class="page center">
      <h2>Practice done</h2>
      <p class="muted">${total ? `${pr.right} of ${total} right` : 'No cards to practise.'}</p>
      <a class="btn" href="${pr.back}">Done</a>
    </main>`;

  function reveal(showOnly) {
    cur.phase = 'answer';
    if (card.type === 'word') cur.result = markWord(card, cur.dir, cur.typed, showOnly);
    else if (card.type === 'exact') {
      cur.result = showOnly ? { result: 'blank', expected: card.answer } : checkAnswer(cur.typed, [card.answer, ...card.accept], { strictAccents: store.settings.strictAccents });
    }
    render();
    document.activeElement?.blur?.();
  }
  function advance() {
    if (isCorrect(cur, card)) pr.right++;
    pr.i++;
    next();
    render();
    const input = document.querySelector('.answer-input');
    if (input && !matchMedia('(pointer: coarse)').matches) input.focus({ preventScroll: true });
  }

  return {
    html,
    step: cur ? `p${pr.i}` : 'done',
    hideTabs: !!cur,
    tab: 'home',
    mount() {
      const input = document.querySelector('.answer-input');
      if (input && !matchMedia('(pointer: coarse)').matches) input.focus({ preventScroll: true });
    },
    actions: {
      pCheck(form) { cur.typed = form.answer.value; reveal(false); },
      pShowOnly() { cur.typed = document.querySelector('.answer-input')?.value ?? ''; reveal(true); },
      pOverride() { cur.overridden = true; render(); },
      pNext() { advance(); },
      pSelf(el) { cur.selfRight = el.dataset.right === '1'; advance(); },
    },
    onKey(e) {
      if (!cur || !location.hash.startsWith('#/practice') || cur.phase !== 'answer') return;
      if (e.target.matches?.('textarea, input')) return;
      if (e.key === 'Enter' && (card.type === 'word' || card.type === 'exact')) { e.preventDefault(); advance(); }
    },
  };
}
