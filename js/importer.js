// Turns pasted text into cards (and optionally a library entry).
// Two formats: JSON (what Claude produces) and simple "Q: / A:" text.

const asArray = v => (v == null ? [] : Array.isArray(v) ? v : [v]);
const str = v => (v == null ? '' : String(v)).trim();
const strList = v => asArray(v).map(str).filter(Boolean);

function extractJson(text) {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  if (!/^[[{]/.test(t)) {
    const first = t.search(/[[{]/);
    const last = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
    if (first === -1 || last <= first) return null;
    t = t.slice(first, last + 1);
  }
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

// Names of linked words: a list, or one string separated by commas.
const nameList = v => asArray(v).flatMap(x => str(x).split(',')).map(x => x.trim()).filter(Boolean);

export function normalizeCard(raw) {
  const isWord = str(raw.type).toLowerCase() === 'word' || raw.word != null;
  const prompts = strList(raw.word ?? raw.prompts ?? raw.questions ?? raw.prompt ?? raw.question ?? raw.q ?? raw.front);
  const answer = str(raw.meaning ?? raw.answer ?? raw.a ?? raw.back);
  const author = str(raw.author).toLowerCase() === 'claude' || raw.suggested === true ? 'claude' : 'me';
  return {
    prompts,
    answer,
    type: isWord ? 'word' : str(raw.type).toLowerCase() === 'exact' ? 'exact' : 'concept',
    note: str(raw.note ?? raw.notes ?? raw.grammar),
    // Linked words by name; turned into links when the cards are saved.
    linkNames: { opposite: nameList(raw.opposites ?? raw.opposite), related: nameList(raw.related) },
    accept: strList(raw.accept ?? raw.alternatives ?? raw.also),
    author,
    source: str(raw.source),
    unverified: raw.unverified === true || str(raw.unverified).toLowerCase() === 'yes',
    tags: strList(raw.tags),
  };
}

function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = str(raw.title);
  if (!title) return null;
  return {
    title,
    summary: str(raw.summary ?? raw.notes ?? raw.body),
    questions: strList(raw.questions ?? raw.my_questions),
    sources: strList(raw.sources ?? raw.source),
  };
}

// "Spanish / Verbs", "Spanish > Verbs" or "Spanish › Verbs" name a theme and sub-theme.
// Several sub-themes are separated by commas: "Spanish / Verbs, Irregular".
function splitTheme(out, theme, subtheme = '') {
  // A slash only separates when it has spaces around it, so "AI/ML" stays one name.
  const parts = str(theme).split(/\s+\/\s+|\s*[›>]\s*/).filter(Boolean);
  out.themeName = parts[0] ?? '';
  const subs = Array.isArray(subtheme) ? subtheme : str(subtheme) ? [subtheme] : parts.slice(1, 2);
  setSubs(out, subs.join(','));
}

function setSubs(out, text) {
  const subs = str(text).split(',').map(x => x.trim()).filter(Boolean);
  out.subthemeName = subs[0] ?? '';
  out.extraSubs = subs.slice(1);
}

// A word line: "esconder = to hide; note: …; opposite: encontrar, mostrar; related: buscar"
const WORD_LINE = /^\s*(?:[-*•]\s*)?([^=:]+?)\s+=\s+(.+)$/;

export function parseWordLine(line) {
  const m = line.match(WORD_LINE);
  if (!m) return null;
  const [meaning, ...extras] = m[2].split(/;\s*(?=(?:note|notes|opposites?|related)\s*:)/i);
  const card = {
    prompts: [m[1].trim()], answer: meaning.trim().replace(/;$/, ''), type: 'word', note: '', linkNames: { opposite: [], related: [] },
    accept: [], author: 'me', source: '', unverified: false, tags: [],
  };
  for (const extra of extras) {
    const kv = extra.match(/^(note|notes|opposites?|related)\s*:\s*(.*)$/i);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    const value = kv[2].trim().replace(/;$/, '');
    if (key.startsWith('note')) card.note = value;
    else card.linkNames[key.startsWith('opposite') ? 'opposite' : 'related'].push(...nameList(value));
  }
  return card;
}

function parseJson(data) {
  const out = { format: 'json', themeName: '', subthemeName: '', extraSubs: [], entry: null, cards: [], warnings: [] };
  let rawCards;
  if (Array.isArray(data)) {
    rawCards = data;
  } else {
    splitTheme(out, data.theme, data.subtheme ?? data.subthemes ?? data.sub_theme ?? data.subTheme);
    out.entry = normalizeEntry(data.entry);
    rawCards = asArray(data.cards);
    if (data.entry && !out.entry) out.warnings.push('The entry was skipped because it has no title.');
  }
  rawCards.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') {
      out.warnings.push(`Item ${i + 1} isn't a card, so it was skipped.`);
      return;
    }
    out.cards.push(normalizeCard(raw));
  });
  return out;
}

// Labels may be bold (**Q:**), numbered (Q1:), or bulleted (- Q:).
const LABEL = /^\s*(?:[-*•]\s*)?(?:\*\*|__)?\s*(q|question|a|answer|source|s|unverified|type|accept|also|tags|theme|sub-?themes?|sub_themes?|note)\s*\d*\s*(?:\*\*|__)?\s*[:.)]\s*(?:\*\*|__)?\s?(.*)$/i;

function parseText(text) {
  const out = { format: 'text', themeName: '', subthemeName: '', extraSubs: [], entry: null, cards: [], warnings: [] };
  let card = null;
  let field = null;

  const finish = () => {
    if (!card) return;
    card.answer = card.answer.trim();
    card.prompts = card.prompts.map(p => p.trim()).filter(Boolean);
    if (card.prompts.length || card.answer) out.cards.push(card);
    card = null;
    field = null;
  };
  const fresh = () => ({
    prompts: [], answer: '', type: 'concept', note: '', linkNames: { opposite: [], related: [] }, accept: [], author: 'me', source: '', unverified: false, tags: [],
  });

  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*```/.test(line)) continue;
    const m = line.match(LABEL);
    if (m) {
      const key = m[1].toLowerCase();
      const value = m[2].trim();
      if (key === 'theme') {
        if (!card) splitTheme(out, value, out.subthemeName);
        continue;
      }
      if (key.startsWith('sub')) {
        if (!card) setSubs(out, value);
        continue;
      }
      if (key === 'q' || key === 'question') {
        // A question after an answer starts a new card; several questions in a row are alternative wordings.
        if (card && (card.answer || field !== 'q')) finish();
        card ??= fresh();
        card.prompts.push(value);
        field = 'q';
        continue;
      }
      card ??= fresh();
      if (key === 'a' || key === 'answer') {
        card.answer = value;
        field = 'a';
      } else if (key === 'source' || key === 's') {
        card.source = value;
        field = null;
      } else if (key === 'unverified') {
        card.unverified = !/^(no|false)$/i.test(value);
        field = null;
      } else if (key === 'type') {
        card.type = /exact/i.test(value) ? 'exact' : /word/i.test(value) ? 'word' : 'concept';
        field = null;
      } else if (key === 'note') {
        card.note = value;
        field = null;
      } else if (key === 'accept' || key === 'also') {
        card.accept.push(...value.split('|').map(s => s.trim()).filter(Boolean));
        field = null;
      } else if (key === 'tags') {
        card.tags.push(...value.split(',').map(s => s.trim()).filter(Boolean));
        field = null;
      }
      continue;
    }
    if (!line.trim()) {
      if (card && card.answer) finish();
      continue;
    }
    // A word line, outside a Q/A card.
    const word = (!card || card.type === 'word') && parseWordLine(line);
    if (word) {
      finish();
      out.cards.push(word);
      continue;
    }
    // Continuation of a multi-line question or answer.
    if (card && field === 'a') card.answer += '\n' + line.trim();
    else if (card && field === 'q') card.prompts[card.prompts.length - 1] += ' ' + line.trim();
  }
  finish();
  return out;
}

export function parseImport(text) {
  const t = String(text ?? '');
  if (!t.trim()) return { format: 'none', themeName: '', entry: null, cards: [], warnings: [], error: 'Nothing to import yet.' };

  const looksJson = /^\s*(```(json)?\s*)?[[{]/i.test(t) || (/"cards"\s*:/.test(t) && /[[{]/.test(t));
  if (looksJson) {
    const data = extractJson(t);
    if (data && typeof data === 'object') return parseJson(data);
    if (!LABEL.test(t.split('\n').find(l => l.trim()) ?? '')) {
      return { format: 'json', themeName: '', entry: null, cards: [], warnings: [], error: "This looks like JSON but couldn't be read. Check it was copied completely." };
    }
  }
  const res = parseText(t);
  if (!res.cards.length) res.error = 'No cards found. Use Q: and A: lines, word = meaning lines, or paste the JSON Claude produced.';
  return res;
}
