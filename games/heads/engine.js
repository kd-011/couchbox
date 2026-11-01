// Celebrity Heads: one guesser per turn, everyone else sees the word.
// Phases: ready -> play -> turnEnd -> ready ... -> final -> (playAgain) ready
import {
  shuffle, fail, toast, addScore, leaderboard,
  sip, shot, giveOut, isDrinking, isDeadly, deadlyMoment, lastPlaceShot, deadlyCard, stat, gameOver,
  startTimer, pauseTimer, resumeTimer, stopTimer, timerDeadline,
} from '../_kit/kit.js';

// meta.options is a static export read before any room exists (the lobby
// needs it to draw the picker), and this module is also loaded as a plain
// browser ES module for offline pass mode (public/js/games.js imports it
// directly, with no bundler) - so no node:fs and no JSON-module import
// syntax here, since neither parses on an older phone's browser. Keep this
// literally in sync with content.json's categories: same keys, same
// labels. games/heads/categories.test.mjs fails loudly if the two drift.
const CATS = [
  ['celebrities', 'Famous people'], ['movies', 'Movies'], ['characters', 'Characters'], ['animals', 'Animals'],
  ['jobs', 'Jobs'], ['places', 'Places'], ['food', 'Food and drink'],
  ['brands', 'Brands'], ['countries', 'Countries'], ['vehicles', 'Vehicles'],
];

export const meta = {
  id: 'heads',
  name: 'Celebrity Heads',
  emoji: '🎭',
  tagline: 'Everyone can see who you are except you. Ask yes or no questions.',
  blurb: 'A guessing game: the player in the hot seat asks yes or no questions to work out the famous name everyone else can see.',
  minPlayers: 2,
  maxPlayers: 16,
  order: 20,
  accent: '#ffb347',
  pitch: 'Guess who you are from yes or no answers',
  minutes: [10, 20],
  vibes: ['silly'],
  modes: ['pass', 'room'],
  howto: [
    'One player takes the hot seat and can\'t see the word',
    'Everyone else answers their yes or no questions, never saying it',
    'Tap Got it for each right guess before the timer runs out',
  ],
  variants: {
    standard: 'One point per correct guess. Most points after everyone has had a go wins.',
    drinking: 'Every pass is a sip. Guess nothing, drink 3. Lowest score drinks 5 at the end.',
    deadly: 'Guess nothing on your turn and take a shot. Last place at the end takes a shot.',
  },
  options: [
    { key: 'seconds', label: 'Turn length', type: 'stepper', min: 30, max: 120, step: 15, default: 60, suffix: 's' },
    { key: 'turns', label: 'Turns each', type: 'stepper', min: 1, max: 3, step: 1, default: 1 },
    {
      key: 'categories', label: 'Categories', type: 'multi', default: CATS.map(([v]) => v),
      choices: CATS.map(([value, label]) => ({ value, label })),
    },
  ],
};

// Curated packs (games/heads/packs/) need no code here; this only names one
// item in the pack picker.
export const curated = { itemLabel: 'name' };

const ids = (state) => state.players.map((p) => p.id);
const inGame = (state, id) => state.players.some((p) => p.id === id);

function buildDeck(state, ctx) {
  const cats = ctx.content.categories;
  const keys = state.options.categories.filter((k) => cats[k]);
  // A name in two categories (Harry Potter: a movie and a character) goes in once.
  const pool = [...new Set((keys.length ? keys : Object.keys(cats)).flatMap((k) => cats[k].items))];
  return shuffle(pool, ctx.rng);
}

function nextWord(state, ctx) {
  if (state.deckPos >= state.deck.length) {
    state.deck = buildDeck(state, ctx);
    state.deckPos = 0;
  }
  state.word = state.deck[state.deckPos++];
  state.wordId += 1;
}

function beginRotation(state, ctx) {
  state.order = shuffle(ids(state), ctx.rng);
  state.turnIndex = 0;
  state.rotation = 1;
  state.phase = 'ready';
  state.turn = null;
  state.final = null;
  stopTimer(state);
}

export function init(ctx) {
  const state = {
    phase: 'ready',
    players: ctx.players.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    scores: {},
    deck: [],
    deckPos: 0,
    word: null,
    wordId: 0,
    mode: ctx.mode,
    variant: ctx.variant,
    options: ctx.options,
  };
  state.deck = buildDeck(state, ctx);
  beginRotation(state, ctx);
  return state;
}

const guesser = (state) => state.order[state.turnIndex] || null;

// Name a Deadly takeover after the rule that poured it. The runtime gathers
// every shot of this action into it (a player who is out shows with their
// forfeit instead).
function shotMoment(state, entries, title, sub) {
  if (isDeadly(state) && entries.some(Boolean)) deadlyMoment(state, { kind: 'shot', title, sub });
}

function endTurn(state) {
  stopTimer(state);
  const g = guesser(state);
  const t = state.turn;
  // Pass sips were poured live (and are already in t.drinks); only the
  // guessed-nothing penalty lands here. Scores count in every tier.
  if (!t.got.length) {
    const e = isDeadly(state) ? shot(state, g, 'guessed nothing') : sip(state, g, 3, 'guessed nothing');
    t.drinks.push(e);
    shotMoment(state, [e], 'Guessed Nothing', 'A whole turn in the hot seat and not one right');
  }
  t.drinks = t.drinks.filter(Boolean);
  if (t.got.length) stat(state, g, 'guesser', t.got.length);
  state.lastWord = state.word;
  state.word = null;
  state.phase = 'turnEnd';
}

// A Deadly card may turn up between turns, but not when someone leaves.
function advance(state, ctx, card = true) {
  state.turnIndex += 1;
  if (state.turnIndex >= state.order.length) {
    if (state.rotation < state.options.turns) {
      state.rotation += 1;
      state.turnIndex = 0;
    } else {
      return finish(state, ctx);
    }
  }
  state.turn = null;
  state.phase = 'ready';
  if (card) deadlyCard(state, ctx.rng);
}

function finish(state, ctx) {
  const board = leaderboard(state, ids(state));
  const drinks = [];
  if (isDrinking(state) && board.length > 1) {
    const low = board[board.length - 1].score;
    const high = board[0].score;
    if (high !== low) {
      if (isDeadly(state)) drinks.push(...lastPlaceShot(state, board, 'last place', ctx.rng));
      else for (const r of board) if (r.score === low) drinks.push(sip(state, r.id, 5, 'lowest score'));
      for (const r of board) if (r.score === high) drinks.push(giveOut(state, r.id, 5, 'top score'));
    } else {
      for (const r of board) drinks.push(sip(state, r.id, 2, 'all tied, everyone drinks'));
    }
  }
  state.final = { board, drinks: drinks.filter(Boolean) };
  state.phase = 'final';
  state.turn = null;
  gameOver(state, board);
}

// Who may press Got it / Pass: on one phone the shared screen (host); on
// own phones anyone except the guesser, who can't see the word.
function canMark(state, a) {
  if (state.mode === 'pass') return a.host || a.from === null;
  return inGame(state, a.from) && a.from !== guesser(state);
}

export function act(state, a, ctx) {
  switch (a.type) {
    case 'start': {
      if (state.phase !== 'ready') return fail('A turn is already running.');
      if (!(a.host || a.from === guesser(state))) return fail('Only the guesser or the host can start the turn.');
      state.turn = { got: [], passed: [], drinks: [] };
      nextWord(state, ctx);
      startTimer(state, state.options.seconds * 1000, ctx.now, 'timeUp');
      state.phase = 'play';
      return;
    }
    case 'got':
    case 'pass': {
      if (state.phase !== 'play') return fail('No turn running.');
      if (!canMark(state, a)) return fail(state.mode === 'room' && a.from === guesser(state) ? 'No peeking: the others mark your guesses.' : 'You cannot mark this one.');
      // Two phones tapping the same word at once must only count once.
      if (a.payload !== state.wordId) return;
      if (a.type === 'got') {
        state.turn.got.push(state.word);
        addScore(state, guesser(state), 1);
      } else {
        state.turn.passed.push(state.word);
        // The pass sip is poured now so the tally stays live; the turn
        // recap lists it from turn.drinks (not counted again at turn end).
        const e = sip(state, guesser(state), 1, 'passed');
        if (e) {
          state.turn.drinks.push(e);
          const who = nameOf(state, guesser(state));
          toast(state, e.unit === 'forfeit' ? `${who}: forfeit instead of a sip` : `${who} sips 1`, 'drink');
        }
      }
      nextWord(state, ctx);
      return;
    }
    case 'pause':
      if (!a.host) return fail('Only the host can do that.');
      if (state.phase !== 'play') return fail('No turn running.');
      pauseTimer(state, ctx.now);
      return;
    case 'resume':
      if (!a.host) return fail('Only the host can do that.');
      if (state.phase !== 'play') return fail('No turn running.');
      resumeTimer(state, ctx.now);
      return;
    case 'timeUp':
      if (!a.system) return fail('Only the clock can do that.');
      if (state.phase === 'play') endTurn(state);
      return;
    case 'endTurn':
      if (!a.host) return fail('Only the host can do that.');
      if (state.phase !== 'play') return fail('No turn running.');
      endTurn(state);
      return;
    case 'nextTurn':
      if (!a.host) return fail('Only the host can do that.');
      if (state.phase !== 'turnEnd') return fail('Finish this turn first.');
      advance(state, ctx);
      return;
    case 'skipTurn':
      if (!a.host) return fail('Only the host can do that.');
      if (state.phase !== 'ready') return fail('Only before a turn starts.');
      advance(state, ctx);
      return;
    case 'playAgain':
      if (!a.host) return fail('Only the host can do that.');
      if (state.phase !== 'final') return fail('The game is still going.');
      state.scores = {};
      beginRotation(state, ctx);
      return;
    default:
      return fail('Unknown move.');
  }
}

function nameOf(state, id) {
  return (state.players.find((p) => p.id === id) || {}).name || 'Someone';
}

export function deadline(state) {
  return timerDeadline(state);
}

export function addPlayer(state, player) {
  if (inGame(state, player.id)) return;
  state.players.push({ id: player.id, name: player.name, color: player.color });
  // Joins the end of the rotation so they still get a turn this game.
  if (state.phase !== 'final') state.order.push(player.id);
}

export function removePlayer(state, id, ctx) {
  const wasGuesser = guesser(state) === id;
  const idx = state.order.indexOf(id);
  state.players = state.players.filter((p) => p.id !== id);
  if (idx === -1) return;
  state.order.splice(idx, 1);
  if (idx < state.turnIndex) state.turnIndex -= 1;
  if (wasGuesser && (state.phase === 'play' || state.phase === 'turnEnd' || state.phase === 'ready')) {
    stopTimer(state);
    state.turn = null;
    state.word = null;
    state.turnIndex -= 1;
    advance(state, ctx, false);
  }
  if (state.players.length < 2 && state.phase !== 'final') finish(state, ctx);
}

function common(state) {
  const g = guesser(state);
  const t = state.turn;
  return {
    phase: state.phase,
    players: ids(state),
    guesser: g,
    upNext: state.order[state.turnIndex + 1] || (state.rotation < state.options.turns ? state.order[0] : null),
    turnNo: state.turnIndex + 1,
    turnsTotal: state.order.length,
    rotation: state.rotation,
    rotations: state.options.turns,
    timer: state.timer || null,
    gotCount: t ? t.got.length : 0,
    passCount: t ? t.passed.length : 0,
    // Words from this turn are shown once the turn ends, never during it.
    recap: state.phase === 'turnEnd' && t ? { got: t.got, passed: t.passed, drinks: t.drinks, lastWord: state.lastWord } : null,
    scores: leaderboard(state, ids(state)),
    final: state.final,
    toast: state.toast || null,
  };
}

export function playerView(state, playerId) {
  const base = common(state);
  if (!inGame(state, playerId)) return { ...base, me: null, watching: true };
  const isGuesser = playerId === base.guesser;
  const view = { ...base, me: playerId, role: isGuesser ? 'guesser' : 'clue' };
  // The guesser never receives the word while it is live.
  if (state.phase === 'play' && !isGuesser) {
    view.word = state.word;
    view.wordId = state.wordId;
  }
  return view;
}

export function tvView(state) {
  const base = common(state);
  // On one phone the shared screen IS the forehead card, so it shows the
  // word. A TV in a room faces the guesser too, so it never does.
  if (state.mode === 'pass' && state.phase === 'play') {
    return { ...base, word: state.word, wordId: state.wordId };
  }
  return base;
}

export function hostActions(state) {
  switch (state.phase) {
    case 'ready':
      return [
        { type: 'start', label: 'Start the turn', tone: 'primary' },
        { type: 'skipTurn', label: 'Skip this player', tone: 'secondary' },
      ];
    case 'play':
      return [
        state.timer && state.timer.paused
          ? { type: 'resume', label: 'Resume', tone: 'secondary' }
          : { type: 'pause', label: 'Pause', tone: 'secondary' },
        { type: 'endTurn', label: 'End turn', tone: 'secondary', confirm: 'End this turn now?' },
      ];
    case 'turnEnd':
      return [{ type: 'nextTurn', label: state.turnIndex + 1 >= state.order.length && state.rotation >= state.options.turns ? 'See the results' : 'Next player', tone: 'primary' }];
    case 'final':
      return [{ type: 'playAgain', label: 'Play again', tone: 'primary' }];
    default:
      return [];
  }
}

// Celebrity Heads is played on the shared screen in pass-and-play: the
// phone is the forehead card, so there is never a private turn.
export function passTurn() {
  return null;
}

export function bot(state, playerId, ctx) {
  if (playerId === null) {
    if (state.phase === 'play' && state.mode === 'pass') {
      return { type: ctx.rng() < 0.7 ? 'got' : 'pass', payload: state.wordId };
    }
    const acts = hostActions(state).filter((x) => x.type !== 'skipTurn' || ctx.rng() < 0.1);
    return acts.length ? { type: acts[Math.floor(ctx.rng() * acts.length)].type, payload: null } : null;
  }
  if (!inGame(state, playerId)) return null;
  if (state.phase === 'ready' && playerId === guesser(state)) return { type: 'start', payload: null };
  if (state.phase === 'play' && state.mode === 'room' && playerId !== guesser(state)) {
    return { type: ctx.rng() < 0.7 ? 'got' : 'pass', payload: state.wordId };
  }
  return null;
}
