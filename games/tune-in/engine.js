// Tune In: a hidden target on a 0-100 spectrum dial. The Psychic (rotating
// each round) sees the target and gives a one-word clue; everyone else sets
// a dial guess (their own in a room, one shared dial on one phone) and the
// table scores on how close the average/shared guess lands.
// Phases: clue -> guess -> result -> (nextRound) clue ...
import {
  shuffle, pick, clamp, fail, addScore, leaderboard,
  sip, shot, isDeadly, deadlyCard, stat, gameOver,
  startTimer, stopTimer, timerDeadline,
} from '../_kit/kit.js';

const GUESS_MS = 45_000;
const CLUE_WORDS = ['warm', 'cold', 'iffy', 'meh', 'yikes', 'solid', 'risky', 'classic'];

export const meta = {
  id: 'tune-in',
  name: 'Tune In',
  emoji: '📻',
  tagline: 'A hidden target on a spectrum, one clue, and a dial the whole table has to agree on.',
  blurb: 'A Wavelength-style spectrum game: the Psychic sees a hidden target between two opposite ideas and gives one clue, then the table sets a dial to guess how close they can land.',
  minPlayers: 3,
  maxPlayers: 10,
  order: 160,
  accent: '#f08c00',
  pitch: 'Land the dial on a hidden target from one clue',
  minutes: [15, 25],
  vibes: ['brain'],
  modes: ['pass', 'room'],
  howto: [
    'The Psychic sees a hidden target on a dial between two opposites',
    'They give one clue that points at where the target sits',
    'Everyone else sets the dial. Closer to the target scores more',
  ],
  variants: {
    standard: 'Bullseyes score the whole table, the Psychic included.',
    drinking: 'A wild miss and the Psychic sips.',
    deadly: 'A truly terrible clue (a wild miss) and the Psychic takes a shot.',
  },
  options: [
    { key: 'rounds', label: 'Rounds', type: 'stepper', min: 4, max: 12, step: 1, default: 8 },
  ],
};

// Curated packs (games/tune-in/packs/) need no code here; this only names one
// item in the pack picker.
export const curated = { itemLabel: 'spectrum' };

const ids = (state) => state.players.map((p) => p.id);
const inGame = (state, id) => state.players.some((p) => p.id === id);
const psychic = (state) => (state.order.length ? state.order[state.psychicIndex % state.order.length] : null);

function band(distance) {
  if (distance <= 3) return 'bullseye';
  if (distance <= 10) return 'close';
  if (distance <= 20) return 'okay';
  return 'miss';
}

const POINTS = { bullseye: 3, close: 2, okay: 1, miss: 0 };

function deal(state, ctx) {
  // Late joiners are dealt in from the next round, same as Imposter/Sketchy.
  for (const id of state.waiting) {
    if (!state.players.some((p) => p.id === id)) {
      const p = ctx.players.find((x) => x.id === id);
      if (p) {
        state.players.push({ id: p.id, name: p.name, color: p.color });
        state.order.push(p.id);
      }
    }
  }
  state.waiting = [];
  const pairs = ctx.content.spectrums;
  const unused = pairs.map((_, i) => i).filter((i) => !state.used.includes(i));
  const idx = pick(unused.length ? unused : pairs.map((_, i) => i), ctx.rng);
  state.used = [...state.used.slice(-30), idx];
  state.spectrum = pairs[idx];
  // Clamped away from the extremes so there is always a meaningful "how close".
  state.target = clamp(Math.round(ctx.rng() * 100), 5, 95);
  state.clue = null;
  state.dials = {};
  state.sharedDial = 50;
  state.result = null;
  state.phase = 'clue';
  stopTimer(state);
}

export function init(ctx) {
  const state = {
    phase: 'clue',
    round: 1,
    players: ctx.players.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    waiting: [],
    used: [],
    order: shuffle(ctx.players.map((p) => p.id), ctx.rng),
    psychicIndex: 0,
    scores: {},
    spectrum: null,
    target: 50,
    clue: null,
    dials: {},
    sharedDial: 50,
    result: null,
    mode: ctx.mode,
    variant: ctx.variant,
    options: ctx.options,
  };
  deal(state, ctx);
  return state;
}

function resolve(state, ctx) {
  stopTimer(state);
  const psy = psychic(state);
  let finalValue;
  let contributors;
  if (state.mode === 'room') {
    const values = Object.values(state.dials);
    finalValue = values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 50;
    contributors = Object.keys(state.dials);
  } else {
    finalValue = state.sharedDial;
    contributors = ids(state).filter((id) => id !== psy);
  }
  const distance = Math.abs(state.target - finalValue);
  const b = band(distance);
  const points = POINTS[b];
  const drinks = [];
  if (points > 0) {
    addScore(state, psy, points);
    for (const id of contributors) addScore(state, id, points);
    if (b === 'bullseye') for (const id of contributors) stat(state, id, 'guesser');
  }
  if (b === 'miss') {
    const d = isDeadly(state) ? shot(state, psy, 'that clue missed by a mile') : sip(state, psy, 2, 'that clue missed by a mile');
    drinks.push(d);
  }
  state.result = { target: state.target, finalValue, distance, band: b, points, contributors, drinks: drinks.filter(Boolean) };
  state.phase = 'result';
  if (state.round >= (state.options.rounds || 8)) gameOver(state);
}

export function act(state, a, ctx) {
  const { type, payload, from, host } = a;
  switch (type) {
    case 'giveClue': {
      if (state.phase !== 'clue') return fail('Not expecting a clue right now.');
      if (from !== psychic(state)) return fail('Only the Psychic gives the clue.');
      const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
      if (!text) return fail('Give a one-word or short clue.');
      if (text.length > 40) return fail('Keep the clue short.');
      state.clue = text;
      state.phase = 'guess';
      state.sharedDial = 50;
      if (state.mode === 'room') startTimer(state, GUESS_MS, ctx.now, 'timeUp');
      return;
    }
    case 'setDial': {
      if (state.phase !== 'guess') return fail('Not guessing right now.');
      if (state.mode !== 'room') return fail('On one phone, nudge the shared dial instead.');
      if (!inGame(state, from)) return fail('You are not in this round.');
      if (from === psychic(state)) return fail('The Psychic sits this one out.');
      const value = Math.round(Number(payload?.value));
      if (!Number.isFinite(value)) return fail('Bad dial value.');
      state.dials[from] = clamp(value, 0, 100);
      const guessers = ids(state).filter((id) => id !== psychic(state));
      if (guessers.length && guessers.every((id) => state.dials[id] !== undefined)) resolve(state, ctx);
      return;
    }
    case 'nudgeDial': {
      if (state.phase !== 'guess') return fail('Not guessing right now.');
      if (state.mode !== 'pass') return fail('In a room, everyone sets their own dial.');
      if (!(host || from === null)) return fail('Only the shared screen can nudge the dial.');
      const value = Math.round(Number(payload?.value));
      if (!Number.isFinite(value)) return fail('Bad dial value.');
      state.sharedDial = clamp(value, 0, 100);
      return;
    }
    case 'lockDial':
      if (!host) return fail('Only the host can lock it in.');
      if (state.phase !== 'guess') return fail('Not guessing right now.');
      if (state.mode !== 'pass') return fail('Rooms lock in automatically once everyone has guessed.');
      resolve(state, ctx);
      return;
    case 'closeGuess':
      if (!host) return fail('Only the host can do that.');
      if (state.phase !== 'guess') return fail('Not guessing right now.');
      if (state.mode !== 'room') return fail('On one phone, lock the dial instead.');
      resolve(state, ctx);
      return;
    case 'timeUp':
      if (!a.system) return fail('Only the clock can do that.');
      if (state.phase === 'guess' && state.mode === 'room') resolve(state, ctx);
      return;
    case 'nextRound':
      if (!host) return fail('Only the host can do that.');
      if (state.phase !== 'result') return fail('Finish this round first.');
      state.round += 1;
      state.psychicIndex = (state.psychicIndex + 1) % state.order.length;
      deadlyCard(state, ctx.rng);
      deal(state, ctx);
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
  const wasPsychic = psychic(state) === id;
  const idx = state.order.indexOf(id);
  state.players = state.players.filter((p) => p.id !== id);
  state.waiting = state.waiting.filter((x) => x !== id);
  delete state.dials[id];
  if (idx !== -1) {
    state.order.splice(idx, 1);
    if (idx < state.psychicIndex) state.psychicIndex -= 1;
  }
  if (state.phase === 'result' || !state.order.length) return;
  if (wasPsychic) {
    // The round is void without its Psychic: redeal, rotation shifted into them.
    if (state.psychicIndex >= state.order.length) state.psychicIndex = 0;
    state.round += 1;
    deal(state, ctx);
    return;
  }
  if (state.phase === 'guess' && state.mode === 'room') {
    const guessers = ids(state).filter((x) => x !== psychic(state));
    if (guessers.length && guessers.every((x) => state.dials[x] !== undefined)) resolve(state, ctx);
  }
}

function common(state) {
  const clueGiven = state.phase !== 'clue';
  return {
    phase: state.phase,
    round: state.round,
    rounds: state.options.rounds || 8,
    over: !!state.$over,
    mode: state.mode,
    players: ids(state),
    waiting: state.waiting,
    psychic: psychic(state),
    // The spectrum pair and the clue only become public once the Psychic has
    // given the clue; the target never does (except in the result reveal).
    spectrum: clueGiven ? state.spectrum : null,
    clue: clueGiven ? state.clue : null,
    timer: state.timer || null,
    scores: leaderboard(state, ids(state)),
    submitted: state.mode === 'room' ? Object.keys(state.dials) : [],
    sharedDial: state.mode === 'pass' && state.phase === 'guess' ? state.sharedDial : null,
    result: state.phase === 'result' ? state.result : null,
  };
}

export function playerView(state, playerId) {
  const base = common(state);
  if (!inGame(state, playerId)) return { ...base, me: null };
  const isPsychic = playerId === psychic(state);
  const view = { ...base, me: playerId, isPsychic };
  // Computed fresh from state every render, so there is no staleness bug:
  // the Psychic always sees the target, nobody else ever does before result.
  if (isPsychic) {
    view.target = state.target;
    view.spectrum = state.spectrum;
  }
  if (state.mode === 'room' && state.phase === 'guess' && !isPsychic) {
    // Your own in-progress guess is visible only to you (never to anyone
    // else) until the result, so nobody anchors on another player's dial.
    view.myDial = state.dials[playerId] !== undefined ? state.dials[playerId] : null;
  }
  return view;
}

export function tvView(state) {
  return { ...common(state) };
}

export function hostActions(state) {
  switch (state.phase) {
    case 'guess':
      if (state.mode === 'pass') return [{ type: 'lockDial', label: 'Lock it in', tone: 'primary' }];
      return [{ type: 'closeGuess', label: 'Close guessing now', tone: 'secondary', confirm: 'Average the dials now, even if not everyone has guessed?' }];
    case 'result':
      // Past the last round the platform's own Standings button leads; this
      // one really does deal another round, so it says so.
      return [{ type: 'nextRound', label: state.$over ? 'Play another round' : 'Next round', tone: 'primary' }];
    default:
      return [];
  }
}

// One phone: the Psychic peeks at the target alone, then hands it back. The
// guess phase is deliberately shared on one screen (the whole table nudges
// one dial together), so there is never a private turn there.
export function passTurn(state) {
  if (state.phase === 'clue') return psychic(state);
  return null;
}

export function bot(state, playerId, ctx) {
  if (playerId === null) {
    if (state.phase === 'guess' && state.mode === 'pass') {
      if (ctx.rng() < 0.25) return { type: 'lockDial', payload: null };
      return { type: 'nudgeDial', payload: { value: Math.floor(ctx.rng() * 101) } };
    }
    if (state.phase === 'guess' && state.mode === 'room' && ctx.rng() < 0.1) {
      return { type: 'closeGuess', payload: null };
    }
    if (state.phase === 'result') return { type: 'nextRound', payload: null };
    return null;
  }
  if (!inGame(state, playerId)) return null;
  if (state.phase === 'clue' && playerId === psychic(state) && !state.clue) {
    return { type: 'giveClue', payload: { text: pick(CLUE_WORDS, ctx.rng) } };
  }
  if (state.phase === 'guess' && state.mode === 'room' && playerId !== psychic(state) && state.dials[playerId] === undefined) {
    return { type: 'setDial', payload: { value: Math.floor(ctx.rng() * 101) } };
  }
  return null;
}
