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

export function normalizeCard(raw) {
  const prompts = strList(raw.prompts ?? raw.questions ?? raw.prompt ?? raw.question ?? raw.q ?? raw.front);
  const answer = str(raw.answer ?? raw.a ?? raw.back);
  const author = str(raw.author).toLowerCase() === 'claude' || raw.suggested === true ? 'claude' : 'me';
  return {
    prompts,
    answer,
    type: str(raw.type).toLowerCase() === 'exact' ? 'exact' : 'concept',
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

function parseJson(data) {
  const out = { format: 'json', themeName: '', entry: null, cards: [], warnings: [] };
  let rawCards;
  if (Array.isArray(data)) {
    rawCards = data;
  } else {
    out.themeName = str(data.theme);
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
const LABEL = /^\s*(?:[-*•]\s*)?(?:\*\*|__)?\s*(q|question|a|answer|source|s|unverified|type|accept|also|tags|theme)\s*\d*\s*(?:\*\*|__)?\s*[:.)]\s*(?:\*\*|__)?\s?(.*)$/i;

function parseText(text) {
  const out = { format: 'text', themeName: '', entry: null, cards: [], warnings: [] };
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
    prompts: [], answer: '', type: 'concept', accept: [], author: 'me', source: '', unverified: false, tags: [],
  });

  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*```/.test(line)) continue;
    const m = line.match(LABEL);
    if (m) {
      const key = m[1].toLowerCase();
      const value = m[2].trim();
      if (key === 'theme') {
        if (!card) out.themeName = value;
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
        card.type = /exact/i.test(value) ? 'exact' : 'concept';
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
  if (!res.cards.length) res.error = 'No cards found. Use Q: and A: lines, or paste the JSON Claude produced.';
  return res;
}
