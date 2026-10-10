// Gentle hints based on the card-writing rules. These never block saving.

const YES_NO_START = /^(is|are|am|was|were|do|does|did|can|could|will|would|should|shall|has|have|had|may|might|must|isn't|aren't|doesn't|don't|didn't|can't|won't)\b/i;
const ENDS_WITH_CHOICE = /\b[\w'-]+\s+or\s+[\w'-]+(\s+[\w'-]+){0,3}\s*\?\s*$/i;

const words = s => String(s ?? '').trim().split(/\s+/).filter(Boolean).length;

function looksLikeList(answer) {
  const lines = answer.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length >= 2 && lines.filter(l => /^([-*•]|\d+[.)])\s/.test(l)).length >= 2) return true;
  if (/;/.test(answer)) return true;
  // "a, b and c" or "a, b, c, d": several short items separated by commas.
  const parts = answer.split(/,|\band\b|\bor\b/i).map(p => p.trim()).filter(Boolean);
  const enumerated = /,[^,]*\b(and|or)\b/i.test(answer) || answer.split(',').length >= 4;
  return enumerated && parts.length >= 3 && parts.every(p => words(p) <= 4);
}

export function cardHints(card) {
  const hints = [];
  const prompts = (card.prompts ?? []).map(p => String(p ?? '').trim()).filter(Boolean);
  const answer = String(card.answer ?? '').trim();

  for (const p of prompts) {
    const label = prompts.length > 1 ? `“${p.length > 40 ? p.slice(0, 40) + '…' : p}”: ` : '';
    if (YES_NO_START.test(p) && /\sor\s/i.test(p)) {
      hints.push(`${label}This offers choices (A or B?). That tests recognition, not recall. Can you ask for the answer directly?`);
    } else if (YES_NO_START.test(p)) {
      hints.push(`${label}This looks like a yes/no question. Can you make it ask for the answer itself?`);
    } else if (ENDS_WITH_CHOICE.test(p)) {
      hints.push(`${label}This offers choices (A or B?). That tests recognition, not recall.`);
    }
    if (words(p) > 25) hints.push(`${label}This question is long. Could it be shorter, or is it more than one idea?`);
  }

  if (/^(yes|no|true|false)\b/i.test(answer)) {
    hints.push('A yes/no or true/false answer is easy to guess. Can the question ask for the reason or the thing itself?');
  }
  if (answer && looksLikeList(answer)) {
    hints.push('This answer looks like a list. Make one card per item?');
  } else if (words(answer) > 20) {
    hints.push('This answer is long. Is it one idea, or should it be split?');
  }
  if (card.type === 'exact' && words(answer) > 4) {
    hints.push('Auto-marked cards work best with a short answer: a word or a short phrase.');
  }
  return hints;
}

// Problems that do stop a card being saved.
export function cardErrors(card) {
  const errors = [];
  if (!(card.prompts ?? []).some(p => String(p ?? '').trim())) errors.push('A card needs a question.');
  if (!String(card.answer ?? '').trim()) errors.push('A card needs an answer.');
  return errors;
}
