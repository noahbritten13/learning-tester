import { store } from '../store.js';
import { parseImport } from '../importer.js';
import { cardHints, cardErrors } from '../rules.js';
import { esc, multiline, header, go, render, toast, themeOptions, readFile } from '../ui.js';

// Import state survives re-renders (and leaving the screen and coming back).
let st = { step: 'paste', text: '', parsed: null, theme: '', newTheme: '', items: [], entry: null, keepEntry: true, revealClaude: false, saved: null };

const reset = () => {
  st = { step: 'paste', text: '', parsed: null, theme: st.theme, newTheme: '', items: [], entry: null, keepEntry: true, revealClaude: false, saved: null };
};

function preview() {
  const parsed = parseImport(st.text);
  st.parsed = parsed;
  if (parsed.error) return;
  st.items = parsed.cards.map((c, i) => ({
    key: i,
    card: c,
    // Your cards are ticked; Claude's suggestions need ticking one by one.
    include: c.author === 'me' && !cardErrors(c).length,
    editing: !!cardErrors(c).length,
  }));
  st.entry = parsed.entry;
  st.keepEntry = !!parsed.entry;
  st.revealClaude = false;
  const match = parsed.themeName && store.liveThemes().find(t => t.name.toLowerCase() === parsed.themeName.toLowerCase());
  if (match) st.theme = match.id;
  else if (parsed.themeName) {
    st.theme = '__new';
    st.newTheme = parsed.themeName;
  } else if (!st.theme || !store.themes.get(st.theme)) {
    st.theme = store.liveThemes()[0]?.id ?? '__new';
  }
  st.step = 'preview';
}

const mine = () => st.items.filter(i => i.card.author === 'me');
const claudes = () => st.items.filter(i => i.card.author === 'claude');
const chosen = () => st.items.filter(i => i.include && (i.card.author === 'me' || st.revealClaude));

function itemHtml(item) {
  const c = item.card;
  const errors = cardErrors(c);
  const hints = cardHints(c);
  if (item.editing) {
    return `<li class="import-item editing">
      <label>Question <span class="muted">(one wording per line)</span>
        <textarea rows="2" data-input="itemPrompts" data-key="${item.key}">${esc(c.prompts.join('\n'))}</textarea></label>
      <label>Answer<textarea rows="2" data-input="itemAnswer" data-key="${item.key}">${esc(c.answer)}</textarea></label>
      <label class="check-row"><input type="checkbox" data-change="itemExact" data-key="${item.key}" ${c.type === 'exact' ? 'checked' : ''}> Marked automatically (short exact answer)</label>
      <label class="check-row"><input type="checkbox" data-change="itemUnverified" data-key="${item.key}" ${c.unverified ? 'checked' : ''}> Unverified</label>
      <label>Source<input data-input="itemSource" data-key="${item.key}" value="${esc(c.source)}"></label>
      ${errors.length ? `<div class="errors">${errors.map(esc).join('<br>')}</div>` : ''}
      <div class="row"><button type="button" class="btn btn-small" data-action="doneEdit" data-key="${item.key}">Done</button>
      <button type="button" class="btn btn-small btn-secondary" data-action="discard" data-key="${item.key}">Discard</button></div>
    </li>`;
  }
  return `<li class="import-item ${item.include ? '' : 'excluded'}">
    <label class="import-check"><input type="checkbox" data-change="include" data-key="${item.key}" ${item.include ? 'checked' : ''} ${errors.length ? 'disabled' : ''} aria-label="Include this card"></label>
    <div class="import-body">
      ${c.prompts.map((p, i) => `<div class="card-q ${i ? 'alt' : ''}">${i ? '<span class="muted small">or: </span>' : ''}${multiline(p)}</div>`).join('')}
      <div class="card-a">${multiline(c.answer)}</div>
      <div class="muted small">${[c.type === 'exact' ? 'Marked automatically' : '', c.source ? `Source: ${esc(c.source)}` : '', c.unverified ? '<span class="warn-text">Unverified</span>' : ''].filter(Boolean).join(' · ')}</div>
      ${hints.length ? `<ul class="hint-list">${hints.map(h => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
      <button type="button" class="link small" data-action="edit" data-key="${item.key}">Edit</button>
    </div>
  </li>`;
}

function pasteHtml() {
  const err = st.parsed?.error;
  return `
    ${header('Import cards')}
    <main class="page">
      <p>Paste the cards you made with Claude (the JSON it gives you), or simple text like this:</p>
      <pre class="example">Q: What is an API?
Q: In plain words, what does an API let one program do?
A: Ask another program for data or actions, following agreed rules.

Q: Spanish for 'tree'?
A: árbol
Type: exact</pre>
      <p class="muted small">Several Q: lines before one A: are alternative wordings of the same card. <a href="#/coach">Instructions for Claude</a></p>
      <textarea class="paste" rows="10" data-input="text" placeholder="Paste here">${esc(st.text)}</textarea>
      ${err ? `<div class="errors">${esc(err)}</div>` : ''}
      <div class="row">
        <button type="button" class="btn btn-grow" data-action="preview">Preview</button>
        <label class="btn btn-secondary file-btn">Choose file<input type="file" accept=".json,.txt,.md,text/plain,application/json" data-change="file" hidden></label>
      </div>
    </main>`;
}

function previewHtml() {
  const own = mine();
  const sugg = claudes();
  const ownIncluded = own.filter(i => i.include).length;
  const canReveal = own.some(i => !i.editing && !cardErrors(i.card).length);
  const n = chosen().length;
  const warnings = st.parsed.warnings ?? [];

  const claudeSection = !sugg.length ? '' : st.revealClaude
    ? `<section><h2>Claude's suggestions (${sugg.length})</h2>
         <p class="muted small">Tick any you want to add. Nothing is added unless you tick it.</p>
         <ul class="list">${sugg.map(itemHtml).join('')}</ul></section>`
    : `<section class="locked">
         <h2>Claude's suggestions (${sugg.length})</h2>
         ${canReveal
           ? `<p>Hidden so they don't shape your own cards. Have a look once you're happy with yours.</p>
              <button type="button" class="btn btn-secondary" data-action="reveal">Show Claude's suggestions</button>`
           : `<p>Write at least one card of your own first. Claude's suggestions unlock once you have.</p>
              <div class="row"><button type="button" class="btn btn-secondary" data-action="addOwn">Write a card</button>
              <button type="button" class="link small" data-action="revealAnyway">Show anyway</button></div>`}
       </section>`;

  return `
    ${header('Check and save', { back: '#/import?back=1' })}
    <main class="page">
      ${warnings.map(w => `<p class="notice">${esc(w)}</p>`).join('')}
      <label>Theme
        <select data-change="theme">${themeOptions(st.theme)}</select>
      </label>
      ${st.theme === '__new' ? `<label>New theme name<input data-input="newTheme" value="${esc(st.newTheme)}"></label>` : ''}

      ${st.entry ? `<section class="entry-preview">
        <label class="check-row"><input type="checkbox" data-change="keepEntry" ${st.keepEntry ? 'checked' : ''}> Save this library entry</label>
        <h3>${esc(st.entry.title)}</h3>
        ${st.entry.summary ? `<div>${multiline(st.entry.summary)}</div>` : ''}
        ${st.entry.sources.length ? `<p class="muted small">Sources: ${st.entry.sources.map(esc).join(' · ')}</p>` : ''}
        <p class="muted small">Browsing the library arrives in phase 2. The entry is saved now and your cards are linked to it.</p>
      </section>` : ''}

      <section>
        <div class="section-head"><h2>Your cards (${own.length})</h2>
          ${own.length && ownIncluded < own.filter(i => !cardErrors(i.card).length).length ? `<button type="button" class="link" data-action="approveAll">Approve all</button>` : ''}</div>
        ${own.length ? `<ul class="list">${own.map(itemHtml).join('')}</ul>` : '<p class="muted">None yet.</p>'}
        <button type="button" class="link" data-action="addOwn">+ Write a card</button>
      </section>

      ${claudeSection}

      <div class="sticky-actions">
        <button type="button" class="btn btn-grow" data-action="save" ${n ? '' : 'disabled'}>Save ${n} card${n === 1 ? '' : 's'}</button>
        <button type="button" class="btn btn-secondary" data-action="cancel">Cancel</button>
      </div>
    </main>`;
}

function savedHtml() {
  const s = st.saved;
  return `
    ${header('Saved')}
    <main class="page center">
      <p class="big-number">${s.count}</p>
      <p>card${s.count === 1 ? '' : 's'} saved to <strong>${esc(s.themeName)}</strong>${s.entry ? `, with the entry “${esc(s.entry)}”` : ''}.</p>
      <div class="row center-row">
        <a class="btn" href="#/review?start=${s.theme}">Review them now</a>
        <button type="button" class="btn btn-secondary" data-action="again">Import more</button>
      </div>
    </main>`;
}

const find = el => st.items.find(i => i.key === Number(el.dataset.key));

export function importView(params) {
  if (params.back) {
    st.step = 'paste';
    history.replaceState(null, '', '#/import');
  }
  if (st.step === 'preview' && !st.parsed) st.step = 'paste';
  const html = st.step === 'saved' ? savedHtml() : st.step === 'preview' ? previewHtml() : pasteHtml();

  return {
    html,
    step: st.step,
    tab: 'import',
    inputs: {
      text(el) { st.text = el.value; },
      newTheme(el) { st.newTheme = el.value; },
      itemPrompts(el) { find(el).card.prompts = el.value.split('\n').map(s => s.trim()).filter(Boolean); },
      itemAnswer(el) { find(el).card.answer = el.value; },
      itemSource(el) { find(el).card.source = el.value; },
    },
    changes: {
      async file(el) {
        const f = el.files?.[0];
        if (!f) return;
        st.text = await readFile(f);
        preview();
        render();
      },
      theme(el) { st.theme = el.value; render(); },
      keepEntry(el) { st.keepEntry = el.checked; },
      include(el) { find(el).include = el.checked; render(); },
      itemExact(el) { find(el).card.type = el.checked ? 'exact' : 'concept'; },
      itemUnverified(el) { find(el).card.unverified = el.checked; },
    },
    actions: {
      preview() {
        preview();
        render();
        window.scrollTo(0, 0);
      },
      edit(el) { find(el).editing = true; render(); },
      doneEdit(el) {
        const item = find(el);
        if (cardErrors(item.card).length) return render();
        item.editing = false;
        item.include = true;
        render();
      },
      discard(el) {
        st.items = st.items.filter(i => i.key !== Number(el.dataset.key));
        render();
      },
      addOwn() {
        const key = Math.max(-1, ...st.items.map(i => i.key)) + 1;
        st.items.push({
          key,
          include: false,
          editing: true,
          card: { prompts: [], answer: '', type: 'concept', accept: [], author: 'me', source: '', unverified: false, tags: [] },
        });
        render();
        document.querySelector(`textarea[data-key="${key}"]`)?.focus();
      },
      approveAll() {
        for (const i of mine()) if (!cardErrors(i.card).length) i.include = true;
        render();
      },
      reveal() { st.revealClaude = true; render(); },
      revealAnyway() {
        if (confirm('Show Claude\'s suggestions before writing your own? Writing your own first usually helps you learn more.')) {
          st.revealClaude = true;
          render();
        }
      },
      async save() {
        const items = chosen().filter(i => !cardErrors(i.card).length);
        if (!items.length) return;
        if (st.theme === '__new' && !st.newTheme.trim()) return toast('Give the new theme a name.');
        const theme = st.theme === '__new' ? (await store.addTheme(st.newTheme)).id : st.theme;
        let entry = null;
        if (st.entry && st.keepEntry) entry = await store.addEntry({ ...st.entry, theme });
        await store.addCards(items.map(i => ({ ...i.card, theme, entry: entry?.id ?? null })));
        st.saved = { count: items.length, theme, themeName: store.themeName(theme), entry: entry?.title };
        st.step = 'saved';
        st.text = '';
        render();
      },
      cancel() {
        if (!confirm('Discard this import?')) return;
        reset();
        render();
      },
      again() {
        reset();
        go('#/import');
        render();
      },
    },
  };
}
