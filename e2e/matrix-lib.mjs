// Shared by e2e/matrix.mjs, matrix-browser.mjs and qa-edge.mjs: what a game
// is dealing right now (for the duplicate and empty-prompt checks), the
// per-run problem tracker, and the bots' move picker.
import * as rt from '../games/_kit/runtime.js';

// The deck item a game is showing right now, as one string, or null.
export const ITEM = {
  'fake-out': (s) => s.prompt && s.prompt.text,
  heads: (s) => s.word,
  imposter: (s) => s.word,
  mlt: (s) => s.prompt,
  nhie: (s) => s.prompt,
  paranoia: (s) => s.question,
  'quiz-show': (s) => s.round && s.round.question && s.round.question.text,
  sketchy: (s) => s.word,
  spyfall: (s) => s.location && s.location.label,
  tod: (s) => s.prompt && s.prompt.text,
  'tune-in': (s) => s.spectrum && `${s.spectrum.left} | ${s.spectrum.right}`,
  wyr: (s) => s.pair && `${s.pair.a} | ${s.pair.b}`,
};
// How many distinct items the deck could deal in this game (repeats are only
// a bug while unseen items were left).
export function deckSize(gameId, content, state) {
  const c = content || {};
  switch (gameId) {
    case 'fake-out': case 'mlt': case 'paranoia': return (c.prompts || c.questions || []).length;
    case 'nhie': return (c.prompts || []).length + (state.options.spicy ? (c.spicy || []).length : 0);
    case 'wyr': return (c.pairs || []).length;
    case 'tune-in': return (c.spectrums || []).length;
    case 'spyfall': return (c.locations || []).length;
    case 'sketchy': return ['easy', 'medium', 'hard'].reduce((n, k) => n + (c[k] || []).length, 0);
    // Heads deals from a shuffled deck of the picked categories, reshuffled
    // when it runs out.
    case 'heads': return new Set(state.deck || []).size;
    case 'imposter': {
      const cats = c.categories || {};
      const key = state.options.category;
      const list = cats[key] ? [cats[key]] : Object.values(cats);
      return new Set(list.flatMap((x) => x.items)).size;
    }
    default: return Infinity;
  }
}

export class Tracker {
  constructor(gameId, content) {
    this.gameId = gameId;
    this.content = content;
    this.seen = new Map(); // item -> times dealt
    this.last = null;
    this.problems = [];
    this.deals = 0;
  }
  problem(p) { if (!this.problems.includes(p) && this.problems.length < 12) this.problems.push(p); }
  state(s) {
    const f = ITEM[this.gameId];
    if (f) {
      const item = f(s);
      if (item !== null && item !== undefined) {
        if (typeof item !== 'string' || !item.trim() || /undefined|\[object Object\]/.test(item)) this.problem(`empty or broken item: ${JSON.stringify(item)}`);
        else if (item !== this.last) {
          this.deals++;
          const n = (this.seen.get(item) || 0) + 1;
          this.seen.set(item, n);
          const size = deckSize(this.gameId, this.content, s);
          if (n > 1 && this.seen.size < size) this.problem(`dealt twice (${this.seen.size} of ${size === Infinity ? '?' : size} seen): ${item}`);
        }
        this.last = item;
      }
    }
    if (this.gameId === 'codewords' && Array.isArray(s.tiles)) {
      const words = s.tiles.map((t) => t.word);
      if (new Set(words.map((w) => w.toLowerCase())).size !== words.length) this.problem(`board repeats a word: ${words.join(', ')}`);
    }
    if (this.gameId === 'heads' && Array.isArray(s.deck)) {
      const dup = s.deck.filter((w, i) => s.deck.indexOf(w) !== i);
      if (dup.length) this.problem(`deck deals a card twice: ${[...new Set(dup)].join(', ')}`);
    }
  }
  html(markup, where) {
    const m = /undefined|\[object Object\]|\bNaN\b/.exec(markup);
    if (m) this.problem(`${where} renders "${m[0]}": ...${markup.slice(Math.max(0, m.index - 80), m.index + 40).replace(/\s+/g, ' ')}...`);
    const text = markup.replace(/<[^>]*>/g, ' ');
    const n = /\bnull\b/.exec(text);
    if (n) this.problem(`${where} shows "null": ...${text.slice(Math.max(0, n.index - 60), n.index + 30).replace(/\s+/g, ' ')}...`);
    const empty = /<(h1|h2|h3|p|div|span|blockquote)\b[^>]*class="[^"]*\b(q|prompt|question|tv-big|lead-line|card-text)\b[^"]*"[^>]*>\s*<\/\1>/.exec(markup);
    if (empty) this.problem(`${where} has an empty ${empty[2]} element`);
  }
}

// The bot's moves for one seat, minus the "End game early?"-style shortcuts
// (host actions that ask to confirm) unless nothing else is possible, so a
// run plays real rounds instead of ending at the first chance.
export function botMoves(engine, state, seats, ctx) {
  const confirmTypes = new Set(rt.hostActionsOf(engine, state, ctx).filter((a) => a.confirm).map((a) => a.type));
  const moves = [];
  for (const who of seats) {
    let a = null;
    try { a = engine.bot(state, who, ctx); } catch (err) { throw new Error(`bot threw for ${who}: ${err.message}`); }
    if (a) moves.push({ who, a, shortcut: who === null && confirmTypes.has(a.type) });
  }
  const real = moves.filter((m) => !m.shortcut);
  return real.length ? real : moves;
}
