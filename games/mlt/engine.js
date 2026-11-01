// Most Likely To: a prompt is read out, everyone votes for the player who
// fits it best (never themselves). Most votes gets crowned for the round.
// Phases: vote -> reveal -> (next) vote ... -> final -> (playAgain) vote ...
import {
  pick, fail, addScore, leaderboard, SHOT_SIPS,
  sip, shot, isDeadly, deadlyReady, deadlyMoment, deadlyCard, stat, gameOver, teamOf, teamShot, teamLeaderboard,
  startTimer, stopTimer, timerDeadline,
} from '../_kit/kit.js';

export const meta = {
  id: 'mlt',
  name: 'Most Likely To',
  emoji: '🏆',
  tagline: 'Who in this group fits the prompt best? Vote them in.',
  blurb: 'A party game: read out a "most likely to" prompt, everyone votes for the player who fits it, and the most-voted player gets crowned for the round.',
  minPlayers: 3,
  maxPlayers: 16,
  order: 31,
  accent: '#ff7847',
  pitch: 'Vote for who in the group fits the prompt',
  minutes: [10, 20],
  vibes: ['silly'],
  modes: ['pass', 'room'],
  teams: true,
  audience: true,
  howto: [
    'Read the prompt out: most likely to...',
    'Vote for the player who fits it best, never yourself',
    'Most votes is crowned for the round. Most crowns wins',
  ],
  variants: {
    standard: 'The crowned player scores a point. Most crowns after the last round wins.',
    drinking: 'The crowned player drinks 2. A true tie means everyone tied drinks 1 instead.',
    deadly: 'Crowned by every single vote: take a shot. Never twice within 3 minutes.',
  },
  options: [
    { key: 'rounds', label: 'Rounds', type: 'stepper', min: 5, max: 20, step: 1, default: 10 },
  ],
};

// Curated packs (games/mlt/packs/) need no code here; this only names one
// item in the pack picker.
export const curated = { itemLabel: 'prompt' };

// Once half the table has voted, everyone else gets this long. A locked phone
// or a wandering player must never hold the room on one prompt.
const VOTE_GRACE_MS = 30_000;

const ids = (state) => state.players.map((p) => p.id);
const inGame = (state, id) => state.players.some((p) => p.id === id);

function deal(state, ctx) {
  // Late joiners are dealt in from the next round.
  for (const id of state.waiting) if (!inGame(state, id)) {
    const p = ctx.players.find((x) => x.id === id);
    if (p) state.players.push({ id: p.id, name: p.name, color: p.color });
  }
  state.waiting = [];
  const pool = ctx.content.prompts;
  const unused = pool.filter((q) => !state.used.includes(q));
  const prompt = pick(unused.length ? unused : pool, ctx.rng);
  state.used = [...state.used.slice(-60), prompt];
  state.prompt = prompt;
  state.votes = {};
  state.audienceVotes = {};
  state.result = null;
  state.timer = null;
  state.phase = 'vote';
}

// Room only: start the grace clock the moment half the table (at least two)
// has voted. It never restarts, and a full table resolves before it fires.
function armVoteClock(state, ctx) {
  if (state.mode !== 'room' || state.phase !== 'vote' || state.timer) return;
  const cast = ids(state).filter((id) => state.votes[id]).length;
  if (cast >= Math.max(2, Math.ceil(ids(state).length / 2))) startTimer(state, VOTE_GRACE_MS, ctx.now, 'voteTimeUp');
}

export function init(ctx) {
  const state = {
    phase: 'vote',
    round: 1,
    players: ctx.players.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    waiting: [],
    used: [],
    scores: {},
    prompt: null,
    votes: {},
    result: null,
    final: null,
    mode: ctx.mode,
    variant: ctx.variant,
    options: ctx.options,
  };
  deal(state, ctx);
  return state;
}

// Every id with the highest vote count. A clean tie returns more than one.
function tally(votes) {
  const counts = {};
  for (const target of Object.values(votes)) counts[target] = (counts[target] || 0) + 1;
  const entries = Object.entries(counts);
  if (!entries.length) return [];
  const max = Math.max(...entries.map(([, n]) => n));
  return entries.filter(([, n]) => n === max).map(([id]) => id);
}

// A rule shot with its own takeover title. The line is written here (not
// left to the runtime) so the moment names the player on every path.
function namedShot(state, id, why, title, sub) {
  const e = shot(state, id, why);
  if (e && isDeadly(state) && e.unit !== 'forfeit') {
    const text = e.unit === 'shot' ? 'takes a shot' : `drinks ${SHOT_SIPS} instead (shot cap)`;
    deadlyMoment(state, { kind: 'shot', title, sub, targets: [id], lines: [{ playerId: id, text }] });
  }
  return e;
}

// Unanimous: one crown, 3+ votes cast, and every vote from anyone else went
// to the crowned player (they can't vote for themselves). With three or four
// players that happens in most rounds, so in a room AND on one phone it only
// pours a shot when no Deadly moment fired in the last few minutes
// (deadlyReady). Otherwise it is the usual 2 sips, and the screens do not
// promise a shot. On one phone the group calls the crown out loud, so a crown
// the host taps counts as the table's unanimous call.
function unanimous(state, winners, votes, fromPass) {
  if (winners.length !== 1 || !isDeadly(state) || !deadlyReady(state)) return false;
  if (fromPass) return ids(state).length >= 3;
  const cast = Object.entries(votes);
  const others = cast.filter(([voter]) => voter !== winners[0]);
  return cast.length >= 3 && others.length >= 2 && others.every(([, t]) => t === winners[0]);
}

function resolve(state, winners, fromPass = false) {
  const votes = { ...state.votes };
  const crowned = unanimous(state, winners, votes, fromPass);
  const drinks = [];
  for (const id of winners) {
    addScore(state, id, 1); // crown count: the round score in every tier
    stat(state, id, 'guilty');
  }
  let crownedTeamId = null;
  if (crowned) {
    // Crowned by every single vote with teams on: the whole team shares the
    // shot, not just the one who got crowned.
    const team = state.teams ? teamOf(state.teams, winners[0]) : null;
    if (team) {
      crownedTeamId = team.id;
      drinks.push(...teamShot(state, team, 'crowned by every vote'));
    } else {
      drinks.push(namedShot(state, winners[0], 'crowned by every vote', 'Unanimous', 'Crowned by every single vote: take a shot'));
    }
  } else if (winners.length === 1) drinks.push(sip(state, winners[0], 2, 'crowned this round'));
  else for (const id of winners) drinks.push(sip(state, id, 1, 'tied for the crown'));
  // The crowd votes too, just for themselves: picking someone who wasn't
  // crowned costs them a sip, never anyone else's score.
  for (const [voter, target] of Object.entries(state.audienceVotes || {})) {
    if (!winners.includes(target)) drinks.push(sip(state, voter, 1, 'picked wrong'));
  }
  state.result = { winners, votes, unanimous: crowned, crownedTeamId, drinks: drinks.filter(Boolean) };
  stopTimer(state);
  state.phase = 'reveal';
}

function finish(state) {
  state.final = {
    board: leaderboard(state, ids(state)),
    teamBoard: state.teams ? teamLeaderboard(state, state.teams) : null,
  };
  state.phase = 'final';
  gameOver(state, state.final.board);
}

export function act(state, a, ctx) {
  const { type, payload, from, host } = a;
  switch (type) {
    case 'vote': {
      if (state.phase !== 'vote') return fail('Voting is not open.');
      if (state.mode !== 'room') return fail('On one phone the host records the winner.');
      if (!inGame(state, from)) return fail('You are not in this round.');
      if (payload === from) return fail('You cannot vote for yourself.');
      if (!inGame(state, payload)) return fail('Pick a player in this round.');
      state.votes[from] = payload;
      if (ids(state).every((id) => state.votes[id])) resolve(state, tally(state.votes));
      else armVoteClock(state, ctx);
      return;
    }
    case 'voteTimeUp':
      // The room's clock only (runtime deadline). A player or the host cannot call it.
      if (!a.system) return fail('Only the clock can do that.');
      if (state.phase !== 'vote') return fail('Voting is not open.');
      resolve(state, tally(state.votes));
      return;
    case 'audienceVote': {
      if (state.phase !== 'vote') return fail('Voting is not open.');
      if (!(state.audience || []).includes(from)) return fail('Only the crowd can do that.');
      if (!inGame(state, payload)) return fail('Pick a player in this round.');
      state.audienceVotes[from] = payload;
      return;
    }
    case 'closeVote':
      if (!host) return fail('Only the host can do that.');
      if (state.phase !== 'vote') return fail('Voting is not open.');
      if (state.mode !== 'room') return fail('On one phone the host records the winner.');
      resolve(state, tally(state.votes));
      return;
    case 'accuse':
      // One phone: the group calls it out loud, the host taps who it was.
      if (!host) return fail('Only the host can do that.');
      if (state.phase !== 'vote') return fail('Voting is not open.');
      if (state.mode !== 'pass') return fail('In a room, everyone votes on their own phone.');
      if (payload !== null && !inGame(state, payload)) return fail('Pick a player in this round.');
      resolve(state, payload === null ? [] : [payload], true);
      return;
    case 'next':
      if (!host) return fail('Only the host can do that.');
      if (state.phase !== 'reveal') return fail('Finish this round first.');
      if (state.round >= state.options.rounds) finish(state);
      else { state.round += 1; deadlyCard(state, ctx.rng); deal(state, ctx); }
      return;
    case 'playAgain':
      if (!host) return fail('Only the host can do that.');
      if (state.phase !== 'final') return fail('The game is still going.');
      state.scores = {};
      state.round = 1;
      deal(state, ctx);
      return;
    default:
      return fail('Unknown move.');
  }
}

export function addPlayer(state, player) {
  if (!inGame(state, player.id) && !state.waiting.includes(player.id)) state.waiting.push(player.id);
}

export function removePlayer(state, id, ctx) {
  state.players = state.players.filter((p) => p.id !== id);
  state.waiting = state.waiting.filter((x) => x !== id);
  delete state.votes[id];
  delete state.audienceVotes[id];
  for (const [voter, target] of Object.entries(state.votes)) if (target === id) delete state.votes[voter];
  for (const [voter, target] of Object.entries(state.audienceVotes)) if (target === id) delete state.audienceVotes[voter];
  if (state.phase === 'vote' && state.mode === 'room' && state.players.length && ids(state).every((x) => state.votes[x])) {
    resolve(state, tally(state.votes));
  } else if (ctx) armVoteClock(state, ctx);
}

// Half the table in starts a short clock for the rest (see armVoteClock).
export function deadline(state) {
  return timerDeadline(state);
}

function common(state) {
  return {
    phase: state.phase,
    round: state.round,
    roundsTotal: state.options.rounds,
    prompt: state.prompt,
    players: ids(state),
    waiting: state.waiting,
    voted: ids(state).filter((id) => state.votes[id]),
    scores: leaderboard(state, ids(state)),
    final: state.final,
    // Deadly telegraph: can a crown pour a shot right now? Not during the 3 minute gap after a moment.
    shotLive: isDeadly(state) && ids(state).length >= 3 && deadlyReady(state),
    timer: state.timer || null,
    teams: state.teams,
    audienceCount: (state.audience || []).length,
  };
}

function resultView(state) {
  if (state.phase !== 'reveal') return null;
  return { ...state.result };
}

export function playerView(state, playerId) {
  const base = common(state);
  if (!inGame(state, playerId)) {
    const audience = (state.audience || []).includes(playerId);
    // The reveal is public by then (the TV shows it), so watchers get it too.
    return { ...base, me: null, waiting: true, audience, myVote: audience ? state.audienceVotes[playerId] || null : null, result: resultView(state) };
  }
  return {
    ...base,
    me: playerId,
    myVote: state.votes[playerId] || null,
    result: resultView(state),
  };
}

export function tvView(state) {
  return { ...common(state), result: resultView(state) };
}

export function hostActions(state) {
  switch (state.phase) {
    case 'vote':
      return state.mode === 'room' ? [{ type: 'closeVote', label: 'Crown now', tone: 'secondary', confirm: 'Count the votes now?' }] : [];
    case 'reveal':
      return [{ type: 'next', label: state.round >= state.options.rounds ? 'See the results' : 'Next prompt', tone: 'primary' }];
    case 'final':
      return [{ type: 'playAgain', label: 'Play again', tone: 'primary' }];
    default:
      return [];
  }
}

// Most Likely To is never a private look: in pass and play the group calls
// it out loud on the shared screen.
export function passTurn() {
  return null;
}

export function bot(state, playerId, ctx) {
  if (playerId === null) {
    if (state.phase === 'vote' && state.mode === 'pass') {
      return { type: 'accuse', payload: ctx.rng() < 0.15 ? null : pick(ids(state), ctx.rng) };
    }
    const acts = hostActions(state);
    return acts.length ? { type: pick(acts, ctx.rng).type, payload: null } : null;
  }
  if (!inGame(state, playerId)) {
    if ((state.audience || []).includes(playerId) && state.phase === 'vote' && !state.audienceVotes[playerId] && ids(state).length) {
      return { type: 'audienceVote', payload: pick(ids(state), ctx.rng) };
    }
    return null;
  }
  if (state.phase === 'vote' && state.mode === 'room' && !state.votes[playerId]) {
    return { type: 'vote', payload: pick(ids(state).filter((id) => id !== playerId), ctx.rng) };
  }
  return null;
}
