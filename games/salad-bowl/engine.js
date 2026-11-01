// Salad Bowl: everyone writes phrases into a shared pot, then plays three
// rounds through the same pot with a different clue rule each round
// (Describe, One Word, Act). One player at a time pulls phrases from the pot
// and races the rest of the table against the clock.
// Phases: submit -> ready -> turn -> turnEnd -> ... -> final
import {
  pick, shuffle, fail, addScore, leaderboard, teamLeaderboard,
  sip, shot, isDeadly, deadlyMoment, deadlyCard, stat, gameOver, toast,
  startTimer, pauseTimer, resumeTimer, stopTimer, timerDeadline,
} from '../_kit/kit.js';

export const meta = {
  id: 'salad-bowl',
  name: 'Salad Bowl',
  emoji: '🥗',
  tagline: 'Everyone writes names into the bowl. Then describe, one word, and act them out before the buzzer.',
  blurb: 'Everyone secretly writes names and phrases into a shared pot. Then you play three rounds through the same pot: describe it, say one word about it, then act it out, racing the clock each turn.',
  minPlayers: 3,
  maxPlayers: 12,
  order: 140,
  accent: '#82c91e',
  pitch: 'Describe it, one word it, then act it out',
  minutes: [30, 45],
  vibes: ['silly'],
  modes: ['pass', 'room'],
  teams: true,
  howto: [
    'Everyone secretly writes names and phrases into the bowl',
    'Take turns pulling them out and getting the table to guess in time',
    'Three rounds, same bowl: describe it, one word, then act it out',
  ],
  variants: {
    standard: 'Clear the bowl before the buzzer. Most points when the Act round ends wins.',
    drinking: 'Still holding a card when the buzzer sounds? Drink 2.',
    deadly: 'Still holding a card when the buzzer sounds? Shot.',
  },
  options: [
    { key: 'wordsPerPlayer', label: 'Phrases each', type: 'stepper', min: 3, max: 6, step: 1, default: 4 },
    { key: 'turnSeconds', label: 'Turn length', type: 'stepper', min: 30, max: 90, step: 10, default: 60, suffix: 's' },
  ],
};

const ROUND_LABELS = ['Describe', 'One Word', 'Act'];
const ROUND_RULES = [
  'Say anything you like about it, just never the word itself.',
  'One single word as your clue. That is it.',
  'Charades: act it out, no talking, no mouthing it.',
];
const ROUNDS_TOTAL = ROUND_LABELS.length;
const CAUGHT_WHY = 'caught holding a card';

const ids = (state) => state.players.map((p) => p.id);
const inGame = (state, id) => state.players.some((p) => p.id === id);
const activePlayer = (state) => (state.order && state.order.length ? state.order[state.turnIndex] : null);

function nameOf(state, id) {
  const p = state.players.find((x) => x.id === id);
  return p ? p.name : 'Someone';
}

function collectPhrases(state) {
  const out = [];
  for (const id of ids(state)) out.push(...(state.submissions[id] || []));
  return out;
}

// Who may pull cards and tap got-it/skip right now: on one phone the shared
// screen IS the performer (host: true, from: null); on own phones only the
// player currently up.
function canAct(state, a) {
  if (state.mode === 'pass') return a.host || a.from === null;
  return a.from === activePlayer(state);
}

function finishSubmit(state, ctx) {
  const phrases = collectPhrases(state);
  state.allPhrases = phrases;
  state.order = shuffle(ids(state), ctx.rng);
  state.turnIndex = 0;
  state.round = 1;
  state.pot = shuffle(phrases, ctx.rng);
  state.turn = null;
  state.lastTurn = null;
  state.phase = 'ready';
}

export function init(ctx) {
  const state = {
    phase: 'submit',
    players: ctx.players.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    scores: {},
    submissions: {},
    submitTarget: ctx.options.wordsPerPlayer,
    allPhrases: [],
    pot: [],
    order: [],
    turnIndex: 0,
    round: 1,
    turn: null,
    lastTurn: null,
    final: null,
    mode: ctx.mode,
    variant: ctx.variant,
    options: ctx.options,
  };
  for (const p of state.players) state.submissions[p.id] = [];
  return state;
}

// Ends the current turn. `cause.cleared` when the pot ran dry mid-card (a
// real, celebrated outcome); `cause.timedOut` when the buzzer caught someone
// holding a card (the Deadly moment); neither when the host force-ends it.
function endTurn(state, cause = {}) {
  stopTimer(state);
  const t = state.turn;
  const player = activePlayer(state);
  const drinks = [];
  // Anything still in hand goes back into the pot, unless it was the phrase
  // that was just correctly guessed (cleared: nothing left to return).
  if (!cause.cleared && t && t.card) state.pot.push(t.card);
  if (cause.timedOut) {
    const d = isDeadly(state) ? shot(state, player, CAUGHT_WHY) : sip(state, player, 2, CAUGHT_WHY);
    if (d) {
      drinks.push(d);
      if (isDeadly(state)) {
        deadlyMoment(state, {
          kind: 'shot',
          title: 'Caught Holding a Card',
          sub: `${nameOf(state, player)} didn't let go in time`,
          targets: [player],
          lines: [{ playerId: player, text: 'takes a shot' }],
        });
      }
    }
  }
  const roundDone = state.pot.length === 0;
  state.lastTurn = {
    player,
    round: state.round,
    gotten: t ? t.gotten : [],
    skippedCount: t ? t.skipped : 0,
    cleared: !!cause.cleared,
    timedOut: !!cause.timedOut,
    heldPhrase: cause.timedOut && t ? t.card : null,
    roundDone,
    drinks: drinks.filter(Boolean),
  };
  if (cause.cleared) toast(state, 'Cleared the bowl!', 'info');
  state.turn = null;
  state.phase = 'turnEnd';
}

function markGot(state) {
  const t = state.turn;
  t.gotten.push(t.card);
  addScore(state, activePlayer(state), 1);
  if (!state.pot.length) {
    endTurn(state, { cleared: true });
    return;
  }
  t.card = state.pot.shift();
}

function finish(state) {
  const board = leaderboard(state, ids(state));
  state.final = { board, teamBoard: state.teams ? teamLeaderboard(state, state.teams) : null };
  state.phase = 'final';
  state.turn = null;
  gameOver(state, board);
}

// Moves rotation on one player and, if the round that just ended is truly
// empty (nothing left for the next player either), rebuilds the pot from the
// full master list for the next round, or ends the game after Act.
function advance(state, ctx) {
  const roundDone = !!(state.lastTurn && state.lastTurn.roundDone);
  state.turnIndex = state.order.length ? (state.turnIndex + 1) % state.order.length : 0;
  if (!roundDone) {
    state.phase = 'ready';
    return;
  }
  if (state.round < ROUNDS_TOTAL) {
    state.round += 1;
    state.pot = shuffle(state.allPhrases, ctx.rng);
    deadlyCard(state, ctx.rng);
    state.phase = 'ready';
  } else {
    finish(state);
  }
}

function resetForReplay(state) {
  state.scores = {};
  state.submissions = {};
  for (const p of state.players) state.submissions[p.id] = [];
  state.allPhrases = [];
  state.pot = [];
  state.order = [];
  state.turnIndex = 0;
  state.round = 1;
  state.turn = null;
  state.lastTurn = null;
  state.final = null;
  state.phase = 'submit';
}

export function act(state, a, ctx) {
  switch (a.type) {
    case 'submitWords': {
      if (state.phase !== 'submit') return fail('Submissions are closed.');
      if (!inGame(state, a.from)) return fail('You are not in this round.');
      const mine = state.submissions[a.from] || (state.submissions[a.from] = []);
      if (mine.length >= state.submitTarget) return; // already done: ignore quietly
      const raw = a.payload && typeof a.payload.text === 'string' ? a.payload.text : '';
      const text = raw.trim();
      if (!text) return fail('Write something first.');
      if (text.length > 40) return fail('Keep it to 40 characters or less.');
      const norm = text.toLowerCase();
      if (mine.some((m) => m.toLowerCase() === norm)) return fail('You already wrote that one.');
      mine.push(text);
      if (ids(state).every((id) => (state.submissions[id] || []).length >= state.submitTarget)) finishSubmit(state, ctx);
      return;
    }
    case 'forceStart':
      if (!a.host) return fail('Only the host can do that.');
      if (state.phase !== 'submit') return fail('Submissions are already done.');
      if (!collectPhrases(state).length) return fail('Nobody has written anything yet.');
      finishSubmit(state, ctx);
      return;
    case 'start':
      if (state.phase !== 'ready') return fail('A turn is already running.');
      if (!(a.host || a.from === activePlayer(state))) return fail('Only the clue-giver or the host can start.');
      state.turn = { card: state.pot.shift(), gotten: [], skipped: 0 };
      startTimer(state, state.options.turnSeconds * 1000, ctx.now, 'timeUp');
      state.phase = 'turn';
      return;
    case 'gotIt':
      if (state.phase !== 'turn') return fail('No turn running.');
      if (!canAct(state, a)) return fail('Only the clue-giver can do that.');
      markGot(state);
      return;
    case 'skip':
      if (state.phase !== 'turn') return fail('No turn running.');
      if (!canAct(state, a)) return fail('Only the clue-giver can do that.');
      state.turn.skipped += 1;
      stat(state, activePlayer(state), 'chicken');
      state.pot.push(state.turn.card);
      state.turn.card = state.pot.shift();
      return;
    case 'pause':
      if (!a.host) return fail('Only the host can do that.');
      if (state.phase !== 'turn') return fail('No turn running.');
      pauseTimer(state, ctx.now);
      return;
    case 'resume':
      if (!a.host) return fail('Only the host can do that.');
      if (state.phase !== 'turn') return fail('No turn running.');
      resumeTimer(state, ctx.now);
      return;
    case 'endTurn':
      if (!a.host) return fail('Only the host can do that.');
      if (state.phase !== 'turn') return fail('No turn running.');
      endTurn(state, {});
      return;
    case 'timeUp':
      if (!a.system) return fail('Only the clock can do that.');
      if (state.phase === 'turn') endTurn(state, { timedOut: true });
      return;
    case 'nextTurn':
      if (!a.host) return fail('Only the host can do that.');
      if (state.phase !== 'turnEnd') return fail('Finish this turn first.');
      advance(state, ctx);
      return;
    case 'playAgain':
      if (!a.host) return fail('Only the host can do that.');
      if (state.phase !== 'final') return fail('The game is still going.');
      resetForReplay(state);
      return;
    default:
      return fail('Unknown move.');
  }
}

export const deadline = timerDeadline;

export function addPlayer(state, player) {
  if (inGame(state, player.id)) return;
  state.players.push({ id: player.id, name: player.name, color: player.color });
  if (!state.submissions[player.id]) state.submissions[player.id] = [];
  if (state.phase !== 'submit' && state.phase !== 'final') state.order.push(player.id);
}

export function removePlayer(state, id, ctx) {
  delete state.submissions[id];
  if (state.phase === 'submit') {
    state.players = state.players.filter((p) => p.id !== id);
    if (state.players.length && ids(state).every((pid) => (state.submissions[pid] || []).length >= state.submitTarget)) {
      finishSubmit(state, ctx);
    }
    return;
  }
  const wasActive = activePlayer(state) === id;
  const idx = state.order.indexOf(id);
  state.players = state.players.filter((p) => p.id !== id);
  if (idx !== -1) {
    state.order.splice(idx, 1);
    if (idx < state.turnIndex) state.turnIndex -= 1;
    if (state.order.length && state.turnIndex >= state.order.length) state.turnIndex = 0;
  }
  if (state.players.length < 2 && state.phase !== 'final') {
    finish(state);
    return;
  }
  if (wasActive && state.phase === 'turn') {
    if (state.turn && state.turn.card) state.pot.push(state.turn.card);
    stopTimer(state);
    state.turn = null;
    state.phase = 'ready';
  }
}

function common(state) {
  const submitting = state.phase === 'submit';
  const active = submitting ? null : activePlayer(state);
  return {
    phase: state.phase,
    mode: state.mode,
    players: ids(state),
    round: state.round,
    roundsTotal: ROUNDS_TOTAL,
    roundLabel: ROUND_LABELS[state.round - 1],
    roundRule: ROUND_RULES[state.round - 1],
    active,
    upNext: !submitting && state.order.length > 1 ? state.order[(state.turnIndex + 1) % state.order.length] : null,
    timer: state.timer || null,
    potLeft: submitting ? null : state.pot.length,
    gottenCount: state.turn ? state.turn.gotten.length : 0,
    submitTarget: state.submitTarget,
    submitReadyCount: submitting ? ids(state).filter((id) => (state.submissions[id] || []).length >= state.submitTarget).length : null,
    // Who is still writing (names only, never what anyone wrote).
    submitPending: submitting ? ids(state).filter((id) => (state.submissions[id] || []).length < state.submitTarget) : null,
    totalPlayers: ids(state).length,
    lastTurn: state.phase === 'turnEnd' ? state.lastTurn : null,
    final: state.final,
    scores: leaderboard(state, ids(state)),
    teams: state.teams,
    toast: state.toast || null,
  };
}

export function playerView(state, playerId) {
  const base = common(state);
  if (state.phase === 'submit') {
    if (!inGame(state, playerId)) return { ...base, me: null };
    const mine = state.submissions[playerId] || [];
    return {
      ...base,
      me: playerId,
      mySubmissions: mine,
      myCount: mine.length,
      myDone: mine.length >= state.submitTarget,
    };
  }
  if (!inGame(state, playerId)) return { ...base, me: null, watching: true };
  const isActive = playerId === base.active;
  const view = { ...base, me: playerId, isActive };
  // The secret: only the active player's own phone, and only in a room (in
  // pass and play the shared phone IS the performer; see tvView).
  if (isActive && state.phase === 'turn' && state.mode === 'room') {
    view.card = state.turn.card;
  }
  return view;
}

// Public screen: the TV in a room (never the secret), the shared phone in
// pass and play (the performer IS holding it, so it needs the card to read
// from while describing or acting).
export function tvView(state) {
  const base = common(state);
  if (state.mode === 'pass' && state.phase === 'turn' && state.turn) {
    return { ...base, card: state.turn.card };
  }
  return base;
}

export function hostActions(state) {
  switch (state.phase) {
    case 'submit':
      return collectPhrases(state).length
        ? [{
          type: 'forceStart',
          label: 'Start with what we have',
          tone: 'secondary',
          confirm: "Start now? Anyone who hasn't finished writing misses out on their phrases this game.",
        }]
        : [];
    case 'ready':
      return [{ type: 'start', label: `Start ${nameOf(state, activePlayer(state))}'s turn`, tone: 'primary' }];
    case 'turn':
      return [
        state.timer && state.timer.paused
          ? { type: 'resume', label: 'Resume', tone: 'secondary' }
          : { type: 'pause', label: 'Pause', tone: 'secondary' },
        { type: 'endTurn', label: 'End turn', tone: 'secondary', confirm: 'End this turn now?' },
      ];
    case 'turnEnd':
      return [{
        type: 'nextTurn',
        label: state.round >= ROUNDS_TOTAL && state.lastTurn && state.lastTurn.roundDone ? 'See the results' : 'Next turn',
        tone: 'primary',
      }];
    case 'final':
      return [{ type: 'playAgain', label: 'Play again', tone: 'primary' }];
    default:
      return [];
  }
}

// One phone: each player gets a private moment to write their phrases
// without the table seeing them in advance. Nobody needs a private handoff
// mid-turn: the performer IS the shared phone (see tvView).
export function passTurn(state) {
  if (state.phase !== 'submit') return null;
  return ids(state).find((id) => (state.submissions[id] || []).length < state.submitTarget) || null;
}

const BOT_WORDS = [
  'Rubber duck', 'Night owl', 'Pineapple pizza', 'Secret handshake', 'Couch potato',
  'Road trip', 'Dad joke', 'Time travel', 'Backyard cricket', 'Karaoke night',
];

function randomPhrase(ctx, n) {
  return `${pick(BOT_WORDS, ctx.rng)} #${n + 1}`;
}

export function bot(state, playerId, ctx) {
  if (playerId === null) {
    if (state.phase === 'turn' && state.mode === 'pass') {
      return { type: ctx.rng() < 0.75 ? 'gotIt' : 'skip', payload: null };
    }
    const acts = hostActions(state).filter((x) => x.type !== 'forceStart' || ctx.rng() < 0.3);
    return acts.length ? { type: pick(acts, ctx.rng).type, payload: null } : null;
  }
  if (!inGame(state, playerId)) return null;
  if (state.phase === 'submit') {
    const mine = state.submissions[playerId] || [];
    if (mine.length < state.submitTarget) return { type: 'submitWords', payload: { text: randomPhrase(ctx, mine.length) } };
    return null;
  }
  if (state.phase === 'ready' && playerId === activePlayer(state)) return { type: 'start', payload: null };
  if (state.phase === 'turn' && state.mode === 'room' && playerId === activePlayer(state)) {
    return { type: ctx.rng() < 0.75 ? 'gotIt' : 'skip', payload: null };
  }
  return null;
}
