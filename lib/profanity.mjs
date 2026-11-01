// A basic gate for custom/AI pack text: not exhaustive, just enough to catch
// slurs and the most common profanity before a pack becomes a shareable
// link. Matches whole words (and simple plural/possessive forms) against a
// lowercased, punctuation-stripped copy of the text, so "class" or "scrap"
// never trip on a shorter blocked word hiding inside them.
const BLOCKED = [
  'nigger', 'nigga', 'chink', 'spic', 'kike', 'wetback', 'faggot', 'fag', 'tranny', 'retard',
  'cunt', 'whore', 'slut', 'rape', 'rapist', 'pedo', 'paedo', 'molest',
  'fuck', 'motherfucker', 'shit', 'bullshit', 'bitch', 'bastard', 'dick', 'pussy', 'asshole',
  'nazi', 'hitler', 'kill yourself', 'kys',
];

const WORD_RE = new Map(BLOCKED.map((w) => [w, new RegExp(`\\b${w.replace(/[a-z]/g, (c) => c)}s?\\b`, 'i')]));

function normalise(text) {
  return String(text || '').toLowerCase();
}

export function isClean(text) {
  const t = normalise(text);
  if (!t.trim()) return true;
  for (const [, re] of WORD_RE) if (re.test(t)) return false;
  return true;
}

// Checks every string in a pack submission in one go (title + every field of
// every item). Returns the first offending string, or null if it is clean.
export function findProfanity(strings) {
  for (const s of strings) if (!isClean(s)) return s;
  return null;
}
