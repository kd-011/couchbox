// Werewolf: secret roles, a night of private hunting and watching, a day of
// public accusation. Phases: night -> day -> discuss -> vote -> result ->
// (night again) or final.
//
// Secrecy model: state.roles holds everyone's true role for the whole game,
// server-side only. It never appears in a view until a player dies (their
// own role is revealed then, to everyone) or the game ends (state.final).
// The one deliberate exception is the werewolf pack: living wolves see each
// other's identity and the pack's current night target, nobody else ever
// does, and a dead wolf stops seeing it the moment they die.
import {
  shuffle, clamp, fail, addScore, leaderboard,
  sip, shot, isDrinking, isDeadly, deadlyCard, stat, gameOver,
  startTimer, pauseTimer, resumeTimer, addTime, stopTimer, timerDeadline,
} from '../_kit/kit.js';

const DISCUSS_MS = 3 * 60_000;

export const meta = {
  id: 'werewolf',
  name: 'Werewolf',
  emoji: '🐺',
  tagline: 'Wolves hunt by night. The village votes by day. Find them before they find you.',
  blurb: 'The classic social deduction game: secret werewolves kill one villager each night, then everyone argues and votes someone out by day. Repeat until one side is wiped out.',
  minPlayers: 3,
  maxPlayers: 16,
  order: 110,
  accent: '#7048e8',
  pitch: 'Wolves hunt by night, the village votes by day',
  minutes: [20, 40],
  vibes: ['bluff'],
  modes: ['pass', 'room'],
  variants: {
    standard: 'Village wins, every survivor scores 1. Wolves win, every surviving wolf scores 2.',
    drinking: 'Village wins, every wolf drinks 3. Wolves win, every surviving villager drinks 2.',
    deadly: 'Whoever the village lynches takes a shot on the way out.',
  },
  options: [
    {
      key: 'werewolves', label: 'Werewolves', type: 'choice', default: 'auto',
      choices: [{ value: 'auto', label: 'Auto' }, { value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }],
      help: 'Auto: 1 under 8 players, 2 from 8, 3 from 12. Always kept a minority.',
    },
    { key: 'seer', label: 'Seer', type: 'toggle', default: true },
    { key: 'doctor', label: 'Doctor', type: 'toggle', default: true },
    { key: 'nightSeconds', label: 'Night length', type: 'stepper', min: 20, max: 60, step: 5, default: 30, suffix: 's' },
  ],
  howto: [
    'Check your secret role. Each night the werewolves pick a victim.',
    'At dawn, argue about who is acting suspicious.',
    'Vote someone out. The village wins once every wolf is gone.',
  ],
};

const ids = (state) => state.players.map((p) => p.id);
const inGame = (state, id) => state.players.some((p) => p.id === id);
const alive = (state) => ids(state).filter((id) => !state.dead[id]);
const isAlive = (state, id) => inGame(state, id) && !state.dead[id];

// How many wolves for n players: the Imposter scaling, but always clamped so
// wolves stay a strict minority of the table.
function werewolfCount(n, choice) {
  const maxSafe = Math.max(1, Math.ceil(n / 2) - 1);
  const want = choice === 'auto' ? (n >= 12 ? 3 : n >= 8 ? 2 : 1) : Number(choice) || 1;
  return clamp(want, 1, maxSafe);
}

function tally(votes) {
  const counts = {};
  for (const t of Object.values(votes)) counts[t] = (counts[t] || 0) + 1;
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!sorted.length || (sorted[1] && sorted[1][1] === sorted[0][1])) return null; // tie: nobody out
  return sorted[0][0];
}

function startNight(state, ctx) {
  state.round += 1;
  // A new night is the next round: maybe a Deadly card (public randomness,
  // never aimed by role). Not on the first night of a game.
  if (state.round > 1) deadlyCard(state, ctx.rng);
  state.wolfPicks = {};
  state.doctorPick = null;
  state.seerPick = null;
  state.lastNightResult = null;
  state.result = null;
  state.phase = 'night';
  startTimer(state, state.options.nightSeconds * 1000, ctx.now, 'nightTimeUp');
}

// Fresh roles for everyone currently in the game (used by init and playAgain).
function dealNewGame(state, ctx) {
  for (const id of state.waiting) {
    if (!inGame(state, id)) {
      const p = ctx.players.find((x) => x.id === id);
      if (p) state.players.push({ id: p.id, name: p.name, color: p.color });
    }
  }
  state.waiting = [];
  const shuffled = shuffle(ids(state), ctx.rng);
  const wolfN = werewolfCount(shuffled.length, state.options.werewolves);
  const wolves = shuffled.slice(0, wolfN);
  let rest = shuffled.slice(wolfN);
  const roles = {};
  for (const id of wolves) roles[id] = 'werewolf';
  if (state.options.seer && rest.length) { roles[rest[0]] = 'seer'; rest = rest.slice(1); }
  if (state.options.doctor && rest.length) { roles[rest[0]] = 'doctor'; rest = rest.slice(1); }
  for (const id of rest) roles[id] = 'villager';
  state.roles = roles;
  state.dead = {};
  state.seerHistory = {};
  state.votes = {};
  state.voteLog = [];
  state.result = null;
  state.final = null;
  state.winner = null;
  state.round = 0;
  // Unique per game, for the client's once-only effects (confetti).
  state.gameKey = String(ctx.now);
  startNight(state, ctx);
}

export function init(ctx) {
  const state = {
    phase: 'night',
    players: ctx.players.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    waiting: [],
    scores: {},
    mode: ctx.mode,
    variant: ctx.variant,
    options: ctx.options,
  };
  dealNewGame(state, ctx);
  return state;
}

// Every living actor with a required night move has moved, or there is
// nobody left who needs to.
function nightDone(state) {
  const liveWolves = alive(state).filter((id) => state.roles[id] === 'werewolf');
  if (liveWolves.some((id) => !(id in state.wolfPicks))) return false;
  if (state.options.seer) {
    const seerId = alive(state).find((id) => state.roles[id] === 'seer');
    if (seerId && state.seerPick == null) return false;
  }
  if (state.options.doctor) {
    const docId = alive(state).find((id) => state.roles[id] === 'doctor');
    if (docId && state.doctorPick == null) return false;
  }
  return true;
}

function checkWin(state) {
  const liveIds = alive(state);
  if (!liveIds.length) return state.winner || null;
  const w = liveIds.filter((id) => state.roles[id] === 'werewolf').length;
  const o = liveIds.length - w;
  if (w === 0) state.winner = 'village';
  else if (w >= o) state.winner = 'wolves';
  else state.winner = null;
  return state.winner;
}

function resolveNight(state, ctx) {
  stopTimer(state);
  const liveWolves = alive(state).filter((id) => state.roles[id] === 'werewolf');
  const picks = liveWolves.map((id) => state.wolfPicks[id]).filter(Boolean);
  let killTarget = null;
  if (picks.length) {
    const counts = {};
    for (const t of picks) counts[t] = (counts[t] || 0) + 1;
    killTarget = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }
  const saved = !!(killTarget && state.doctorPick === killTarget);
  const died = killTarget && !saved ? killTarget : null;
  if (died) state.dead[died] = true;
  state.lastNightResult = { diedId: died, diedRole: died ? state.roles[died] : null };
  checkWin(state);
  state.phase = 'day';
}

function startDiscuss(state, now) {
  state.phase = 'discuss';
  startTimer(state, DISCUSS_MS, now, 'discussTimeUp');
}

function startVote(state) {
  state.phase = 'vote';
  stopTimer(state);
  state.votes = {};
}

function resolveVote(state, lynchedId) {
  stopTimer(state);
  if (lynchedId) state.dead[lynchedId] = true;
  // Day votes are public; whether they hit a wolf is scored at the end,
  // once every role is out in the open.
  state.voteLog = [...(state.voteLog || []), ...Object.entries(state.votes)];
  // The lynch and the lynched role go public in this very result, so the
  // Deadly shot reveals nothing new.
  const drinks = lynchedId && isDeadly(state) ? [shot(state, lynchedId, 'lynched')].filter(Boolean) : [];
  state.result = { lynchedId: lynchedId || null, lynchedRole: lynchedId ? state.roles[lynchedId] : null, votes: state.votes, drinks };
  checkWin(state);
  state.phase = 'result';
}

function finalize(state) {
  stopTimer(state);
  checkWin(state);
  const winner = state.winner || 'village';
  const liveIds = alive(state);
  const wolfIds = ids(state).filter((id) => state.roles[id] === 'werewolf');
  const liveWolves = liveIds.filter((id) => state.roles[id] === 'werewolf');
  // Points in every tier (Party Night ranks on them); drinks on top. Every
  // role is public from here, so the drinks and award stats are safe now.
  const drinks = [];
  if (winner === 'village') {
    for (const id of liveIds) addScore(state, id, 1);
    if (isDrinking(state)) for (const id of wolfIds) drinks.push(sip(state, id, 3, 'the pack lost'));
  } else {
    for (const id of liveWolves) { addScore(state, id, 2); stat(state, id, 'liar'); }
    if (isDrinking(state)) for (const id of liveIds.filter((id) => state.roles[id] !== 'werewolf')) drinks.push(sip(state, id, 2, 'the village fell'));
  }
  for (const [voter, target] of state.voteLog || []) {
    if (inGame(state, voter) && state.roles[voter] !== 'werewolf' && state.roles[target] === 'werewolf') stat(state, voter, 'sleuth');
  }
  state.final = { winner, roles: state.roles, alive: liveIds, drinks: drinks.filter(Boolean) };
  state.phase = 'final';
  gameOver(state);
}

export function act(state, a, ctx) {
  const { type, payload, from, host } = a;
  switch (type) {
    case 'nightKill': {
      if (state.phase !== 'night') return fail('It is not night.');
      if (!isAlive(state, from) || state.roles[from] !== 'werewolf') return fail('Only the werewolves hunt at night.');
      if (typeof payload !== 'string' || !isAlive(state, payload)) return fail('Pick a living player.');
      if (state.roles[payload] === 'werewolf') return fail('The pack does not turn on itself.');
      state.wolfPicks[from] = payload;
      if (nightDone(state)) resolveNight(state, ctx);
      return;
    }
    case 'seerCheck': {
      if (state.phase !== 'night') return fail('It is not night.');
      if (!state.options.seer) return fail('There is no seer this game.');
      if (!isAlive(state, from) || state.roles[from] !== 'seer') return fail('Only the seer may look.');
      if (state.seerPick != null) return fail('You have already looked tonight.');
      if (typeof payload !== 'string' || !isAlive(state, payload) || payload === from) return fail('Pick another living player.');
      state.seerPick = payload;
      state.seerHistory[state.round] = { targetId: payload, role: state.roles[payload] };
      if (nightDone(state)) resolveNight(state, ctx);
      return;
    }
    case 'doctorSave': {
      if (state.phase !== 'night') return fail('It is not night.');
      if (!state.options.doctor) return fail('There is no doctor this game.');
      if (!isAlive(state, from) || state.roles[from] !== 'doctor') return fail('Only the doctor may treat someone.');
      if (state.doctorPick != null) return fail('You have already chosen for tonight.');
      if (typeof payload !== 'string' || !isAlive(state, payload)) return fail('Pick a living player.');
      state.doctorPick = payload;
      if (nightDone(state)) resolveNight(state, ctx);
      return;
    }
    case 'nightTimeUp':
      if (!a.system) return fail('Only the clock can do that.');
      if (state.phase === 'night') resolveNight(state, ctx);
      return;
    case 'resolveNightNow':
      if (!host) return fail('Only the host can do that.');
      if (state.phase !== 'night') return fail('It is not night.');
      resolveNight(state, ctx);
      return;
    case 'startDiscuss':
      if (!host) return fail('Only the host can do that.');
      if (state.phase !== 'day') return fail('Not the right moment.');
      if (state.winner) return fail('The game is already decided.');
      startDiscuss(state, ctx.now);
      return;
    case 'finishGame':
      if (!host) return fail('Only the host can do that.');
      if (state.phase !== 'day' && state.phase !== 'result') return fail('Not the right moment.');
      if (!state.winner) return fail('Nobody has won yet.');
      finalize(state);
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
    case 'discussTimeUp':
      if (!a.system) return fail('Only the clock can do that.');
      if (state.phase === 'discuss') startVote(state);
      return;
    case 'startVote':
      if (!host) return fail('Only the host can do that.');
      if (state.phase !== 'discuss') return fail('Not discussing right now.');
      startVote(state);
      return;
    case 'vote': {
      if (state.phase !== 'vote') return fail('Voting is not open.');
      if (state.mode !== 'room') return fail('On one phone the host records the vote.');
      if (!isAlive(state, from)) return fail('You are not in this round.');
      if (payload === from) return fail('You cannot vote for yourself.');
      if (typeof payload !== 'string' || !isAlive(state, payload)) return fail('Pick a living player.');
      state.votes[from] = payload;
      if (alive(state).every((id) => state.votes[id])) resolveVote(state, tally(state.votes));
      return;
    }
    case 'closeVote':
      if (!host) return fail('Only the host can do that.');
      if (state.phase !== 'vote') return fail('Voting is not open.');
      resolveVote(state, tally(state.votes));
      return;
    case 'accuse':
      // One phone: the group votes out loud, the host taps who went out.
      if (!host) return fail('Only the host can do that.');
      if (state.phase !== 'vote') return fail('Voting is not open.');
      if (payload !== null && (typeof payload !== 'string' || !isAlive(state, payload))) return fail('Pick a living player.');
      resolveVote(state, payload);
      return;
    case 'nextRound':
      if (!host) return fail('Only the host can do that.');
      if (state.phase !== 'result') return fail('Finish this round first.');
      if (state.winner) return fail('The game is already decided.');
      startNight(state, ctx);
      return;
    case 'playAgain':
      if (!host) return fail('Only the host can do that.');
      if (state.phase !== 'final') return fail('The game is still going.');
      state.scores = {};
      dealNewGame(state, ctx);
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
  delete state.roles[id];
  delete state.dead[id];
  delete state.wolfPicks[id];
  delete state.votes[id];
  for (const [voter, target] of Object.entries(state.votes)) if (target === id) delete state.votes[voter];
  if (state.phase === 'final') return;
  if (state.phase === 'night' && nightDone(state)) resolveNight(state, ctx);
  if (state.phase === 'vote' && state.mode === 'room') {
    const living = alive(state);
    if (living.length && living.every((x) => state.votes[x])) resolveVote(state, tally(state.votes));
  }
  checkWin(state);
  // Someone leaving (not dying) can decide the game outright, e.g. the last
  // wolf walks out. There is no death to reveal, so skip straight to final.
  if (state.winner && (state.phase === 'night' || state.phase === 'discuss' || state.phase === 'vote')) finalize(state);
}

function common(state) {
  const roleCounts = Object.values(state.roles);
  return {
    phase: state.phase,
    round: state.round,
    players: ids(state),
    waiting: state.waiting,
    alive: alive(state),
    dead: ids(state).filter((id) => state.dead[id]),
    werewolfCount: roleCounts.filter((r) => r === 'werewolf').length,
    rolesEnabled: { seer: !!state.options.seer, doctor: !!state.options.doctor },
    timer: state.timer || null,
    winner: state.winner || null,
    lastNightResult: state.lastNightResult || null,
    result: state.result || null,
    final: state.final || null,
    scores: leaderboard(state, ids(state)),
    voted: ids(state).filter((id) => state.votes[id]),
    toast: state.toast || null,
    gameKey: state.gameKey || '',
  };
}

export function playerView(state, playerId) {
  const base = common(state);
  if (!inGame(state, playerId)) return { ...base, me: null, myRole: null, waiting: true };
  const role = state.roles[playerId];
  const aliveMe = !state.dead[playerId];
  const view = { ...base, me: playerId, myRole: role, aliveMe, myVote: state.votes[playerId] || null };
  if (state.phase === 'night' && aliveMe) {
    if (role === 'werewolf') {
      view.pack = { ids: alive(state).filter((id) => state.roles[id] === 'werewolf'), picks: state.wolfPicks };
      view.myPick = state.wolfPicks[playerId] || null;
    } else if (role === 'seer') {
      view.myPick = state.seerPick;
    } else if (role === 'doctor') {
      view.myPick = state.doctorPick;
    }
  }
  if (role === 'seer') view.seerHistory = state.seerHistory;
  return view;
}

export function tvView(state) {
  return common(state);
}

export function hostActions(state) {
  switch (state.phase) {
    case 'night':
      return [{ type: 'resolveNightNow', label: 'End the night now', tone: 'secondary', confirm: 'Resolve the night with whatever picks are in?' }];
    case 'day':
      return state.winner
        ? [{ type: 'finishGame', label: 'Reveal the ending', tone: 'primary' }]
        : [{ type: 'startDiscuss', label: 'Wake the village', tone: 'primary' }];
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
    case 'result':
      return state.winner
        ? [{ type: 'finishGame', label: 'Reveal the ending', tone: 'primary' }]
        : [{ type: 'nextRound', label: 'Night falls again', tone: 'primary' }];
    case 'final':
      return [{ type: 'playAgain', label: 'Play again', tone: 'primary' }];
    default:
      return [];
  }
}

// Pass and play: hand the phone, in turn, to each werewolf, then the seer,
// then the doctor, each ending their look by submitting an action. Villagers
// never need a private screen. Nobody is passed to twice: by the time every
// required actor has gone, act() has already resolved the night and moved
// the phase on, so this never dead-ends on null while still "night".
export function passTurn(state) {
  if (state.phase !== 'night') return null;
  const wolf = alive(state).find((id) => state.roles[id] === 'werewolf' && !(id in state.wolfPicks));
  if (wolf) return wolf;
  if (state.options.seer) {
    const seerId = alive(state).find((id) => state.roles[id] === 'seer');
    if (seerId && state.seerPick == null) return seerId;
  }
  if (state.options.doctor) {
    const docId = alive(state).find((id) => state.roles[id] === 'doctor');
    if (docId && state.doctorPick == null) return docId;
  }
  return null;
}

export function bot(state, playerId, ctx) {
  if (playerId === null) {
    if (state.mode === 'pass' && state.phase === 'vote') {
      return { type: 'accuse', payload: ctx.rng() < 0.2 ? null : (alive(state)[0] ? pickRandom(alive(state), ctx.rng) : null) };
    }
    const acts = hostActions(state);
    return acts.length ? { type: pickRandom(acts, ctx.rng).type, payload: null } : null;
  }
  if (!isAlive(state, playerId)) return null;
  const role = state.roles[playerId];
  if (state.phase === 'night') {
    if (role === 'werewolf') {
      const targets = alive(state).filter((id) => state.roles[id] !== 'werewolf');
      if (targets.length) return { type: 'nightKill', payload: pickRandom(targets, ctx.rng) };
      return null;
    }
    if (role === 'seer' && state.options.seer && state.seerPick == null) {
      const targets = alive(state).filter((id) => id !== playerId);
      if (targets.length) return { type: 'seerCheck', payload: pickRandom(targets, ctx.rng) };
      return null;
    }
    if (role === 'doctor' && state.options.doctor && state.doctorPick == null) {
      const targets = alive(state);
      if (targets.length) return { type: 'doctorSave', payload: pickRandom(targets, ctx.rng) };
      return null;
    }
    return null;
  }
  if (state.phase === 'vote' && state.mode === 'room' && !state.votes[playerId]) {
    const targets = alive(state).filter((id) => id !== playerId);
    if (targets.length) return { type: 'vote', payload: pickRandom(targets, ctx.rng) };
  }
  return null;
}

function pickRandom(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}
