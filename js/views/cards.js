import { store } from '../store.js';
import { State, keysOf } from '../scheduler.js';
import { inThemes, cardThemes } from '../model.js';
import { cardHints, cardErrors } from '../rules.js';
import { formatRelative, formatDate, stripAccentsLower } from '../util.js';
import { esc, header, go, render, toast, themeOptions, themePicker, pickerHandlers, pickerError, resolvePick } from '../ui.js';

// ---------- Card list ----------

const listState = { q: '', theme: '', show: 'active', limit: 100, selecting: false };
const selected = new Set();
const moveTo = { theme: '', newTheme: '', newSub: '', subParent: '' };

function dueLabel(card) {
  if (card.status === 'archived') return 'Archived';
  const started = keysOf(card).map(k => store.cardState(k)?.state).filter(st => st && st.state !== State.New);
  if (!started.length) return 'New';
  const due = Math.min(...started.map(st => +new Date(st.due)));
  return `Due ${formatRelative(due)}${card.type === 'word' && started.length < 2 ? ' · one way so far' : ''}`;
}

// "Spanish › Verbs" plus any extra sub-themes: "Spanish › Verbs, Irregular".
function themesLabel(c) {
  if (!c.also_in.length) return store.themeName(c.theme);
  return [store.themeName(c.theme), ...c.also_in.filter(id => store.themes.get(id) && !store.themes.get(id).deleted).map(id => store.themes.get(id).name)].join(', ');
}

function matches(card, q) {
  if (!q) return true;
  const hay = stripAccentsLower([...card.prompts, card.answer, card.note, card.source, ...card.tags, ...card.accept].join(' '));
  return q.split(/\s+/).every(w => hay.includes(w));
}

function filtered() {
  const q = stripAccentsLower(listState.q.trim());
  // Choosing a theme includes its sub-themes.
  const scope = listState.theme ? new Set(store.themeScope(listState.theme)) : null;
  return store.liveCards()
    .filter(c => (listState.show === 'archived' ? c.status === 'archived' : c.status !== 'archived'))
    .filter(c => listState.show !== 'unverified' || c.unverified)
    .filter(c => !scope || inThemes(c, [...scope]))
    .filter(c => matches(c, q))
    .sort((a, b) => (a.updated < b.updated ? 1 : -1));
}

function cardRow(c) {
  const extra = c.prompts.length > 1 && c.type !== 'word' ? ` · ${c.prompts.length} wordings` : '';
  const links = c.type === 'word' ? store.linksOf(c.id).length : 0;
  const body = `
    <div class="card-q">${esc(c.prompts[0])}${c.type === 'word' ? ` <span class="card-a-inline">= ${esc(c.answer)}</span>` : ''}</div>
    ${c.type === 'word' ? (c.note ? `<div class="card-a muted">${esc(c.note)}</div>` : '') : `<div class="card-a">${esc(c.answer)}</div>`}
    <div class="muted small">${esc(themesLabel(c))} · ${esc(dueLabel(c))}${extra}${links ? ` · ${links} linked` : ''}${c.unverified ? ' · <span class="warn-text">Unverified</span>' : ''}${c.author === 'claude' ? ' · Suggested by Claude' : ''}</div>`;
  if (listState.selecting) {
    return `<li><label class="card-row selectable ${selected.has(c.id) ? 'picked' : ''}">
      <input type="checkbox" class="check" data-change="pick" value="${c.id}" ${selected.has(c.id) ? 'checked' : ''} aria-label="Select card">
      <div class="grow">${body}</div>
    </label></li>`;
  }
  return `<li><a class="card-row" href="#/card/${c.id}">${body}</a></li>`;
}

function listHtml() {
  const rows = filtered();
  if (!rows.length) {
    const none = store.liveCards().length === 0;
    return `<p class="muted center">${none ? 'No cards yet.' : 'No cards match.'}</p>`;
  }
  const shown = rows.slice(0, listState.limit);
  const allPicked = shown.every(c => selected.has(c.id));
  return `<div class="section-head"><p class="muted small">${rows.length} card${rows.length === 1 ? '' : 's'}</p>
      ${listState.selecting ? `<button type="button" class="link small" data-action="pickAll">${allPicked ? 'Clear selection' : `Select all ${shown.length}`}</button>` : ''}</div>
    <ul class="list cards">${shown.map(cardRow).join('')}</ul>
    ${rows.length > shown.length ? `<button type="button" class="btn btn-secondary btn-block" data-action="more">Show more</button>` : ''}`;
}

function selectionBar() {
  if (!listState.selecting || !selected.size) return '';
  const archivedView = listState.show === 'archived';
  return `<div class="sticky-actions selection-bar">
    <div class="selection-count">${selected.size} selected</div>
    ${themePicker(moveTo, { label: 'Theme or sub-theme' })}
    <div id="move-error"></div>
    <div class="row wrap">
      <button type="button" class="btn btn-grow" data-action="moveSelected">Move</button>
      <button type="button" class="btn btn-secondary" data-action="addToSelected">Add to</button>
      <button type="button" class="btn btn-secondary" data-action="removeFromSelected">Remove from</button>
      <button type="button" class="btn btn-secondary" data-action="${archivedView ? 'restoreSelected' : 'archiveSelected'}">${archivedView ? 'Restore' : 'Archive'}</button>
    </div>
    <p class="muted small">“Add to” keeps the cards where they are as well.</p>
  </div>`;
}

function endSelecting() {
  listState.selecting = false;
  selected.clear();
}

export function cardsView(params) {
  if (params.show) listState.show = params.show;
  // Forget selections of cards that no longer exist.
  for (const id of selected) if (!store.cards.get(id) || store.cards.get(id).deleted) selected.delete(id);
  const archivedCount = store.liveCards().filter(c => c.status === 'archived').length;
  const seg = (value, label) => `<button type="button" class="seg ${listState.show === value ? 'on' : ''}" data-action="show" data-value="${value}">${label}</button>`;
  const right = listState.selecting
    ? `<button type="button" class="link" data-action="toggleSelect">Done</button>`
    : `<button type="button" class="link" data-action="toggleSelect">Select</button><a class="icon-btn" href="#/new" aria-label="New card">＋</a>`;
  const picker = pickerHandlers(moveTo);
  return {
    html: `
      ${header('Cards', { right })}
      <main class="page">
        <input type="search" class="search" placeholder="Search cards" value="${esc(listState.q)}" data-input="q">
        <div class="filters">
          <select data-change="theme" aria-label="Theme">
            <option value="">All themes</option>
            ${themeOptions(listState.theme, { allowNew: false })}
          </select>
          <div class="segmented">${seg('active', 'Active')}${seg('unverified', 'Unverified')}${seg('archived', `Archived${archivedCount ? ` (${archivedCount})` : ''}`)}</div>
        </div>
        ${listState.selecting && !selected.size ? '<p class="muted small">Tick cards to move them, add them to more sub-themes, or archive them.</p>' : ''}
        <div id="card-list">${listHtml()}</div>
        ${selectionBar()}
      </main>`,
    tab: 'cards',
    mount(root) {
      if (listState.q && !listState.selecting) root.querySelector('.search').focus();
    },
    onStoreChange() {
      const el = document.getElementById('card-list');
      if (el) el.innerHTML = listHtml();
    },
    inputs: {
      ...picker.inputs,
      q(el) {
        listState.q = el.value;
        listState.limit = 100;
        document.getElementById('card-list').innerHTML = listHtml();
      },
    },
    changes: {
      ...picker.changes,
      theme(el) {
        listState.theme = el.value;
        render();
      },
      pick(el) {
        if (el.checked) selected.add(el.value);
        else selected.delete(el.value);
        render();
      },
    },
    actions: {
      show(el) {
        listState.show = el.dataset.value;
        selected.clear();
        render();
      },
      more() {
        listState.limit += 200;
        render();
      },
      toggleSelect() {
        if (listState.selecting) endSelecting();
        else {
          listState.selecting = true;
          if (!moveTo.theme || !store.themes.get(moveTo.theme)) moveTo.theme = listState.theme || store.themeTree()[0]?.theme.id || '__new';
        }
        render();
      },
      pickAll() {
        const shown = filtered().slice(0, listState.limit);
        const allPicked = shown.every(c => selected.has(c.id));
        for (const c of shown) allPicked ? selected.delete(c.id) : selected.add(c.id);
        render();
      },
      async moveSelected() {
        const err = pickerError(moveTo);
        if (err) {
          document.getElementById('move-error').innerHTML = `<div class="errors">${esc(err)}</div>`;
          return;
        }
        const theme = await resolvePick(moveTo);
        const n = selected.size;
        await store.moveCards([...selected], theme);
        Object.assign(moveTo, { theme, newTheme: '', newSub: '' });
        endSelecting();
        toast(`Moved ${n} card${n === 1 ? '' : 's'} to ${store.themeName(theme)}`);
        render();
      },
      async addToSelected() {
        const err = pickerError(moveTo) ?? (moveTo.theme === '__new' ? 'Add to needs a sub-theme of the cards\' theme.' : null);
        if (err) {
          document.getElementById('move-error').innerHTML = `<div class="errors">${esc(err)}</div>`;
          return;
        }
        if (moveTo.theme !== '__newsub' && store.isTopTheme(moveTo.theme)) {
          document.getElementById('move-error').innerHTML = '<div class="errors">Choose a sub-theme. Cards are already in their whole theme.</div>';
          return;
        }
        const theme = await resolvePick(moveTo);
        const { added, skipped } = await store.addCardsToTheme([...selected], theme);
        Object.assign(moveTo, { theme, newTheme: '', newSub: '' });
        endSelecting();
        toast(`Added ${added} card${added === 1 ? '' : 's'} to ${store.themeName(theme)}${skipped ? `. ${skipped} skipped: they're in a different theme.` : ''}`);
        render();
      },
      async removeFromSelected() {
        if (!store.themes.get(moveTo.theme)) return;
        const theme = moveTo.theme;
        const { removed, skipped } = await store.removeCardsFromTheme([...selected], theme);
        endSelecting();
        toast(`Removed ${removed} card${removed === 1 ? '' : 's'} from ${store.themeName(theme)}${skipped ? `. ${skipped} kept: it's their only sub-theme (use Move instead).` : ''}`);
        render();
      },
      async archiveSelected() {
        const ids = [...selected];
        await store.updateCards(ids, { status: 'archived' });
        endSelecting();
        toast(`Archived ${ids.length} card${ids.length === 1 ? '' : 's'}.`, {
          label: 'Undo',
          run: () => store.updateCards(ids, { status: 'active' }).then(render),
        });
        render();
      },
      async restoreSelected() {
        const ids = [...selected];
        await store.updateCards(ids, { status: 'active' });
        endSelecting();
        toast(`Restored ${ids.length} card${ids.length === 1 ? '' : 's'} to your reviews.`);
        render();
      },
    },
  };
}

export function archiveView() {
  listState.show = 'archived';
  return cardsView({});
}

// ---------- Card editor ----------

let draft = null; // the card being edited, kept across re-renders

const isRealTheme = id => !!store.themes.get(id) && !store.themes.get(id).deleted;
const defaultType = theme => (isRealTheme(theme) && store.themeLanguage(theme) ? 'word' : 'concept');

function blankDraft(params) {
  const lastTheme = draft?.theme && store.themes.get(draft.theme) ? draft.theme : store.themeTree()[0]?.theme.id ?? '__new';
  const theme = params.theme ?? lastTheme;
  return {
    id: null,
    theme,
    newTheme: '',
    newSub: '',
    subParent: '',
    also_in: [],
    type: draft?.id === null ? draft.type : defaultType(theme),
    prompts: [''],
    answer: '',
    accept: '',
    note: '',
    links: [], // [{ id, kind }]
    linkQuery: '',
    source: '',
    unverified: false,
    tags: '',
  };
}

function draftFromCard(c) {
  return {
    id: c.id,
    theme: c.theme,
    newTheme: '',
    newSub: '',
    subParent: '',
    also_in: c.also_in.slice(),
    type: c.type,
    prompts: c.prompts.length ? c.prompts.slice() : [''],
    answer: c.answer,
    accept: c.accept.join('\n'),
    note: c.note,
    links: store.linksOf(c.id).map(l => ({ id: l.card.id, kind: l.kind })),
    linkQuery: '',
    source: c.source,
    unverified: c.unverified,
    tags: c.tags.join(', '),
  };
}

// Sub-themes the card could also belong to: the other sub-themes of its theme.
function siblingSubThemes(d) {
  if (!isRealTheme(d.theme)) return [];
  const top = store.topThemeOf(d.theme);
  const node = store.themeTree().find(n => n.theme.id === top);
  return (node?.children ?? []).filter(t => t.id !== d.theme);
}

function draftToFields(d) {
  const siblings = new Set(siblingSubThemes(d).map(t => t.id));
  return {
    theme: d.theme,
    also_in: d.also_in.filter(id => siblings.has(id)),
    type: d.type,
    prompts: d.prompts.map(p => p.trim()).filter(Boolean),
    answer: d.answer,
    accept: d.accept.split('\n').map(s => s.trim()).filter(Boolean),
    note: d.type === 'word' ? d.note : '',
    source: d.source,
    unverified: d.unverified,
    tags: d.tags.split(',').map(s => s.trim()).filter(Boolean),
  };
}

function hintsHtml(d) {
  const hints = cardHints(draftToFields(d));
  if (!hints.length) return '';
  return `<div class="hints"><div class="label">Suggestions</div><ul>${hints.map(h => `<li>${esc(h)}</li>`).join('')}</ul></div>`;
}

function cardInfo(c) {
  const parts = [`Created ${formatDate(c.created)}`];
  if (c.author === 'claude') parts.push('suggested by Claude');
  const reviews = store.reviewCount(c);
  parts.push(reviews ? `reviewed ${reviews} time${reviews === 1 ? '' : 's'}` : 'not reviewed yet');
  if (c.status === 'archived') parts.push('archived');
  else {
    const lang = store.themeLanguage(c.theme) || 'word';
    for (const key of keysOf(c)) {
      const st = store.cardState(key);
      if (!st || st.state.state === State.New) continue;
      const label = c.type !== 'word' ? 'next review' : key === c.id ? `next ${lang} → English` : `next English → ${lang}`;
      parts.push(`${label} ${formatRelative(st.state.due)}`);
    }
  }
  return parts.join(' · ');
}

function alsoInHtml(d) {
  const sibs = siblingSubThemes(d);
  if (!sibs.length || store.isTopTheme(d.theme)) return '';
  return `<fieldset class="also-in"><legend>Also in <span class="muted">(other sub-themes)</span></legend>
    ${sibs.map(t => `<label class="check-row"><input type="checkbox" data-change="alsoIn" value="${t.id}" ${d.also_in.includes(t.id) ? 'checked' : ''}> ${esc(t.name)}</label>`).join('')}
  </fieldset>`;
}

function linkResults(d) {
  const q = stripAccentsLower(d.linkQuery.trim());
  if (!q || !isRealTheme(d.theme)) return '';
  const taken = new Set(d.links.map(l => l.id));
  const hits = store.wordsInTheme(d.theme)
    .filter(c => c.id !== d.id && !taken.has(c.id) && stripAccentsLower(`${c.prompts.join(' ')} ${c.answer}`).includes(q))
    .slice(0, 8);
  if (!hits.length) return '<p class="muted small">No matching words in this theme.</p>';
  return `<ul class="link-results">${hits.map(c => `<li>
    <span><strong>${esc(c.prompts[0])}</strong> = ${esc(c.answer)}</span>
    <span class="row tight"><button type="button" class="link small" data-action="addLink" data-id="${c.id}" data-kind="opposite">Opposite</button>
    <button type="button" class="link small" data-action="addLink" data-id="${c.id}" data-kind="related">Related</button></span>
  </li>`).join('')}</ul>`;
}

function linksHtml(d) {
  const rows = d.links.map(l => {
    const c = store.cards.get(l.id);
    if (!c) return '';
    return `<li><span><strong>${esc(c.prompts[0])}</strong> = ${esc(c.answer)} <span class="muted small">(${l.kind})</span></span>
      <button type="button" class="icon-btn" data-action="removeLink" data-id="${l.id}" aria-label="Unlink ${esc(c.prompts[0])}">✕</button></li>`;
  }).join('');
  return `<div class="field-label">Linked words <span class="muted">(opposites and related words, tested after this one if you choose)</span></div>
    ${rows ? `<ul class="links-list">${rows}</ul>` : ''}
    <input type="search" data-input="linkQuery" value="${esc(d.linkQuery)}" placeholder="Find a word to link">
    <div id="link-results">${linkResults(d)}</div>`;
}

function wordFields(d) {
  const lang = isRealTheme(d.theme) ? store.themeLanguage(d.theme) || 'Word' : 'Word';
  return `
    <label>${esc(lang)}<input data-input="word" value="${esc(d.prompts[0] ?? '')}" placeholder="e.g. esconder" autocapitalize="none" autocorrect="off" spellcheck="false"></label>
    <label>English<input data-input="answer" value="${esc(d.answer)}" placeholder="e.g. to hide, to conceal" autocapitalize="none"></label>
    <p class="muted small">Separate meanings with commas; any one counts as right. Words in brackets are shown but don't need typing, e.g. “to be (temporary)”.</p>
    <label>Note <span class="muted">(grammar, shown after answering; never typed)</span><textarea rows="2" data-input="note" placeholder="e.g. e→ie, irregular 1st person (tengo)">${esc(d.note)}</textarea></label>
    <label>Other accepted English answers <span class="muted">(one per line)</span><textarea rows="2" data-input="accept">${esc(d.accept)}</textarea></label>
    ${d.prompts.length > 1 ? `<p class="muted small">Other accepted ${esc(lang)} forms: ${d.prompts.slice(1).map(esc).join(', ')}</p>` : ''}
    ${linksHtml(d)}`;
}

function questionFields(d) {
  const promptFields = d.prompts.map((p, i) => `
    <div class="prompt-field">
      <textarea rows="2" data-input="prompt" data-i="${i}" placeholder="${i ? 'Another way of asking the same question' : 'The question'}">${esc(p)}</textarea>
      ${i ? `<button type="button" class="icon-btn" data-action="removePrompt" data-i="${i}" aria-label="Remove this wording">✕</button>` : ''}
    </div>`).join('');
  return `
    <div class="field-label">Question</div>
    ${promptFields}
    <button type="button" class="link" data-action="addPrompt">+ Add another wording</button>

    <label>Answer<textarea name="answer" rows="3" data-input="answer">${esc(d.answer)}</textarea></label>
    ${d.type === 'exact' ? `<label>Other accepted answers <span class="muted">(one per line)</span><textarea name="accept" rows="2" data-input="accept">${esc(d.accept)}</textarea></label>` : ''}`;
}

const TYPE_HELP = {
  concept: 'You type your answer, compare it with this answer, and rate yourself.',
  exact: 'For short answers like a single word. Your typed answer is checked, forgiving capitals and (unless strict) accents.',
  word: 'A word in a language, tested both ways (e.g. Spanish → English and English → Spanish), each with its own schedule. Marked automatically.',
};

// Save the draft's links: add new ones (stored on this card) and remove ones taken away.
async function saveLinks(id, links) {
  const before = new Map(store.linksOf(id).map(l => [l.card.id, l.kind]));
  const after = new Map(links.map(l => [l.id, l.kind]));
  for (const [other] of before) if (!after.has(other)) await store.unlinkWords(id, other);
  for (const [other, kind] of after) if (before.get(other) !== kind) await store.linkWords(id, other, kind);
}

export function cardEditView(params, rest, name) {
  const id = name === 'card' ? rest[0] : null;
  const existing = id ? store.cards.get(id) : null;
  if (id && (!existing || existing.deleted)) {
    return { html: `${header('Card', { back: '#/cards' })}<main class="page"><p>This card no longer exists.</p></main>` };
  }
  if (!draft || draft.id !== (id ?? null) || params.fresh) draft = existing ? draftFromCard(existing) : blankDraft(params);
  if (params.fresh) history.replaceState(null, '', location.hash.replace(/[?&]fresh=1/, ''));
  const d = draft;
  const back = params.from === 'review' ? '#/review' : id ? '#/cards' : '#/home';
  const archived = existing?.status === 'archived';
  const seg = (value, label) => `<button type="button" class="seg ${d.type === value ? 'on' : ''}" data-action="type" data-value="${value}">${label}</button>`;

  const html = `
    ${header(id ? 'Edit card' : 'New card', { back })}
    <main class="page">
      <form class="form" data-submit="save" autocomplete="off">
        ${themePicker(d)}
        ${alsoInHtml(d)}

        <div class="segmented wide" role="radiogroup" aria-label="Kind of card">
          ${seg('concept', 'I mark myself')}${seg('exact', 'Auto-marked')}${seg('word', 'Language word')}
        </div>
        <p class="muted small">${TYPE_HELP[d.type]}</p>

        ${d.type === 'word' ? wordFields(d) : questionFields(d)}

        <div id="hints">${hintsHtml(d)}</div>

        <details ${d.source || d.unverified || d.tags ? 'open' : ''}>
          <summary>Source, verification and tags</summary>
          <label>Source <span class="muted">(if different from the entry's)</span><input name="source" data-input="source" value="${esc(d.source)}" placeholder="e.g. Head First APIs, ch. 2"></label>
          <label class="check-row"><input type="checkbox" data-change="unverified" ${d.unverified ? 'checked' : ''}> Unverified: I haven't confirmed this yet</label>
          <label>Tags <span class="muted">(comma separated)</span><input name="tags" data-input="tags" value="${esc(d.tags)}"></label>
        </details>

        <div id="errors"></div>
        <div class="row">
          <button type="submit" class="btn btn-grow">Save</button>
          ${!id ? `<button type="button" class="btn btn-secondary" data-action="saveAnother">Save & add another</button>` : ''}
        </div>
      </form>

      ${existing ? `
        <p class="muted small">${esc(cardInfo(existing))}</p>
        <div class="danger-zone">
          ${archived
            ? `<button type="button" class="btn btn-secondary" data-action="restore">Restore to reviews</button>
               <button type="button" class="btn btn-danger" data-action="deleteForever">Delete permanently</button>`
            : `<button type="button" class="btn btn-secondary" data-action="archive">Archive</button>
               <p class="muted small">Archived cards leave your reviews but are kept, with their history, in the Archive.</p>`}
        </div>` : ''}
    </main>`;

  const refreshHints = () => {
    const el = document.getElementById('hints');
    if (el) el.innerHTML = hintsHtml(d);
  };

  async function save(another) {
    const fields = draftToFields(d);
    const errors = cardErrors(fields);
    const themeError = pickerError(d);
    if (themeError) errors.push(themeError);
    if (errors.length) {
      document.getElementById('errors').innerHTML = `<div class="errors">${errors.map(esc).join('<br>')}</div>`;
      return;
    }
    fields.theme = await resolvePick(d);
    if (id) {
      await store.updateCard(id, fields);
      if (fields.type === 'word') await saveLinks(id, d.links);
      draft = null;
      toast('Saved');
      go(back);
    } else {
      const [card] = await store.addCards([{ ...fields, author: 'me' }]);
      if (fields.type === 'word' && d.links.length) await saveLinks(card.id, d.links);
      toast('Card saved');
      const keepTheme = fields.theme;
      const keepType = d.type;
      const keepAlso = d.also_in;
      draft = { ...blankDraft({ theme: keepTheme }), type: keepType, also_in: keepAlso };
      if (another) render();
      else {
        draft = null;
        go('#/cards');
      }
      if (another) document.querySelector('[data-input="prompt"], [data-input="word"]')?.focus();
    }
  }

  return {
    html,
    tab: id ? 'cards' : 'new',
    hideTabs: params.from === 'review',
    inputs: {
      prompt(el) { d.prompts[Number(el.dataset.i)] = el.value; refreshHints(); },
      word(el) { d.prompts[0] = el.value; },
      answer(el) { d.answer = el.value; refreshHints(); },
      accept(el) { d.accept = el.value; },
      note(el) { d.note = el.value; },
      linkQuery(el) {
        d.linkQuery = el.value;
        document.getElementById('link-results').innerHTML = linkResults(d);
      },
      source(el) { d.source = el.value; },
      tags(el) { d.tags = el.value; },
      ...pickerHandlers(d).inputs,
    },
    changes: {
      ...pickerHandlers(d).changes,
      unverified(el) { d.unverified = el.checked; },
      alsoIn(el) {
        d.also_in = el.checked ? [...d.also_in, el.value] : d.also_in.filter(x => x !== el.value);
      },
    },
    actions: {
      type(el) { d.type = el.dataset.value; render(); },
      addPrompt() {
        d.prompts.push('');
        render();
        const all = document.querySelectorAll('textarea[data-input="prompt"]');
        all[all.length - 1]?.focus();
      },
      removePrompt(el) { d.prompts.splice(Number(el.dataset.i), 1); render(); },
      addLink(el) {
        d.links.push({ id: el.dataset.id, kind: el.dataset.kind });
        d.linkQuery = '';
        render();
      },
      removeLink(el) {
        d.links = d.links.filter(l => l.id !== el.dataset.id);
        render();
      },
      save() { save(false); },
      saveAnother() { save(true); },
      async archive() {
        await store.archiveCard(id);
        draft = null;
        toast('Card archived.', { label: 'Undo', run: () => store.restoreCard(id) });
        go(back === '#/review' ? '#/review' : '#/cards');
      },
      async restore() {
        await store.restoreCard(id);
        draft = null;
        toast('Restored to your reviews.');
        go('#/cards?show=archived');
      },
      async deleteForever() {
        if (!confirm('Delete this card permanently? Its review history stays in your GitHub history, but the card will be gone from the app.')) return;
        await store.deleteCardForever(id);
        draft = null;
        toast('Card deleted.');
        go('#/cards?show=archived');
      },
    },
  };
}
