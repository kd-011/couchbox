// Spyfall: everyone except the Spy shares a secret location and gets a role
// there. The Spy only knows they're the Spy. Phases:
// reveal -> discuss -> vote -> spyLastChance (conditional) -> result -> (nextRound) reveal ...
//
// Secrecy model: state.location and state.roles are dealt at the top of the
// round and never appear in a view until the vote actually catches the Spy
// (spyLastChance: the table now knows who they voted out is the Spy, but
// the location itself stays hidden right to the result) or the round ends.
import {
  shuffle, pick, fail, addScore, leaderboard,
  sip, shot, giveOut, isDeadly, deadlyCard, stat, gameOver, toast,
  startTimer, pauseTimer, resumeTimer, addTime, stopTimer, timerDeadline,
} from '../_kit/kit.js';

export const meta = {
  id: 'spyfall',
  name: 'Spyfall',
  emoji: '🕶️',
  tagline: 'Everyone knows the secret location except the spy. The spy has to work it out, or guess it before they get caught.',
  blurb: 'A bluffing and deduction game: everyone at the table shares a secret location except the spy, who has to work it out from the conversation before the table works out them.',
  minPlayers: 3,
  maxPlayers: 8,
  order: 120,
  accent: '#f59f00',
  pitch: 'Everyone knows the place except the spy',
  minutes: [10, 20],
  vibes: ['bluff'],
  modes: ['pass', 'room'],
  howto: [
    "Check your card: the location and your role, or that you're the spy",
    'Take turns asking questions about the place without naming it',
    'Vote out the spy. The spy wins by escaping or naming the location',
  ],
  variants: {
    standard: 'Catch the spy and the crew scores a point each; a spy who gets away or guesses right scores 2.',
    drinking: 'A caught spy drinks 3 (or talks their way out with a guess); a spy who gets away sends the whole crew sipping.',
    deadly: 'The spy caught red-handed takes a shot.',
  },
  options: [
    { key: 'minutes', label: 'Discussion', type: 'stepper', min: 1, max: 10, step: 1, default: 5, suffix: ' min' },
    { key: 'rounds', label: 'Rounds', type: 'stepper', min: 1, max: 12, step: 1, default: 6 },
    {
      key: 'lastChanceSeconds', label: 'Last chance', type: 'stepper', min: 10, max: 40, step: 5, default: 20, suffix: 's',
      help: 'How long a caught spy gets to guess the location before they are stumped.',
    },
  ],
};

// Curated packs (games/spyfall/packs/): a themed set of locations. A dozen
// is plenty; the spy has to scan the whole list on one screen.
export const curated = { itemLabel: 'location', minItems: 10 };

const ids = (state) => state.players.map((p) => p.id);
const inGame = (state, id) => state.players.some((p) => p.id === id);

function dealLocation(state, ctx) {
  const locs = ctx.content.locations;
  const unused = locs.filter((l) => !state.used.includes(l.key));
  const loc = pick(unused.length ? unused : locs, ctx.rng);
  // Every location once before any repeats; a full cycle starts over.
  state.used = unused.length ? [...state.used, loc.key] : [loc.key];
  // Late joiners are dealt in from the next round.
  for (const id of state.waiting) if (!state.players.some((p) => p.id === id)) {
    const p = ctx.players.find((x) => x.id === id);
    if (p) state.players.push({ id: p.id, name: p.name, color: p.color });
  }
  state.waiting = [];
  const theIds = ids(state);
  state.spyId = pick(theIds, ctx.rng);
  const crew = theIds.filter((id) => id !== state.spyId);
  const roles = shuffle(loc.roles, ctx.rng);
  state.roles = Object.fromEntries(crew.map((id, i) => [id, roles[i % roles.length]]));
  state.location = { key: loc.key, label: loc.label };
  state.seen = {};
  state.votes = {};
  state.accusedId = null;
  state.result = null;
  state.phase = 'reveal';
  stopTimer(state);
}

export function init(ctx) {
  const state = {
    phase: 'reveal',
    round: 1,
    players: ctx.players.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    waiting: [],
    used: [],
    scores: {},
    mode: ctx.mode,
    variant: ctx.variant,
    options: ctx.options,
    // The full board of possible locations is public (part of the deduction
    // game), so it is dealt once and never treated as secret.
    locations: ctx.content.locations.map((l) => ({ key: l.key, label: l.label })),
  };
  dealLocation(state, ctx);
  return state;
}

function startDiscuss(state, now) {
  state.phase = 'discuss';
  startTimer(state, state.options.minutes * 60_000, now, 'timeUp');
}

function startVote(state) {
  state.phase = 'vote';
  stopTimer(state);
  state.votes = {};
  state.accusedId = null;
}

function tally(votes) {
  const counts = {};
  for (const t of Object.values(votes)) counts[t] = (counts[t] || 0) + 1;
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!sorted.length || (sorted[1] && sorted[1][1] === sorted[0][1])) return null; // tie: nobody out
  return sorted[0][0];
}

function guessWhy(reason) {
  return reason === 'wrongAccusation' ? 'the spy got away with it' : 'the spy named the location';
}

// Every way a round can end: a voluntary guess (right or wrong), the spy
// caught and either naming the location or running out of chances, or the
// table wrongly accusing an innocent crew member.
function finishRound(state, { spyWins, accusedId, reason }, ctx) {
  const crew = ids(state).filter((id) => id !== state.spyId);
  const drinks = [];
  if (spyWins) {
    addScore(state, state.spyId, 2);
    stat(state, state.spyId, 'liar');
    for (const id of crew) drinks.push(sip(state, id, 2, guessWhy(reason)));
  } else {
    for (const id of crew) addScore(state, id, 1);
    drinks.push(isDeadly(state) ? shot(state, state.spyId, 'caught') : sip(state, state.spyId, 3, 'caught'));
  }
  // A real vote happened this round (as opposed to a voluntary guess cutting
  // discussion short): score the table's reads on it.
  if (Object.keys(state.votes).length) {
    for (const [voter, target] of Object.entries(state.votes)) {
      if (voter === state.spyId) continue;
      if (target === state.spyId) stat(state, voter, 'sleuth');
      else drinks.push(sip(state, voter, 1, 'voted for an innocent'));
    }
  }
  if (reason === 'wrongAccusation') drinks.push(giveOut(state, accusedId, 2, 'wrongly accused'));
  state.result = {
    spyWins, reason, accusedId: accusedId || null, spyId: state.spyId, location: state.location,
    roles: state.roles, votes: state.votes, drinks: drinks.filter(Boolean),
  };
  state.phase = 'result';
  stopTimer(state);
  if (state.round >= (state.options.rounds || 6)) gameOver(state);
}

function afterTally(state, accused, ctx) {
  if (!accused) {
    // Tie or nobody voted: not a game-ending outcome, just back to the table.
    state.phase = 'discuss';
    state.votes = {};
    toast(state, 'No majority. Back to discussion.', 'info');
    startTimer(state, state.options.minutes * 60_000, ctx.now, 'timeUp');
    return;
  }
  if (accused === state.spyId) {
    state.accusedId = accused;
    state.phase = 'spyLastChance';
    startTimer(state, (state.options.lastChanceSeconds || 20) * 1000, ctx.now, 'lastChanceTimeUp');
    return;
  }
  finishRound(state, { spyWins: true, accusedId: accused, reason: 'wrongAccusation' }, ctx);
}

export function act(state, a, ctx) {
  const { type, payload, from, host } = a;
  switch (type) {
    case 'seen':
      if (state.phase !== 'reveal') return fail('Cards are already dealt.');
      if (!inGame(state, from)) return fail('You are not in this round.');
      state.seen[from] = true;
      if (ids(state).every((id) => state.seen[id])) startDiscuss(state, ctx.now);
      return;
    case 'startDiscuss':
      if (!host) return fail('Only the host can do that.');
      if (state.phase !== 'reveal') return fail('Already past the reveal.');
      startDiscuss(state, ctx.now);
      return;
    case 'pause':
    case 'resume':
    case 'addMinute':
      if (!host) return fail('Only the host can do that.');
      if (state.phase !== 'discuss') return fail('The timer is not running.');
      if (type === 'pause') pauseTimer(state, ctx.now);
      else if (type === 'resume') resumeTimer(state, ctx.now);
      else addTime(state, 60_000, ctx.now);
      return;
    case 'timeUp':
      if (!a.system) return fail('Only the clock can do that.');
      if (state.phase === 'discuss') startVote(state);
      return;
    case 'startVote':
      if (!host) return fail('Only the host can do that.');
      if (state.phase !== 'discuss') return fail('Not discussing right now.');
      startVote(state);
      return;
    // The Spy's own gambit: name the location outright. In a room this can
    // happen any time mid-discussion. On one phone there is no private way
    // to hand the Spy the screen mid-discussion without outing them, so this
    // path is room-only; pass-and-play resolves the Spy's guess only through
    // spyLastChance, where passTurn hands them the phone specifically.
    case 'spyGuess': {
      if (state.phase !== 'discuss' && state.phase !== 'spyLastChance') return fail('Not the moment to guess.');
      if (from !== state.spyId) return fail('Only the spy can guess the location.');
      if (state.phase === 'discuss' && state.mode !== 'room') return fail('On one phone, whisper your guess to the host instead.');
      if (typeof payload !== 'string' || !state.locations.some((l) => l.key === payload)) return fail('Pick a location.');
      const correct = payload === state.location.key;
      if (state.phase === 'discuss') {
        finishRound(state, { spyWins: correct, accusedId: null, reason: correct ? 'voluntaryCorrect' : 'voluntaryWrong' }, ctx);
      } else {
        finishRound(state, { spyWins: correct, accusedId: state.accusedId, reason: correct ? 'lastChanceCorrect' : 'lastChanceWrong' }, ctx);
      }
      return;
    }
    case 'vote': {
      if (state.phase !== 'vote') return fail('Voting is not open.');
      if (state.mode !== 'room') return fail('On one phone the host records the vote.');
      if (!inGame(state, from)) return fail('You are not in this round.');
      if (payload === from) return fail('You cannot vote for yourself.');
      if (!inGame(state, payload)) return fail('Pick a player in this round.');
      state.votes[from] = payload;
      if (ids(state).every((id) => state.votes[id])) afterTally(state, tally(state.votes), ctx);
      return;
    }
    case 'closeVote':
      if (!host) return fail('Only the host can do that.');
      if (state.phase !== 'vote') return fail('Voting is not open.');
      afterTally(state, tally(state.votes), ctx);
      return;
    case 'accuse':
      // One phone: the group votes out loud, the host taps who went out.
      if (!host) return fail('Only the host can do that.');
      if (state.phase !== 'vote') return fail('Voting is not open.');
      if (payload !== null && !inGame(state, payload)) return fail('Pick a player in this round.');
      afterTally(state, payload, ctx);
      return;
    case 'lastChanceTimeUp':
      if (!a.system) return fail('Only the clock can do that.');
      if (state.phase === 'spyLastChance') finishRound(state, { spyWins: false, accusedId: state.accusedId, reason: 'lastChanceWrong' }, ctx);
      return;
    case 'forceCaught':
      if (!host) return fail('Only the host can do that.');
      if (state.phase !== 'spyLastChance') return fail('Not the right moment.');
      finishRound(state, { spyWins: false, accusedId: state.accusedId, reason: 'lastChanceWrong' }, ctx);
      return;
    case 'nextRound':
      if (!host) return fail('Only the host can do that.');
      if (state.phase !== 'result') return fail('Finish this round first.');
      state.round += 1;
      deadlyCard(state, ctx.rng);
      dealLocation(state, ctx);
      return;
    default:
      return fail('Unknown move.');
  }
}

export const deadline = timerDeadline;

export function addPlayer(state, player) {
  if (!inGame(state, player.id) && !state.waiting.includes(player.id)) state.waiting.push(player.id);
}

export function removePlayer(state, id, ctx) {
  state.players = state.players.filter((p) => p.id !== id);
  state.waiting = state.waiting.filter((x) => x !== id);
  delete state.seen[id];
  delete state.votes[id];
  for (const [voter, target] of Object.entries(state.votes)) if (target === id) delete state.votes[voter];
  if (state.phase === 'result') return;
  if (id === state.spyId) {
    // The one person every secret in this round hangs off just walked out:
    // void the round and deal again, same as Imposter losing its last imposter.
    if (state.players.length >= meta.minPlayers) {
      state.round += 1;
      dealLocation(state, ctx);
    }
    return;
  }
  delete state.roles[id];
  if (state.phase === 'reveal' && ids(state).length && ids(state).every((x) => state.seen[x])) {
    startDiscuss(state, ctx.now);
  } else if (state.phase === 'vote' && state.mode === 'room' && ids(state).length && ids(state).every((x) => state.votes[x])) {
    afterTally(state, tally(state.votes), ctx);
  }
}

function common(state) {
  const spyRevealed = state.phase === 'spyLastChance' || state.phase === 'result';
  return {
    phase: state.phase,
    round: state.round,
    rounds: state.options.rounds || 6,
    over: !!state.$over,
    players: ids(state),
    waiting: state.waiting,
    timer: state.timer || null,
    scores: leaderboard(state, ids(state)),
    seen: ids(state).filter((id) => state.seen[id]),
    voted: ids(state).filter((id) => state.votes[id]),
    locations: state.locations,
    // Who got voted out and whether that was the spy: public the moment the
    // table hears it out loud (spyLastChance or result), never before.
    accused: spyRevealed ? (state.accusedId || null) : null,
    spyId: spyRevealed ? state.spyId : null,
    toast: state.toast || null,
  };
}

function resultView(state) {
  if (state.phase !== 'result') return null;
  return { ...state.result };
}

export function playerView(state, playerId) {
  const base = common(state);
  if (!inGame(state, playerId)) return { ...base, me: null, card: null, waiting: true };
  const isSpy = playerId === state.spyId;
  // The only place the secret location or the spy's own role ever leaves the
  // engine before the reveal, and only to its owner.
  const card = isSpy ? { role: 'spy' } : { role: 'crew', location: state.location, roleName: state.roles[playerId] };
  return {
    ...base,
    me: playerId,
    card,
    seenMe: !!state.seen[playerId],
    myVote: state.votes[playerId] || null,
    result: resultView(state),
  };
}

export function tvView(state) {
  return { ...common(state), result: resultView(state) };
}

export function hostActions(state) {
  switch (state.phase) {
    case 'reveal':
      return state.mode === 'room' ? [{ type: 'startDiscuss', label: 'Skip to discussion', tone: 'secondary', confirm: 'Not everyone has checked their card. Start anyway?' }] : [];
    case 'discuss':
      return [
        state.timer && state.timer.paused
          ? { type: 'resume', label: 'Resume', tone: 'secondary' }
          : { type: 'pause', label: 'Pause', tone: 'secondary' },
        { type: 'addMinute', label: '+1 min', tone: 'secondary' },
        { type: 'startVote', label: 'Vote now', tone: 'primary' },
      ];
    case 'vote':
      return state.mode === 'room' ? [{ type: 'closeVote', label: 'Close voting', tone: 'secondary', confirm: 'Count the votes now?' }] : [];
    case 'spyLastChance':
      return [{ type: 'forceCaught', label: 'Spy is stumped', tone: 'danger', confirm: 'Rule the spy stumped without waiting them out?' }];
    case 'result':
      return [{ type: 'nextRound', label: state.$over ? 'Play another round' : 'Next round', tone: 'primary' }];
    default:
      return [];
  }
}

// Pass and play: hand the phone round for the reveal, same as Imposter. The
// only other private look anyone ever needs is the caught Spy's last chance.
export function passTurn(state) {
  if (state.phase === 'reveal') return ids(state).find((id) => !state.seen[id]) || null;
  if (state.phase === 'spyLastChance') return state.spyId;
  return null;
}

// A random legal move for this player (null = the host/shared screen).
// Drives test/contract.test.mjs and the e2e bots; never used in real play.
export function bot(state, playerId, ctx) {
  if (playerId === null) {
    if (state.phase === 'vote' && state.mode === 'pass') {
      return { type: 'accuse', payload: ctx.rng() < 0.2 ? null : pick(ids(state), ctx.rng) };
    }
    if (state.phase === 'spyLastChance' && ctx.rng() < 0.25) {
      return { type: 'forceCaught', payload: null };
    }
    const acts = hostActions(state);
    return acts.length ? { type: pick(acts, ctx.rng).type, payload: null } : null;
  }
  if (!inGame(state, playerId)) return null;
  if (state.phase === 'reveal' && !state.seen[playerId]) return { type: 'seen', payload: null };
  if (state.phase === 'discuss' && playerId === state.spyId && state.mode === 'room' && ctx.rng() < 0.2) {
    return { type: 'spyGuess', payload: pick(state.locations, ctx.rng).key };
  }
  if (state.phase === 'vote' && state.mode === 'room' && !state.votes[playerId]) {
    return { type: 'vote', payload: pick(ids(state).filter((id) => id !== playerId), ctx.rng) };
  }
  if (state.phase === 'spyLastChance' && playerId === state.spyId) {
    return { type: 'spyGuess', payload: pick(state.locations, ctx.rng).key };
  }
  return null;
}
