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
