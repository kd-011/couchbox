// Sketchy: draw-and-guess. One drawer per turn sketches a secret word on
// their own canvas, everyone else watches it appear live and races to guess.
// Phases: ready -> draw -> turnEnd -> ready ... -> final -> (playAgain) ready
import {
  pick, shuffle, clamp, fail, addScore, leaderboard,
  sip, shot, isDeadly, deadlyMoment, deadlyCard, stat, gameOver, teamOf, teamShot, teamLeaderboard,
  startTimer, pauseTimer, resumeTimer, stopTimer, timerDeadline,
} from '../_kit/kit.js';

export const meta = {
  id: 'sketchy',
  name: 'Sketchy',
  emoji: '✏️',
  tagline: 'One phone draws, everyone else races to guess.',
  blurb: 'A draw-and-guess party game: the drawer sketches a secret word live on their phone while everyone else watches it appear and types their guess.',
  minPlayers: 3,
  maxPlayers: 12,
  order: 100,
  accent: '#51cf66',
  pitch: 'One phone draws, everyone else races to guess',
  minutes: [15, 25],
  vibes: ['silly'],
  modes: ['pass', 'room'],
  teams: true,
  audience: true,
  variants: {
    standard: 'Faster correct guesses score more. The drawer scores a point for every guesser who gets it.',
    drinking: 'Nobody guesses it, the drawer drinks. Never guess one right all game, drink at the end.',
    deadly: 'Nobody guesses your drawing: shot. Never guess one right all game: shot at the end.',
  },
  options: [
    { key: 'drawSeconds', label: 'Draw time', type: 'stepper', min: 45, max: 120, step: 15, default: 75, suffix: 's' },
    { key: 'turns', label: 'Turns each', type: 'stepper', min: 1, max: 3, step: 1, default: 2 },
    {
      key: 'difficulty', label: 'Word difficulty', type: 'choice', default: 'mixed',
      choices: [{ value: 'mixed', label: 'Mixed' }, { value: 'easy', label: 'Easy' }, { value: 'hard', label: 'Hard' }],
    },
  ],
  howto: [
    'The drawer peeks at a secret word, then sketches it. No writing.',
    'Everyone else races to guess it. Faster guesses score more.',
    'Swap drawers each turn until everyone has had a go.',
  ],
};

// Curated packs (games/sketchy/packs/): a themed word list must bring all
// three difficulty tiers, so "Easy", "Hard" and "Mixed" all stay on theme.
export const curated = { itemLabel: 'word', required: ['easy', 'medium', 'hard'] };

const MAX_POINTS = 3000;
const SAFE_COLORS = ['#1f2430', '#ff5d73', '#51cf66', '#ffb347', '#4dabf7', '#9d7bff', '#ffffff', '#000000'];

const ids = (state) => state.players.map((p) => p.id);
const inGame = (state, id) => state.players.some((p) => p.id === id);
const guesser = (state) => state.order[state.turnIndex] || null;

function validColor(c) {
  return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
}

function sanitizePoints(points) {
  if (!Array.isArray(points)) return [];
  const out = [];
  for (const p of points.slice(0, 400)) {
    if (!Array.isArray(p) || p.length !== 2) continue;
    const x = Number(p[0]);
    const y = Number(p[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push([clamp(Math.round(x), 0, 1000), clamp(Math.round(y), 0, 1000)]);
  }
  return out;
}

// Who may send drawing actions right now: on one phone the shared screen IS
// the drawer once control has been handed back (host: true, from: null); on
// own phones only the player currently in the drawer's seat.
function canDraw(state, a) {
  if (state.mode === 'pass') return a.host || a.from === null;
  return a.from === guesser(state);
}

function pickTier(state, ctx) {
  if (state.options.difficulty === 'easy') return 'easy';
  if (state.options.difficulty === 'hard') return 'hard';
  return pick(['easy', 'medium', 'hard'], ctx.rng);
}

function nextWord(state, ctx) {
  const tier = pickTier(state, ctx);
  const pool = (ctx.content[tier] && ctx.content[tier].length ? ctx.content[tier] : ctx.content.medium) || [];
  const unused = pool.filter((w) => !state.used.includes(w));
  state.word = pick(unused.length ? unused : pool, ctx.rng);
  state.used = [...state.used.slice(-150), state.word];
}

function startReady(state, ctx) {
  state.phase = 'ready';
  state.turn = null;
  state.word = null;
  state.canvas = { strokes: [], live: null };
  stopTimer(state);
  nextWord(state, ctx);
}

function beginRotation(state, ctx) {
  state.order = shuffle(ids(state), ctx.rng);
  state.turnIndex = 0;
  state.rotation = 1;
  state.final = null;
  startReady(state, ctx);
}

export function init(ctx) {
  const state = {
    phase: 'ready',
    players: ctx.players.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    scores: {},
    gotEver: {},
    used: [],
    word: null,
    canvas: { strokes: [], live: null },
    mode: ctx.mode,
    variant: ctx.variant,
    options: ctx.options,
    // Unique per game, for the client's once-only effects (confetti).
    gameKey: String(ctx.now),
  };
  beginRotation(state, ctx);
  return state;
}

// Name a Deadly takeover after the rule that poured it. The runtime gathers
// every shot of this action into it (a player who is out shows with their
// forfeit instead).
function shotMoment(state, entries, title, sub) {
  if (isDeadly(state) && entries.some(Boolean)) deadlyMoment(state, { kind: 'shot', title, sub });
}

// A wrong guess, kept so the guesser's own screen can say "not that" (only
// ever shown back to the player who typed it).
function noteMiss(state, playerId, text) {
  if (!state.turn.misses) state.turn.misses = {};
  const prev = state.turn.misses[playerId];
  state.turn.misses[playerId] = { text: text.trim().slice(0, 40), n: (prev ? prev.n : 0) + 1 };
}

function markCorrect(state, playerId) {
  const rank = state.turn.correct.length;
  const points = rank === 0 ? 3 : rank === 1 ? 2 : 1;
  state.turn.correct.push({ id: playerId, points });
  state.gotEver[playerId] = true;
  addScore(state, playerId, points);
  addScore(state, guesser(state), 1);
}

function maybeEndTurn(state) {
  if (state.phase !== 'draw' || !state.turn) return;
  const eligible = ids(state).filter((id) => id !== guesser(state));
  if (eligible.length && eligible.every((id) => state.turn.correct.some((c) => c.id === id))) endTurn(state);
}

function endTurn(state) {
  stopTimer(state);
  const g = guesser(state);
  const t = state.turn;
  const drinks = [];
  // The word is revealed now, so the awards can count it.
  if (t.correct.length === 0) {
    const team = state.teams ? teamOf(state.teams, g) : null;
    if (team) {
      drinks.push(...teamShot(state, team, 'nobody got the drawing'));
    } else {
      drinks.push(isDeadly(state) ? shot(state, g, 'nobody got your drawing') : sip(state, g, 2, 'nobody got it'));
      shotMoment(state, drinks, 'Nobody Got It', 'Nobody guessed the drawing: the artist takes a shot');
    }
  } else {
    stat(state, g, 'artist');
    for (const c of t.correct) stat(state, c.id, 'guesser');
  }
  t.drinks = drinks.filter(Boolean);
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
      finish(state);
      return;
    }
  }
  startReady(state, ctx);
  if (card) deadlyCard(state, ctx.rng);
}

// pour = false when the game is abandoned (fewer than 2 players left).
function finish(state, pour = true) {
  const board = leaderboard(state, ids(state));
  const drinks = [];
  const why = 'never guessed one right all game';
  for (const id of pour ? ids(state) : []) {
    if (!state.gotEver[id]) drinks.push(isDeadly(state) ? shot(state, id, why) : sip(state, id, 3, why));
  }
  shotMoment(state, drinks, 'Never Got One', 'Not one drawing guessed right all game');
  state.final = { board, teamBoard: state.teams ? teamLeaderboard(state, state.teams) : null, drinks: drinks.filter(Boolean) };
  state.phase = 'final';
  state.turn = null;
  gameOver(state, board);
}

export function act(state, a, ctx) {
  switch (a.type) {
    case 'start': {
      if (state.phase !== 'ready') return fail('A turn is already running.');
      if (!(a.host || a.from === guesser(state))) return fail('Only the drawer or the host can start.');
      state.turn = { correct: [], pointCount: 0, drinks: [], audienceCorrect: [], misses: {} };
      state.canvas = { strokes: [], live: null };
      startTimer(state, state.options.drawSeconds * 1000, ctx.now, 'timeUp');
      state.phase = 'draw';
      return;
    }
    case 'startStroke': {
      if (state.phase !== 'draw') return fail('No turn running.');
      if (!canDraw(state, a)) return fail('Only the drawer can draw.');
      const color = validColor(a.payload && a.payload.color) ? a.payload.color : '#1f2430';
      const width = clamp(Math.round(Number(a.payload && a.payload.width)) || 4, 1, 12);
      state.canvas.live = { points: [], color, width };
      return;
    }
    case 'addPoints': {
      if (state.phase !== 'draw') return fail('No turn running.');
      if (!canDraw(state, a)) return fail('Only the drawer can draw.');
      if (!state.canvas.live) return; // no stroke in progress: ignore quietly
      const room = MAX_POINTS - state.turn.pointCount;
      if (room <= 0) return; // hard cap reached: silently stop appending
      const pts = sanitizePoints(a.payload && a.payload.points).slice(0, room);
      state.canvas.live.points.push(...pts);
      state.turn.pointCount += pts.length;
      return;
    }
    case 'endStroke': {
      if (state.phase !== 'draw') return fail('No turn running.');
      if (!canDraw(state, a)) return fail('Only the drawer can draw.');
      if (!state.canvas.live) return;
      state.canvas.strokes.push(state.canvas.live);
      state.canvas.live = null;
      return;
    }
    case 'clearCanvas': {
      if (state.phase !== 'draw') return fail('No turn running.');
      if (!canDraw(state, a)) return fail('Only the drawer can draw.');
      state.canvas = { strokes: [], live: null };
      state.turn.pointCount = 0;
      return;
    }
    case 'guess': {
      if (state.phase !== 'draw') return fail('No turn running.');
      if (state.mode !== 'room') return fail('On one phone the host marks who got it.');
      if (!inGame(state, a.from)) return fail('You are not in this round.');
      if (a.from === guesser(state)) return fail('The drawer cannot guess.');
      if (state.turn.correct.some((c) => c.id === a.from)) return; // already got it
      const text = a.payload && typeof a.payload.text === 'string' ? a.payload.text : '';
      const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (norm(text) && state.word && norm(text) === norm(state.word)) {
        markCorrect(state, a.from);
        maybeEndTurn(state);
      } else if (norm(text)) noteMiss(state, a.from, text);
      return;
    }
    case 'audienceGuess': {
      if (state.phase !== 'draw') return fail('No turn running.');
      if (!(state.audience || []).includes(a.from)) return fail('Only the crowd can do that.');
      if (state.turn.audienceCorrect.includes(a.from)) return; // already got it
      const text = a.payload && typeof a.payload.text === 'string' ? a.payload.text : '';
      const normGuess = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normGuess(text) && state.word && normGuess(text) === normGuess(state.word)) {
        state.turn.audienceCorrect.push(a.from);
        stat(state, a.from, 'guesser');
      } else if (normGuess(text)) noteMiss(state, a.from, text);
      return;
    }
    case 'markGot': {
      // One phone: the group shouts guesses out loud, the host taps who got it.
      if (!a.host) return fail('Only the host can do that.');
      if (state.mode !== 'pass') return fail('Guessers mark themselves in a room.');
      if (state.phase !== 'draw') return fail('No turn running.');
      const id = a.payload;
      if (typeof id !== 'string' || !inGame(state, id) || id === guesser(state)) return fail('Pick a player who is guessing.');
      if (state.turn.correct.some((c) => c.id === id)) return; // already marked
      markCorrect(state, id);
      maybeEndTurn(state);
      return;
    }
    case 'pause':
      if (!a.host) return fail('Only the host can do that.');
      if (state.phase !== 'draw') return fail('No turn running.');
      pauseTimer(state, ctx.now);
      return;
    case 'resume':
      if (!a.host) return fail('Only the host can do that.');
      if (state.phase !== 'draw') return fail('No turn running.');
      resumeTimer(state, ctx.now);
      return;
    case 'timeUp':
      if (!a.system) return fail('Only the clock can do that.');
      if (state.phase === 'draw') endTurn(state);
      return;
    case 'endTurn':
      if (!a.host) return fail('Only the host can do that.');
      if (state.phase !== 'draw') return fail('No turn running.');
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
      state.gotEver = {};
      state.gameKey = String(ctx.now);
      beginRotation(state, ctx);
      return;
    default:
      return fail('Unknown move.');
  }
}

export const deadline = timerDeadline;

export function addPlayer(state, player) {
  if (inGame(state, player.id)) return;
  state.players.push({ id: player.id, name: player.name, color: player.color });
  if (state.phase !== 'final') state.order.push(player.id);
}

export function removePlayer(state, id, ctx) {
  const wasDrawer = guesser(state) === id;
  const idx = state.order.indexOf(id);
  state.players = state.players.filter((p) => p.id !== id);
  delete state.gotEver[id];
  if (state.turn) {
    state.turn.correct = state.turn.correct.filter((c) => c.id !== id);
    state.turn.audienceCorrect = state.turn.audienceCorrect.filter((x) => x !== id);
  }
  if (idx !== -1) {
    state.order.splice(idx, 1);
    if (idx < state.turnIndex) state.turnIndex -= 1;
  }
  if (state.players.length < 2 && state.phase !== 'final') {
    finish(state, false);
    return;
  }
  if (wasDrawer && idx !== -1 && state.phase !== 'final') {
    stopTimer(state);
    state.turn = null;
    state.word = null;
    state.canvas = { strokes: [], live: null };
    state.turnIndex -= 1;
    advance(state, ctx, false);
    return;
  }
  if (!wasDrawer && state.phase === 'draw' && state.turn) maybeEndTurn(state);
}

function common(state) {
  const g = guesser(state);
  const t = state.turn;
  return {
    phase: state.phase,
    players: ids(state),
    drawer: g,
    upNext: state.order[state.turnIndex + 1] || (state.rotation < state.options.turns ? state.order[0] : null),
    turnNo: state.turnIndex + 1,
    turnsTotal: state.order.length,
    rotation: state.rotation,
    rotations: state.options.turns,
    timer: state.timer || null,
    canvas: state.canvas,
    correctIds: t ? t.correct.map((c) => c.id) : [],
    correctCount: t ? t.correct.length : 0,
    eligibleCount: Math.max(0, ids(state).length - 1),
    // Public: who has not guessed a drawing right yet this game.
    neverGot: ids(state).filter((id) => !state.gotEver[id]),
    recap: state.phase === 'turnEnd' && t ? { correct: t.correct, lastWord: state.lastWord, drinks: t.drinks } : null,
    scores: leaderboard(state, ids(state)),
    final: state.final,
    toast: state.toast || null,
    teams: state.teams,
    audienceCount: (state.audience || []).length,
    gameKey: state.gameKey || '',
  };
}

export function playerView(state, playerId) {
  const base = common(state);
  if (!inGame(state, playerId)) {
    const audience = (state.audience || []).includes(playerId);
    if (audience && state.phase === 'draw') {
      return {
        ...base, me: null, audience: true, role: 'guesser',
        gotIt: (state.turn.audienceCorrect || []).includes(playerId),
        lastMiss: (state.turn.misses || {})[playerId] || null,
      };
    }
    return { ...base, me: null, audience, watching: true };
  }
  const isDrawer = playerId === base.drawer;
  const view = { ...base, me: playerId, role: isDrawer ? 'drawer' : 'guesser' };
  // The drawer sees the word while deciding to start, and on their own
  // private phone while drawing in a room. In pass and play the shared
  // screen is physically visible to everyone during the draw phase, so the
  // word never appears there: the drawer must remember it.
  if (isDrawer && (state.phase === 'ready' || (state.phase === 'draw' && state.mode === 'room'))) {
    view.word = state.word;
  }
  if (!isDrawer && state.phase === 'draw') {
    view.gotIt = base.correctIds.includes(playerId);
    view.lastMiss = (state.turn && state.turn.misses && state.turn.misses[playerId]) || null;
  }
  return view;
}

// Public screen: the TV in a room, the shared phone in pass and play. Never
// shows the secret word, in either mode.
export function tvView(state) {
  return common(state);
}

export function hostActions(state) {
  switch (state.phase) {
    case 'ready':
      return [
        { type: 'start', label: 'Start drawing', tone: 'primary' },
        { type: 'skipTurn', label: 'Skip this player', tone: 'secondary' },
      ];
    case 'draw':
      return [
        state.timer && state.timer.paused
          ? { type: 'resume', label: 'Resume', tone: 'secondary' }
          : { type: 'pause', label: 'Pause', tone: 'secondary' },
        { type: 'endTurn', label: 'End turn', tone: 'secondary', confirm: 'End this turn now?' },
      ];
    case 'turnEnd':
      return [{ type: 'nextTurn', label: state.turnIndex + 1 >= state.order.length && state.rotation >= state.options.turns ? 'See the results' : 'Next drawer', tone: 'primary' }];
    case 'final':
      return [{ type: 'playAgain', label: 'Play again', tone: 'primary' }];
    default:
      return [];
  }
}

// Sketchy's private moment is the drawer peeking at the word before they
// start; once drawing begins the shared screen takes over (see client.js).
export function passTurn(state) {
  if (state.phase !== 'ready') return null;
  return guesser(state);
}

function randPoints(rng) {
  const n = 1 + Math.floor(rng() * 3);
  const out = [];
  for (let i = 0; i < n; i++) out.push([Math.floor(rng() * 1000), Math.floor(rng() * 1000)]);
  return out;
}

export function bot(state, playerId, ctx) {
  if (playerId === null) {
    if (state.phase === 'draw' && state.mode === 'pass' && state.turn) {
      if (ctx.rng() < 0.65) {
        if (!state.canvas.live) return { type: 'startStroke', payload: { color: pick(SAFE_COLORS, ctx.rng), width: 1 + Math.floor(ctx.rng() * 10) } };
        if (ctx.rng() < 0.2) return { type: 'endStroke', payload: null };
        if (ctx.rng() < 0.05) return { type: 'clearCanvas', payload: null };
        return { type: 'addPoints', payload: { points: randPoints(ctx.rng) } };
      }
      const eligible = ids(state).filter((id) => id !== guesser(state) && !state.turn.correct.some((c) => c.id === id));
      if (eligible.length) return { type: 'markGot', payload: pick(eligible, ctx.rng) };
      return null;
    }
    const acts = hostActions(state).filter((x) => x.type !== 'skipTurn' || ctx.rng() < 0.1);
    return acts.length ? { type: pick(acts, ctx.rng).type, payload: null } : null;
  }
  if (!inGame(state, playerId)) {
    if ((state.audience || []).includes(playerId) && state.phase === 'draw' && !state.turn.audienceCorrect.includes(playerId)) {
      const guessRight = ctx.rng() < 0.4;
      return { type: 'audienceGuess', payload: { text: guessRight ? state.word : `nope-${Math.floor(ctx.rng() * 1e6)}` } };
    }
    return null;
  }
  if (state.phase === 'ready' && playerId === guesser(state)) return { type: 'start', payload: null };
  if (state.phase !== 'draw' || !state.turn) return null;
  const isDrawer = playerId === guesser(state);
  if (isDrawer) {
    if (state.mode !== 'room') return null;
    if (!state.canvas.live) return { type: 'startStroke', payload: { color: pick(SAFE_COLORS, ctx.rng), width: 1 + Math.floor(ctx.rng() * 10) } };
    const r = ctx.rng();
    if (r < 0.2) return { type: 'endStroke', payload: null };
    if (r < 0.25) return { type: 'clearCanvas', payload: null };
    return { type: 'addPoints', payload: { points: randPoints(ctx.rng) } };
  }
  if (state.mode !== 'room') return null;
  if (state.turn.correct.some((c) => c.id === playerId)) return null;
  const guessRight = ctx.rng() < 0.4;
  return { type: 'guess', payload: { text: guessRight ? state.word : `nope-${Math.floor(ctx.rng() * 1e6)}` } };
}
