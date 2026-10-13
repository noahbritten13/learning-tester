// Marking typed answers for auto-marked ("exact") cards.

export function normalize(s) {
  return String(s ?? '')
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^[¿¡"'“‘(\[]+|[.!?,;:"'”’)\]]+$/g, '')
    .trim();
}

export function stripAccents(s) {
  return s.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
}

// accepted: every answer that counts as right (the main answer first).
// Returns { result: 'correct' | 'accent' | 'wrong' | 'blank', expected }
//   'accent' = right apart from accents; counts as right unless strict.
export function checkAnswer(input, accepted, { strictAccents = false } = {}) {
  const given = normalize(input);
  const answers = accepted.map(a => String(a ?? '')).filter(a => normalize(a));
  if (!given) return { result: 'blank', expected: answers[0] ?? '' };

  for (const a of answers) {
    if (normalize(a) === given) return { result: 'correct', expected: a };
  }
  const bare = stripAccents(given);
  for (const a of answers) {
    if (stripAccents(normalize(a)) === bare) {
      return { result: strictAccents ? 'wrong' : 'accent', expected: a };
    }
  }
  return { result: 'wrong', expected: answers[0] ?? '' };
}

export const isRight = r => r === 'correct' || r === 'accent';

// ---------- Word cards ----------
// A word card's meaning is a list like "to take, to consume (often drinks)".
// Commas (or semicolons) separate meanings; words in brackets are clarifiers:
// shown, but optional to type. A leading "to" is optional too.

// Split at commas and semicolons that aren't inside brackets.
export function splitMeanings(text) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of String(text ?? '')) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if ((ch === ',' || ch === ';') && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim()).filter(Boolean);
}

const withoutBrackets = s => s.replace(/\s*[([][^)\]]*[)\]]\s*/g, ' ').replace(/\s+/g, ' ').trim();
const withoutTo = s => s.replace(/^to\s+/i, '');

// Every typed form that counts as one meaning.
export function meaningForms(meaning) {
  const forms = new Set();
  for (const f of [meaning, withoutBrackets(meaning)]) {
    const n = normalize(f.replace(/[()[\]]/g, ''));
    if (n) {
      forms.add(n);
      forms.add(withoutTo(n));
    }
  }
  return [...forms];
}

// The key two words must share to mean the same thing (clarifiers included,
// so "to be (temporary)" and "to be (permanent)" stay different).
export const meaningKey = m => stripAccents(withoutTo(normalize(m)));

// Marks a typed meaning for a word card (word → meaning).
// meanings: the card's meanings plus any other accepted answers.
// Right if the typed text matches a meaning, or if it lists several and each matches one.
export function checkMeaning(input, meanings, { strictAccents = false } = {}) {
  const expected = meanings[0] ?? '';
  const given = normalize(input);
  if (!given) return { result: 'blank', expected };
  const forms = meanings.flatMap(meaningForms);
  const test = (text, strict) => {
    const n = normalize(text.replace(/[()[\]]/g, ' '));
    const variants = [n, withoutTo(n)];
    const bare = v => stripAccents(v);
    if (variants.some(v => forms.includes(v))) return 'correct';
    if (!strict && variants.some(v => forms.some(f => bare(f) === bare(v)))) return 'accent';
    return 'wrong';
  };
  const whole = test(given, strictAccents);
  if (whole !== 'wrong') return { result: whole, expected };
  const parts = splitMeanings(given).flatMap(p => p.split(/\s+or\s+|\s*\/\s*/)).filter(p => normalize(p));
  if (parts.length > 1) {
    const marks = parts.map(p => test(p, strictAccents));
    if (marks.every(m => m !== 'wrong')) return { result: marks.includes('accent') ? 'accent' : 'correct', expected };
  }
  return { result: 'wrong', expected };
}
