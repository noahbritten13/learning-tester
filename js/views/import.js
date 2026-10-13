import { store } from '../store.js';
import { parseImport, matchExisting } from '../importer.js';
import { cardHints, cardErrors } from '../rules.js';
import { esc, multiline, header, go, render, toast, readFile, themePicker, pickerHandlers, pickerError, resolvePick } from '../ui.js';
import { stripAccentsLower } from '../util.js';

// Import state survives re-renders (and leaving the screen and coming back).
let st = { step: 'paste', text: '', parsed: null, theme: '', newTheme: '', newSub: '', subParent: '', items: [], entry: null, keepEntry: true, revealClaude: false, saved: null };

const reset = () => {
  st = { step: 'paste', text: '', parsed: null, theme: st.theme, newTheme: '', newSub: '', subParent: '', items: [], entry: null, keepEntry: true, revealClaude: false, saved: null };
};

// ---------- Words you already have ----------

// The top theme the cards are going into, or null for a brand-new theme.
function importTop() {
  if (st.theme === '__new') return null;
  if (st.theme === '__newsub') return store.themes.get(st.subParent) ? st.subParent : null;
  return store.themes.get(st.theme) ? store.topThemeOf(st.theme) : null;
}

// The existing word card an imported word card duplicates (same top theme, same word), or null.
function existingFor(card) {
  const top = importTop();
  if (!top || card.type !== 'word') return null;
  const words = store.liveCards().filter(c => c.type === 'word' && store.topThemeOf(c.theme) === top);
  return matchExisting([card], words)[0];
}

// Names of the sub-themes a card will go into: its own, or the import's.
function targetNames(card) {
  if (card.subthemes?.length) return card.subthemes;
  let main = '';
  if (st.theme === '__newsub') main = st.newSub.trim();
  else if (st.theme === '__new') main = st.newSub.trim();
  else if (store.themes.get(st.theme) && !store.isTopTheme(st.theme)) main = store.themes.get(st.theme).name;
  return main ? [main, ...(st.parsed?.extraSubs ?? [])] : [];
}

const differs = (card, ex) => card.answer.trim() !== ex.answer || (card.note ?? '').trim() !== ex.note;

function existingHtml(item, ex) {
  const c = item.card;
  const inNames = new Set([ex.theme, ...ex.also_in].map(id => store.themes.get(id)?.name.toLowerCase()).filter(Boolean));
  const names = targetNames(c);
  const toAdd = names.filter(n => !inNames.has(n.toLowerCase()));
  const already = names.filter(n => inNames.has(n.toLowerCase()));
  const where = toAdd.length
    ? `will be added to: ${toAdd.map(esc).join(', ')}${already.length ? ` (already in ${already.map(esc).join(', ')})` : ''}`
    : names.length ? `nothing to add, it's already in ${already.map(esc).join(', ')}` : 'no sub-theme to add it to';
  return `<div class="existing">
    <div><strong>Already in your cards</strong>${ex.status === 'archived' ? ' (archived)' : ''} — ${where}. Its review history is kept.</div>
    ${differs(c, ex) ? `
      <div class="existing-diff">
        <div><span class="muted small">Yours:</span> ${esc(ex.prompts[0])} = ${esc(ex.answer)}${ex.note ? ` <span class="muted">· ${esc(ex.note)}</span>` : ''}</div>
        <div><span class="muted small">Imported:</span> ${esc(c.prompts[0])} = ${esc(c.answer)}${c.note ? ` <span class="muted">· ${esc(c.note)}</span>` : ''}</div>
      </div>
      <label class="check-row"><input type="checkbox" data-change="itemUpdate" data-key="${item.key}" ${item.update ? 'checked' : ''}> Update meaning/note to the imported ones</label>` : ''}
  </div>`;
}

// After saving: link imported words to each other and to your existing words, by name.
// Returns the names that couldn't be found.
async function linkByName(saved, theme) {
  const missing = new Set();
  const key = w => stripAccentsLower(w.trim());
  const batch = new Map(saved.flatMap(({ card }) => card.prompts.map(p => [key(p), card])));
  for (const { card, names } of saved) {
    for (const kind of ['opposite', 'related']) {
      for (const name of names[kind] ?? []) {
        const other = batch.get(key(name)) ?? store.findWord(name, theme);
        if (other && other.id !== card.id) await store.linkWords(card.id, other.id, kind);
        else if (!other) missing.add(name);
      }
    }
  }
  return [...missing];
}

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
  // Use the theme (and sub-theme) the import names, creating them if they're new.
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  const topName = parsed.themeName;
  const subName = parsed.subthemeName ?? '';
  const top = topName && store.themeTree().find(n => same(n.theme.name, topName));
  st.newTheme = '';
  st.newSub = '';
  if (top && subName) {
    const sub = top.children.find(c => same(c.name, subName));
    if (sub) st.theme = sub.id;
    else Object.assign(st, { theme: '__newsub', subParent: top.theme.id, newSub: subName });
  } else if (top) {
    st.theme = top.theme.id;
  } else if (topName) {
    Object.assign(st, { theme: '__new', newTheme: topName, newSub: subName });
  } else if (!st.theme || !store.themes.get(st.theme)) {
    st.theme = store.themeTree()[0]?.theme.id ?? '__new';
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
      <label>${c.type === 'word' ? 'Word' : 'Question'} <span class="muted">(${c.type === 'word' ? 'other accepted forms on further lines' : 'one wording per line'})</span>
        <textarea rows="2" data-input="itemPrompts" data-key="${item.key}">${esc(c.prompts.join('\n'))}</textarea></label>
      <label>${c.type === 'word' ? 'English' : 'Answer'}<textarea rows="2" data-input="itemAnswer" data-key="${item.key}">${esc(c.answer)}</textarea></label>
      ${c.type === 'word'
        ? `<label>Note<input data-input="itemNote" data-key="${item.key}" value="${esc(c.note ?? '')}"></label>`
        : `<label class="check-row"><input type="checkbox" data-change="itemExact" data-key="${item.key}" ${c.type === 'exact' ? 'checked' : ''}> Marked automatically (short exact answer)</label>`}
      <label class="check-row"><input type="checkbox" data-change="itemUnverified" data-key="${item.key}" ${c.unverified ? 'checked' : ''}> Unverified</label>
      <label>Source<input data-input="itemSource" data-key="${item.key}" value="${esc(c.source)}"></label>
      <label>Sub-themes <span class="muted">(comma separated; leave empty to use the import's)</span><input data-input="itemSubthemes" data-key="${item.key}" value="${esc((c.subthemes ?? []).join(', '))}"></label>
      ${errors.length ? `<div class="errors">${errors.map(esc).join('<br>')}</div>` : ''}
      <div class="row"><button type="button" class="btn btn-small" data-action="doneEdit" data-key="${item.key}">Done</button>
      <button type="button" class="btn btn-small btn-secondary" data-action="discard" data-key="${item.key}">Discard</button></div>
    </li>`;
  }
  const existing = existingFor(c);
  return `<li class="import-item ${item.include ? '' : 'excluded'}">
    <label class="import-check"><input type="checkbox" data-change="include" data-key="${item.key}" ${item.include ? 'checked' : ''} ${errors.length ? 'disabled' : ''} aria-label="Include this card"></label>
    <div class="import-body">
      ${existing ? existingHtml(item, existing) : ''}
      ${c.type === 'word'
        ? `<div class="card-q">${esc(c.prompts[0] ?? '')} <span class="card-a-inline">= ${esc(c.answer)}</span></div>
           ${c.note ? `<div class="card-a muted">${esc(c.note)}</div>` : ''}
           ${c.linkNames?.opposite.length ? `<div class="muted small">Opposite: ${c.linkNames.opposite.map(esc).join(', ')}</div>` : ''}
           ${c.linkNames?.related.length ? `<div class="muted small">Related: ${c.linkNames.related.map(esc).join(', ')}</div>` : ''}`
        : `${c.prompts.map((p, i) => `<div class="card-q ${i ? 'alt' : ''}">${i ? '<span class="muted small">or: </span>' : ''}${multiline(p)}</div>`).join('')}
      <div class="card-a">${multiline(c.answer)}</div>`}
      ${c.subthemes?.length && !existing ? `<div class="muted small">Sub-themes: ${c.subthemes.map(esc).join(', ')}</div>` : ''}
      <div class="muted small">${[c.type === 'exact' ? 'Marked automatically' : c.type === 'word' ? 'Language word, tested both ways' : '', c.source ? `Source: ${esc(c.source)}` : '', c.unverified ? '<span class="warn-text">Unverified</span>' : ''].filter(Boolean).join(' · ')}</div>
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

Theme: Spanish / Verbs
esconder = to hide; opposite: encontrar
tener = to have; note: e→ie, irregular 1st person</pre>
      <p class="muted small">Several Q: lines before one A: are alternative wordings of the same card. Lines like <code>word = meaning</code> make language words, tested both ways. A card can have its own sub-themes: <code>; subthemes: Verbs, Irregular</code> on a word line, or a <code>Subthemes:</code> line in a Q/A card. <a href="#/coach">Instructions for Claude</a></p>
      <textarea class="paste" rows="10" data-input="text" placeholder="Paste here">${esc(st.text)}</textarea>
      ${err ? `<div class="errors">${esc(err)}</div>` : ''}
      <div class="row">
        <button type="button" class="btn btn-grow" data-action="preview">Preview</button>
        <label class="btn btn-secondary file-btn">Choose file<input type="file" accept=".json,.txt,.md,text/plain,application/json" data-change="file" hidden></label>
      </div>
    </main>`;
}

function saveLabel(n) {
  const existing = chosen().filter(i => existingFor(i.card)).length;
  if (!existing) return `Save ${n} card${n === 1 ? '' : 's'}`;
  const fresh = n - existing;
  return fresh ? `Save ${fresh} new, ${existing} existing` : `Save ${existing} existing card${existing === 1 ? '' : 's'}`;
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
      ${themePicker(st)}
      ${st.parsed.extraSubs?.length ? `<p class="muted small">Also added to: ${st.parsed.extraSubs.map(esc).join(', ')}</p>` : ''}
      ${st.items.some(i => i.card.subthemes?.length) ? `<p class="muted small">Cards that list their own sub-themes go only into those, within this theme.</p>` : ''}

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
        <button type="button" class="btn btn-grow" data-action="save" ${n ? '' : 'disabled'}>${saveLabel(n)}</button>
        <button type="button" class="btn btn-secondary" data-action="cancel">Cancel</button>
      </div>
    </main>`;
}

function savedHtml() {
  const s = st.saved;
  return `
    ${header('Saved')}
    <main class="page center">
      ${s.count ? `<p class="big-number">${s.count}</p>
      <p>new card${s.count === 1 ? '' : 's'} saved to <strong>${esc(s.themeName)}</strong>${s.entry ? `, with the entry “${esc(s.entry)}”` : ''}.</p>` : '<p>No new cards.</p>'}
      ${s.added ? `<p>${s.added} existing card${s.added === 1 ? ' was' : 's were'} added to sub-themes.</p>` : ''}
      ${s.unchanged ? `<p class="muted">${s.unchanged} card${s.unchanged === 1 ? ' was' : 's were'} already in your cards and ${s.unchanged === 1 ? 'its' : 'their'} sub-themes.</p>` : ''}
      ${s.updated ? `<p class="muted">Meaning/note updated on ${s.updated} existing card${s.updated === 1 ? '' : 's'}.</p>` : ''}
      ${s.missing?.length ? `<p class="notice">Not linked, because they aren't in your cards yet: ${s.missing.map(esc).join(', ')}.</p>` : ''}
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
      ...pickerHandlers(st).inputs,
      itemPrompts(el) { find(el).card.prompts = el.value.split('\n').map(s => s.trim()).filter(Boolean); },
      itemAnswer(el) { find(el).card.answer = el.value; },
      itemSource(el) { find(el).card.source = el.value; },
      itemNote(el) { find(el).card.note = el.value; },
      itemSubthemes(el) { find(el).card.subthemes = el.value.split(',').map(x => x.trim()).filter(Boolean); },
    },
    changes: {
      async file(el) {
        const f = el.files?.[0];
        if (!f) return;
        st.text = await readFile(f);
        preview();
        render();
      },
      ...pickerHandlers(st).changes,
      keepEntry(el) { st.keepEntry = el.checked; },
      include(el) { find(el).include = el.checked; render(); },
      itemExact(el) { find(el).card.type = el.checked ? 'exact' : 'concept'; },
      itemUnverified(el) { find(el).card.unverified = el.checked; },
      itemUpdate(el) { find(el).update = el.checked; },
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
          card: { prompts: [], answer: '', type: 'concept', subthemes: [], accept: [], author: 'me', source: '', unverified: false, tags: [] },
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
        const themeError = pickerError(st);
        if (themeError) return toast(themeError);
        // Words you already have aren't created again (worked out before any new theme is made).
        const matches = items.map(i => existingFor(i.card));
        const theme = await resolvePick(st);
        const top = store.topThemeOf(theme);
        // Extra sub-themes the import names (only when the cards go into a sub-theme).
        const also = [];
        if (!store.isTopTheme(theme)) {
          for (const name of st.parsed.extraSubs ?? []) also.push((await store.addTheme(name, top)).id);
        }
        let entry = null;
        if (st.entry && st.keepEntry) entry = await store.addEntry({ ...st.entry, theme });
        // A card that lists its own sub-themes goes into exactly those (the first is its main one),
        // created under the import's theme if they're new.
        const places = [];
        for (const i of items) {
          const ids = [];
          for (const name of i.card.subthemes ?? []) ids.push((await store.addTheme(name, top)).id);
          places.push(ids.length ? { theme: ids[0], also_in: ids.slice(1) } : { theme, also_in: also });
        }
        const fresh = items.map((i, n) => n).filter(n => !matches[n]);
        const created = await store.addCards(fresh.map(n => {
          const { linkNames, subthemes, ...fields } = items[n].card;
          return { ...fields, ...places[n], entry: entry?.id ?? null };
        }));
        const saved = fresh.map((n, k) => ({ card: created[k], names: items[n].card.linkNames ?? {} }));

        // Existing words: add them to the sub-themes, keep their history, optionally update meaning/note.
        let added = 0, unchanged = 0, updated = 0;
        for (const [n, ex] of matches.entries()) {
          if (!ex) continue;
          const { theme: main, also_in } = places[n];
          let gained = 0;
          for (const t of [main, ...also_in]) if (!store.isTopTheme(t)) gained += (await store.addCardsToTheme([ex.id], t)).added;
          gained ? added++ : unchanged++;
          if (items[n].update && differs(items[n].card, ex)) {
            await store.updateCard(ex.id, { answer: items[n].card.answer, note: items[n].card.note ?? '' });
            updated++;
          }
          saved.push({ card: store.cards.get(ex.id), names: items[n].card.linkNames ?? {} });
        }
        const missing = await linkByName(saved, theme);
        // If cards went to different sub-themes, "Review them now" covers the whole theme.
        const mixed = places.some(p => p.theme !== places[0].theme);
        const shown = mixed ? top : places[0].theme;
        st.saved = { count: created.length, added, unchanged, updated, theme: shown, themeName: store.themeName(shown), entry: entry?.title, missing };
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
