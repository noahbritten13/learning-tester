import { store } from '../store.js';
import { State } from '../scheduler.js';
import { cardHints, cardErrors } from '../rules.js';
import { formatRelative, formatDate, stripAccentsLower } from '../util.js';
import { esc, header, go, render, toast, themeOptions } from '../ui.js';

// ---------- Card list ----------

const listState = { q: '', theme: '', show: 'active', limit: 100 };

function dueLabel(card) {
  if (card.status === 'archived') return 'Archived';
  const st = store.cardState(card.id)?.state;
  if (!st || st.state === State.New) return 'New';
  return `Due ${formatRelative(st.due)}`;
}

function matches(card, q) {
  if (!q) return true;
  const hay = stripAccentsLower([...card.prompts, card.answer, card.source, ...card.tags, ...card.accept].join(' '));
  return q.split(/\s+/).every(w => hay.includes(w));
}

function filtered() {
  const q = stripAccentsLower(listState.q.trim());
  return store.liveCards()
    .filter(c => (listState.show === 'archived' ? c.status === 'archived' : c.status !== 'archived'))
    .filter(c => listState.show !== 'unverified' || c.unverified)
    .filter(c => !listState.theme || c.theme === listState.theme)
    .filter(c => matches(c, q))
    .sort((a, b) => (a.updated < b.updated ? 1 : -1));
}

function cardRow(c) {
  const extra = c.prompts.length > 1 ? ` · ${c.prompts.length} wordings` : '';
  return `<li><a class="card-row" href="#/card/${c.id}">
    <div class="card-q">${esc(c.prompts[0])}</div>
    <div class="card-a">${esc(c.answer)}</div>
    <div class="muted small">${esc(store.themeName(c.theme))} · ${esc(dueLabel(c))}${extra}${c.unverified ? ' · <span class="warn-text">Unverified</span>' : ''}${c.author === 'claude' ? ' · Suggested by Claude' : ''}</div>
  </a></li>`;
}

function listHtml() {
  const rows = filtered();
  if (!rows.length) {
    const none = store.liveCards().length === 0;
    return `<p class="muted center">${none ? 'No cards yet.' : 'No cards match.'}</p>`;
  }
  const shown = rows.slice(0, listState.limit);
  return `<p class="muted small">${rows.length} card${rows.length === 1 ? '' : 's'}</p>
    <ul class="list cards">${shown.map(cardRow).join('')}</ul>
    ${rows.length > shown.length ? `<button type="button" class="btn btn-secondary btn-block" data-action="more">Show more</button>` : ''}`;
}

export function cardsView(params) {
  if (params.show) listState.show = params.show;
  const archivedCount = store.liveCards().filter(c => c.status === 'archived').length;
  const seg = (value, label) => `<button type="button" class="seg ${listState.show === value ? 'on' : ''}" data-action="show" data-value="${value}">${label}</button>`;
  return {
    html: `
      ${header('Cards', { right: `<a class="icon-btn" href="#/new" aria-label="New card">＋</a>` })}
      <main class="page">
        <input type="search" class="search" placeholder="Search cards" value="${esc(listState.q)}" data-input="q">
        <div class="filters">
          <select data-change="theme" aria-label="Theme">
            <option value="">All themes</option>
            ${themeOptions(listState.theme, { allowNew: false })}
          </select>
          <div class="segmented">${seg('active', 'Active')}${seg('unverified', 'Unverified')}${seg('archived', `Archived${archivedCount ? ` (${archivedCount})` : ''}`)}</div>
        </div>
        <div id="card-list">${listHtml()}</div>
      </main>`,
    tab: 'cards',
    mount(root) {
      if (listState.q) root.querySelector('.search').focus();
    },
    onStoreChange() {
      const el = document.getElementById('card-list');
      if (el) el.innerHTML = listHtml();
    },
    inputs: {
      q(el) {
        listState.q = el.value;
        listState.limit = 100;
        document.getElementById('card-list').innerHTML = listHtml();
      },
    },
    changes: {
      theme(el) {
        listState.theme = el.value;
        render();
      },
    },
    actions: {
      show(el) {
        listState.show = el.dataset.value;
        render();
      },
      more() {
        listState.limit += 200;
        document.getElementById('card-list').innerHTML = listHtml();
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

function blankDraft(params) {
  const lastTheme = draft?.theme && store.themes.get(draft.theme) ? draft.theme : store.liveThemes()[0]?.id ?? '__new';
  return {
    id: null,
    theme: params.theme ?? lastTheme,
    newTheme: '',
    type: draft?.id === null ? draft.type : 'concept',
    prompts: [''],
    answer: '',
    accept: '',
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
    type: c.type,
    prompts: c.prompts.length ? c.prompts.slice() : [''],
    answer: c.answer,
    accept: c.accept.join('\n'),
    source: c.source,
    unverified: c.unverified,
    tags: c.tags.join(', '),
  };
}

function draftToFields(d) {
  return {
    theme: d.theme,
    type: d.type,
    prompts: d.prompts.map(p => p.trim()).filter(Boolean),
    answer: d.answer,
    accept: d.accept.split('\n').map(s => s.trim()).filter(Boolean),
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
  const st = store.cardState(c.id);
  const reviews = store.reviewsByCard.get(c.id)?.length ?? 0;
  const parts = [`Created ${formatDate(c.created)}`];
  if (c.author === 'claude') parts.push('suggested by Claude');
  parts.push(reviews ? `reviewed ${reviews} time${reviews === 1 ? '' : 's'}` : 'not reviewed yet');
  if (c.status === 'archived') parts.push('archived');
  else if (st && st.state.state !== State.New) parts.push(`next review ${formatRelative(st.state.due)}`);
  return parts.join(' · ');
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

  const promptFields = d.prompts.map((p, i) => `
    <div class="prompt-field">
      <textarea rows="2" data-input="prompt" data-i="${i}" placeholder="${i ? 'Another way of asking the same question' : 'The question'}">${esc(p)}</textarea>
      ${i ? `<button type="button" class="icon-btn" data-action="removePrompt" data-i="${i}" aria-label="Remove this wording">✕</button>` : ''}
    </div>`).join('');

  const html = `
    ${header(id ? 'Edit card' : 'New card', { back })}
    <main class="page">
      <form class="form" data-submit="save" autocomplete="off">
        <label>Theme
          <select name="theme" data-change="theme">${themeOptions(d.theme, { placeholder: store.liveThemes().length ? '' : 'Choose…' })}</select>
        </label>
        ${d.theme === '__new' ? `<label>New theme name<input name="newTheme" data-input="newTheme" value="${esc(d.newTheme)}" placeholder="e.g. Software & coding"></label>` : ''}

        <div class="segmented wide" role="radiogroup" aria-label="How it's marked">
          <button type="button" class="seg ${d.type === 'concept' ? 'on' : ''}" data-action="type" data-value="concept">I mark myself</button>
          <button type="button" class="seg ${d.type === 'exact' ? 'on' : ''}" data-action="type" data-value="exact">Marked automatically</button>
        </div>
        <p class="muted small">${d.type === 'exact' ? 'For short answers like a single word. Your typed answer is checked, forgiving capitals and (unless strict) accents.' : 'You type your answer, compare it with this answer, and rate yourself.'}</p>

        <div class="field-label">Question</div>
        ${promptFields}
        <button type="button" class="link" data-action="addPrompt">+ Add another wording</button>

        <label>Answer<textarea name="answer" rows="3" data-input="answer">${esc(d.answer)}</textarea></label>
        ${d.type === 'exact' ? `<label>Other accepted answers <span class="muted">(one per line)</span><textarea name="accept" rows="2" data-input="accept">${esc(d.accept)}</textarea></label>` : ''}

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
    if (d.theme === '__new' && !d.newTheme.trim()) errors.push('Give the new theme a name.');
    if (!d.theme) errors.push('Choose a theme.');
    if (errors.length) {
      document.getElementById('errors').innerHTML = `<div class="errors">${errors.map(esc).join('<br>')}</div>`;
      return;
    }
    if (d.theme === '__new') fields.theme = (await store.addTheme(d.newTheme)).id;
    if (id) {
      await store.updateCard(id, fields);
      draft = null;
      toast('Saved');
      go(back);
    } else {
      await store.addCards([{ ...fields, author: 'me' }]);
      toast('Card saved');
      const keepTheme = fields.theme;
      const keepType = d.type;
      draft = { ...blankDraft({ theme: keepTheme }), type: keepType };
      if (another) render();
      else {
        draft = null;
        go('#/cards');
      }
      if (another) document.querySelector('textarea[data-input="prompt"]')?.focus();
    }
  }

  return {
    html,
    tab: id ? 'cards' : 'new',
    hideTabs: params.from === 'review',
    inputs: {
      prompt(el) { d.prompts[Number(el.dataset.i)] = el.value; refreshHints(); },
      answer(el) { d.answer = el.value; refreshHints(); },
      accept(el) { d.accept = el.value; },
      source(el) { d.source = el.value; },
      tags(el) { d.tags = el.value; },
      newTheme(el) { d.newTheme = el.value; },
    },
    changes: {
      theme(el) { d.theme = el.value; render(); },
      unverified(el) { d.unverified = el.checked; },
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
