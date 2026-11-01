// Party Night: several games in a row with the same players. Scores, stats
// and drink tallies carry across games; the night ends with an awards
// ceremony. Isomorphic: rooms (lib/rooms.mjs) and one-phone play
// (public/js/pass.js) keep a night with the same functions, and the browser
// computes standings and awards from it for the TV and the recap image.

export const MAX_QUEUE = 12;

export function newNight(now = 0) {
  return { startedAt: now, played: [], points: {}, stats: {}, queue: [] };
}

// Placement points for one finished game: 3 for first, 2 for second, 1 for
// third, ties share the higher place. A game where everyone tied (or nobody
// scored) gives nothing.
export function placementPoints(board) {
  const out = {};
  if (!Array.isArray(board) || board.length < 2) return out;
  const top = Math.max(...board.map((r) => r.score));
  const low = Math.min(...board.map((r) => r.score));
  if (top === low) return out;
  for (const r of board) {
    const rank = 1 + board.filter((x) => x.score > r.score).length;
    const pts = Math.max(0, 4 - rank);
    if (pts) out[r.id] = pts;
  }
  return out;
}

function boardOf(state) {
  if (state.$over && Array.isArray(state.$over.board)) return state.$over.board;
  const scores = state.scores || {};
  const ids = (state.players || []).map((p) => (typeof p === 'string' ? p : p.id));
  return ids.map((id) => ({ id, score: scores[id] || 0 })).sort((a, b) => b.score - a.score);
}

// Fold a game (finished or ended early) into the night. Returns the new
// night; the input is not touched.
export function archiveGame(night, { gameId, name, state, now = 0 }) {
  const n = structuredClone(night);
  const board = boardOf(state);
  const delta = placementPoints(board);
  for (const [id, p] of Object.entries(delta)) n.points[id] = (n.points[id] || 0) + p;
  for (const [id, s] of Object.entries(state.$stats || {})) {
    n.stats[id] = n.stats[id] || {};
    for (const [k, v] of Object.entries(s)) n.stats[id][k] = (n.stats[id][k] || 0) + (Number(v) || 0);
  }
  n.played.push({ gameId, name, board, delta, finished: !!state.$over, at: now });
  if (n.played.length > 40) n.played = n.played.slice(-40);
  return n;
}

// [{ id, points, delta, rank }] best first, for everyone in `ids` (the
// current roster). delta = points from the most recent game.
export function standings(night, ids) {
  const last = night.played[night.played.length - 1];
  const rows = ids.map((id) => ({ id, points: night.points[id] || 0, delta: last ? last.delta[id] || 0 : 0 }));
  rows.sort((a, b) => b.points - a.points);
  for (const r of rows) r.rank = 1 + rows.filter((x) => x.points > r.points).length;
  return rows;
}

// The awards, in ceremony order (Party Champion last). Each has a stat
// source: a night stat key, a drink tally field, or the standings.
export const AWARDS = [
  { key: 'liar', title: 'Best Liar', blurb: 'Bluffed their way past the table', unit: ['bluff', 'bluffs'] },
  { key: 'sleuth', title: 'Super Sleuth', blurb: 'Saw through everyone', unit: ['catch', 'catches'] },
  { key: 'guilty', title: 'Most Guilty', blurb: 'Owned up to the most', unit: ['confession', 'confessions'] },
  { key: 'quiz', title: 'Quiz Champ', blurb: 'Most right answers', unit: ['right answer', 'right answers'] },
  { key: 'artist', title: 'Picasso', blurb: 'Drew it so well people got it', unit: ['drawing guessed', 'drawings guessed'] },
  { key: 'guesser', title: 'Mind Reader', blurb: 'Guessed the most', unit: ['guess', 'guesses'] },
  { key: 'brave', title: 'Fearless', blurb: 'Took on every truth and dare', unit: ['dare done', 'dares done'] },
  { key: 'chicken', title: 'Biggest Chicken', blurb: 'Skipped the most', unit: ['skip', 'skips'] },
  { key: 'crowd', title: 'Hive Mind', blurb: 'Always sided with the crowd', unit: ['crowd pick', 'crowd picks'] },
  { key: 'rebel', title: 'Contrarian', blurb: 'Always the odd one out', unit: ['lone pick', 'lone picks'] },
  { key: 'forfeits', from: 'tally', title: 'Forfeit Hero', blurb: 'Did forfeits instead of drinks', unit: ['forfeit', 'forfeits'] },
  { key: 'gives', from: 'tally', title: 'Most Generous', blurb: 'Handed out the most sips', unit: ['sip given', 'sips given'] },
  { key: 'sips', from: 'tally', title: 'Biggest Sipper', blurb: 'Drank the most sips', unit: ['sip', 'sips'] },
  { key: 'shots', from: 'tally', title: 'Shot Magnet', blurb: 'The wheel loved them', unit: ['shot', 'shots'] },
  { key: 'points', from: 'points', title: 'Party Champion', blurb: 'Top of the night', unit: ['point', 'points'] },
];

// [{ key, title, blurb, winners: [ids], value, label }] for awards someone
// actually earned (value > 0). Ties share the award.
export function awards(night, tally = {}, ids = []) {
  const out = [];
  for (const a of AWARDS) {
    const val = (id) => {
      if (a.from === 'tally') return (tally[id] && tally[id][a.key]) || 0;
      if (a.from === 'points') return night.points[id] || 0;
      return (night.stats[id] && night.stats[id][a.key]) || 0;
    };
    const top = Math.max(0, ...ids.map(val));
    if (top <= 0) continue;
    const winners = ids.filter((id) => val(id) === top);
    if (winners.length > 3) continue; // a five-way tie is not an award
    out.push({ key: a.key, title: a.title, blurb: a.blurb, winners, value: top, label: `${top} ${top === 1 ? a.unit[0] : a.unit[1]}` });
  }
  return out;
}
