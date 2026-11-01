// Would You Rather: two options, everyone picks one in private (room) or the
// host assigns players to a side out loud (pass). The majority scores in
// every tier; the minority drinks, and a lone wolf takes a shot in Deadly.
// Phases: vote -> reveal -> (next) vote ... -> (finish) final -> (playAgain) vote
import {
  pick, fail, addScore, leaderboard, SHOT_SIPS,
  sip, shot, isDeadly, deadlyMoment, deadlyCard, stat, gameOver, teamShot, teamLeaderboard,
} from '../_kit/kit.js';

export const meta = {
  id: 'wyr',
  name: 'Would You Rather',
  emoji: '🤔',
  tagline: 'Two options, everyone picks a side. The odd ones out face the music.',
  blurb: 'A would-you-rather party game: vote A or B in private, then see the split, who ran with the crowd and who is the lone rebel.',
  minPlayers: 2,
  maxPlayers: 16,
  order: 32,
  accent: '#8a7fff',
  pitch: 'Pick a side. The odd ones out pay up',
  minutes: [10, 20],
  vibes: ['silly'],
  modes: ['pass', 'room'],
  teams: true,
  audience: true,
  variants: {
    standard: 'The majority scores a point for running with the crowd. Dead even scores nobody.',
    drinking: 'Whichever side has fewer votes drinks 2. A tie means nobody drinks.',
    deadly: 'Alone on your side: lone wolf, take a shot.',
  },
  options: [
    { key: 'rounds', label: 'Rounds', type: 'stepper', min: 5, max: 20, step: 1, default: 10 },
  ],
  howto: [
    'Read both options out loud. They are meant to be a hard call.',
    'Everyone picks a side, A or B.',
    'Reveal the split: the bigger side scores, the odd ones out pay.',
  ],
};

// A custom pack replaces the built-in pairs outright.
export const pack = {
  label: 'Would-you-rather pairs',
  itemLabel: 'pair',
  fields: [
    { key: 'a', label: 'Option A', type: 'textarea', maxLength: 100, placeholder: 'e.g. Only ever text in emoji' },
    { key: 'b', label: 'Option B', type: 'textarea', maxLength: 100, placeholder: 'e.g. Only ever text in voice notes' },
  ],
  minItems: 6,
  maxItems: 150,
  aiHint: 'This is Would You Rather: each item is two options, "A" and "B", and players privately pick a side. Invent pairs that fit the theme, genuinely tricky or funny to choose between, never a pair where one side is an obviously worse outcome (no real tragedy, no one-sided picks).',
  apply(content, items) {
    return { pairs: items.map((it) => ({ a: it.a, b: it.b })) };
  },
};

const ids = (state) => state.players.map((p) => p.id);
const inGame = (state, id) => state.players.some((p) => p.id === id);
const countPicked = (state) => ids(state).filter((id) => state.picks[id]).length;

function deal(state, ctx) {
  // Late joiners queued during the last round are dealt in from this one.
  for (const id of state.waiting) {
    if (!inGame(state, id)) {
      const p = ctx.players.find((x) => x.id === id);
      if (p) state.players.push({ id: p.id, name: p.name, color: p.color });
    }
  }
  state.waiting = [];
  const pairs = ctx.content.pairs;
  const unused = pairs.map((_, i) => i).filter((i) => !state.used.includes(i));
  const idx = pick(unused.length ? unused : pairs.map((_, i) => i), ctx.rng);
  state.used = [...state.used.slice(-(pairs.length - 1)), idx];
  state.pair = pairs[idx];
  state.picks = {};
  state.audiencePicks = {};
  state.result = null;
  state.phase = 'vote';
}

export function init(ctx) {
  const state = {
    phase: 'vote',
    round: 1,
    players: ctx.players.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    waiting: [],
    used: [],
    picks: {},
    scores: {},
    result: null,
    final: null,
    mode: ctx.mode,
    variant: ctx.variant,
    options: ctx.options,
    // Unique per game, so a client's once-only effects (confetti) never
    // mistake this game's final for an earlier one on the same screen.
    gameKey: String(ctx.now),
  };
  deal(state, ctx);
  return state;
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

function resolve(state) {
  const a = ids(state).filter((id) => state.picks[id] === 'a');
  const b = ids(state).filter((id) => state.picks[id] === 'b');
  let majority = null;
  let minority = null;
  if (a.length && b.length) {
    if (a.length > b.length) { majority = 'a'; minority = 'b'; }
    else if (b.length > a.length) { majority = 'b'; minority = 'a'; }
    // equal counts: no majority, no minority (a genuine tie)
  }
  const drinks = [];
  let loneWolf = null;
  let wipedTeamId = null;
  if (majority) {
    const crowd = majority === 'a' ? a : b;
    const rebels = minority === 'a' ? a : b;
    for (const id of crowd) { addScore(state, id, 1); stat(state, id, 'crowd'); }
    for (const id of rebels) stat(state, id, 'rebel');
    // Deadly: the only one on the small side (3+ voting) is the lone wolf.
    if (isDeadly(state) && rebels.length === 1 && a.length + b.length >= 3) loneWolf = rebels[0];
    // Deadly, teams on: a whole team (2+) landing in the minority shares one
    // team shot instead of sipping individually.
    const wipedTeam = isDeadly(state) && state.teams
      ? state.teams.find((t) => t.memberIds.length >= 2 && t.memberIds.every((id) => rebels.includes(id)))
      : null;
    wipedTeamId = wipedTeam ? wipedTeam.id : null;
    for (const id of rebels) {
      if (wipedTeam) continue;
      drinks.push(id === loneWolf
        ? namedShot(state, id, 'lone wolf', 'Lone Wolf', 'Alone on your side: take a shot')
        : sip(state, id, 2, 'in the minority'));
    }
    if (wipedTeam) drinks.push(...teamShot(state, wipedTeam, 'the whole team picked the minority'));
  }
  // The crowd picks a side too, just for themselves: siding with the
  // eventual minority costs them a sip, but never changes the real result.
  for (const [voter, side] of Object.entries(state.audiencePicks)) {
    if (minority && side === minority) drinks.push(sip(state, voter, 1, 'sided with the crowd\'s minority'));
  }
  state.result = { a, b, majority, minority, loneWolf, wipedTeamId, drinks: drinks.filter(Boolean) };
  state.phase = 'reveal';
}

function finish(state) {
  state.final = {
    board: leaderboard(state, ids(state)),
    teamBoard: state.teams ? teamLeaderboard(state, state.teams) : null,
    rounds: state.round,
  };
  state.phase = 'final';
  state.turn = null;
  gameOver(state, state.final.board);
}

export function act(state, a, ctx) {
  switch (a.type) {
    case 'vote': {
      if (state.phase !== 'vote') return fail('Voting is closed for this round.');
      if (state.mode !== 'room') return fail('On one phone the host assigns players to a side.');
      if (!inGame(state, a.from)) return fail('You are not in this round.');
      if (a.payload !== 'a' && a.payload !== 'b') return fail('Pick A or B.');
      state.picks[a.from] = a.payload;
      if (ids(state).every((id) => state.picks[id])) resolve(state);
      return;
    }
    case 'audienceVote': {
      if (state.phase !== 'vote') return fail('Voting is closed for this round.');
      if (!(state.audience || []).includes(a.from)) return fail('Only the crowd can do that.');
      if (a.payload !== 'a' && a.payload !== 'b') return fail('Pick A or B.');
      state.audiencePicks[a.from] = a.payload;
      return;
    }
    case 'assign': {
      if (!a.host) return fail('Only the host can do that.');
      if (state.phase !== 'vote') return fail('This round is already revealed.');
      if (state.mode !== 'pass') return fail('Assigning players is for one phone.');
      const payload = a.payload || {};
      const { playerId, side } = payload;
      if (!inGame(state, playerId)) return fail('Pick a player in this round.');
      if (side !== 'a' && side !== 'b') return fail('Pick A or B.');
      if (state.picks[playerId] === side) delete state.picks[playerId];
      else state.picks[playerId] = side;
      return;
    }
    case 'reveal':
      if (!a.host) return fail('Only the host can do that.');
      if (state.phase !== 'vote') return fail('Already revealed.');
      resolve(state);
      return;
    case 'next':
      if (!a.host) return fail('Only the host can do that.');
      if (state.phase !== 'reveal') return fail('Reveal this round first.');
      state.round += 1;
      deadlyCard(state, ctx.rng);
      deal(state, ctx);
      return;
    case 'finish':
      if (!a.host) return fail('Only the host can do that.');
      if (state.phase !== 'reveal') return fail('Reveal this round first.');
      finish(state);
      return;
    case 'playAgain':
      if (!a.host) return fail('Only the host can do that.');
      if (state.phase !== 'final') return fail('The game is still going.');
      state.scores = {};
      state.round = 1;
      state.used = [];
      state.final = null;
      state.gameKey = String(ctx.now);
      deal(state, ctx);
      return;
    default:
      return fail('Unknown move.');
  }
}

export function addPlayer(state, player) {
  if (!inGame(state, player.id) && !state.waiting.includes(player.id)) state.waiting.push(player.id);
}

export function removePlayer(state, id) {
  const was = inGame(state, id);
  state.players = state.players.filter((p) => p.id !== id);
  state.waiting = state.waiting.filter((x) => x !== id);
  delete state.audiencePicks[id];
  if (!was) return;
  delete state.picks[id];
  if (state.phase === 'vote' && state.mode === 'room' && ids(state).length && ids(state).every((x) => state.picks[x])) {
    resolve(state);
  }
}

function common(state) {
  return {
    phase: state.phase,
    round: state.round,
    rounds: state.options.rounds,
    players: ids(state),
    waiting: state.waiting,
    pair: state.pair,
    pickedCount: countPicked(state),
    total: ids(state).length,
    // Who still has to pick (never which side anyone picked).
    pending: state.phase === 'vote' ? ids(state).filter((id) => !state.picks[id]) : [],
    scores: leaderboard(state, ids(state)),
    reveal: state.phase === 'reveal' ? state.result : null,
    final: state.final,
    teams: state.teams,
    audienceCount: (state.audience || []).length,
    gameKey: state.gameKey || '',
  };
}

export function playerView(state, playerId) {
  const base = common(state);
  if (!inGame(state, playerId)) {
    const audience = (state.audience || []).includes(playerId);
    return {
      ...base, me: null, waiting: true, audience,
      myPick: audience ? state.audiencePicks[playerId] || null : null,
    };
  }
  return {
    ...base,
    me: playerId,
    // Only this player's own pick ever leaves the engine before reveal.
    myPick: state.mode === 'room' ? state.picks[playerId] || null : null,
  };
}

export function tvView(state) {
  const base = common(state);
  return {
    ...base,
    // Pass mode: the shared screen IS the host's control surface, so it sees
    // every assignment. A room TV never does, even just the aggregate count.
    picks: state.phase === 'vote' && state.mode === 'pass' ? state.picks : null,
  };
}

export function hostActions(state) {
  switch (state.phase) {
    case 'vote': {
      if (state.mode === 'pass') return [{ type: 'reveal', label: 'Reveal', tone: 'primary' }];
      const allPicked = ids(state).length > 0 && countPicked(state) >= ids(state).length;
      return [{
        type: 'reveal',
        label: 'Reveal votes',
        tone: allPicked ? 'primary' : 'secondary',
        ...(allPicked ? {} : { confirm: 'Not everyone has voted yet. Reveal anyway?' }),
      }];
    }
    case 'reveal':
      return [state.round >= state.options.rounds
        ? { type: 'finish', label: 'See the results', tone: 'primary' }
        : { type: 'next', label: 'Next round', tone: 'primary' }];
    case 'final':
      return [{ type: 'playAgain', label: 'Play again', tone: 'primary' }];
    default:
      return [];
  }
}

// Would You Rather has no private step: the shared screen runs the whole
// game in pass and play (the host assigns players out loud).
export function passTurn() {
  return null;
}

export function bot(state, playerId, ctx) {
  if (playerId === null) {
    if (state.phase === 'vote' && state.mode === 'pass') {
      const unassigned = ids(state).filter((id) => !state.picks[id]);
      if (unassigned.length && ctx.rng() < 0.85) {
        return { type: 'assign', payload: { playerId: pick(unassigned, ctx.rng), side: ctx.rng() < 0.5 ? 'a' : 'b' } };
      }
    }
    const acts = hostActions(state);
    return acts.length ? { type: pick(acts, ctx.rng).type, payload: null } : null;
  }
  if (!inGame(state, playerId)) {
    if ((state.audience || []).includes(playerId) && state.phase === 'vote' && !state.audiencePicks[playerId]) {
      return { type: 'audienceVote', payload: ctx.rng() < 0.5 ? 'a' : 'b' };
    }
    return null;
  }
  if (state.phase === 'vote' && state.mode === 'room' && !state.picks[playerId]) {
    return { type: 'vote', payload: ctx.rng() < 0.5 ? 'a' : 'b' };
  }
  return null;
}
