// Truth or Dare: turn-based, nothing secret. Whoever is up picks truth or
// dare, the prompt is revealed to everyone at once, and the group marks it
// done or skipped. Phases: ready -> reveal -> result -> ready ... -> final
// -> (playAgain) ready.
import {
  shuffle, pick, fail, addScore, leaderboard, SHOT_SIPS,
  sip, shot, isDeadly, deadlyMoment, deadlyCard, stat, gameOver,
} from '../_kit/kit.js';

export const meta = {
  id: 'tod',
  name: 'Truth or Dare',
  emoji: '🎯',
  tagline: 'Pick truth or dare, then the whole group holds you to it.',
  blurb: 'A turn-based party classic: whoever is up picks truth or dare, the prompt is revealed to everyone at once, and the group decides if they pulled it off.',
  minPlayers: 2,
  maxPlayers: 16,
  order: 33,
  accent: '#d7263d',
  pitch: 'Truth or dare, and the group holds you to it',
  minutes: [15, 30],
  vibes: ['silly'],
  modes: ['pass', 'room'],
  variants: {
    standard: 'Do it and score a point. Skip it and score nothing.',
    drinking: 'Do it and walk away clean. Skip it and drink 2.',
    deadly: 'Skip once, drink 2. Skip twice in a game: that one\'s a shot.',
  },
  options: [
    {
      key: 'spice', label: 'Spice level', type: 'choice', default: 'mild',
      choices: [{ value: 'mild', label: 'Mild' }, { value: 'spicy', label: 'Spicy' }, { value: 'wild', label: 'Wild' }],
    },
    { key: 'turnsEach', label: 'Turns each', type: 'stepper', min: 1, max: 5, step: 1, default: 2 },
  ],
  howto: [
    'On your turn, pick truth or dare.',
    'Answer the truth or do the dare, out loud, in front of everyone.',
    'Mark it done to score a point. Skip it and you pay for it.',
  ],
};

const ids = (state) => state.players.map((p) => p.id);
const inGame = (state, id) => state.players.some((p) => p.id === id);
const currentPlayer = (state) => state.order[state.turnIndex] || null;

// Curated packs (games/tod/packs/): a pack brings any of the three levels;
// the spicy and wild ones only ever play when the host picks that level.
export const curated = { itemLabel: 'card', spicyKeys: ['spicy', 'wild'] };

// Draw a prompt from this spice+type bucket without repeating until the
// bucket is exhausted, then start over. Mirrors Imposter's `used` list.
function drawPrompt(state, ctx, spice, type) {
  const pool = (ctx.content[spice] && ctx.content[spice][type]) || [];
  if (!pool.length) return 'No prompts left for this spice level.';
  const key = `${spice}:${type}`;
  const usedArr = state.used[key] || [];
  const unused = pool.filter((p) => !usedArr.includes(p));
  const text = pick(unused.length ? unused : pool, ctx.rng);
  state.used[key] = unused.length ? [...usedArr, text] : [text];
  return text;
}

function beginRotation(state, ctx) {
  state.order = shuffle(ids(state), ctx.rng);
  state.turnIndex = 0;
  state.rotation = 1;
  state.phase = 'ready';
  state.prompt = null;
  state.result = null;
  state.final = null;
  state.skips = {};
}

export function init(ctx) {
  const state = {
    phase: 'ready',
    players: ctx.players.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    scores: {},
    used: {},
    promptSeq: 0,
    mode: ctx.mode,
    variant: ctx.variant,
    options: ctx.options,
    // Unique per game, for the client's once-only effects (confetti).
    gameKey: String(ctx.now),
  };
  beginRotation(state, ctx);
  return state;
}

// There is no secrecy in this game, so either the player up or the host
// (the shared screen in pass and play) may act. Mirrors Celebrity Heads.
function canAct(state, a) {
  return a.host || a.from === currentPlayer(state);
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

function resolveTurn(state, outcome) {
  const who = currentPlayer(state);
  const drinks = [];
  if (outcome === 'did') {
    addScore(state, who, 1); // a point in every tier
    stat(state, who, 'brave');
  } else {
    stat(state, who, 'chicken');
    // Skips are counted in every tier, so a tier change mid-game stays fair.
    state.skips[who] = (state.skips[who] || 0) + 1;
    drinks.push(isDeadly(state) && state.skips[who] >= 2
      ? namedShot(state, who, 'skipped twice', 'Second Skip', 'Skip twice in a game: that one\'s a shot')
      : sip(state, who, 2, 'skipped it'));
  }
  state.result = { type: state.prompt.type, text: state.prompt.text, outcome, drinks: drinks.filter(Boolean) };
  state.prompt = null;
  state.phase = 'result';
}

function advance(state) {
  state.turnIndex += 1;
  if (state.turnIndex >= state.order.length) {
    if (state.rotation < state.options.turnsEach) {
      state.rotation += 1;
      state.turnIndex = 0;
    } else {
      finish(state);
      return;
    }
  }
  state.prompt = null;
  state.result = null;
  state.phase = 'ready';
}

function finish(state) {
  state.final = { board: leaderboard(state, ids(state)) };
  state.phase = 'final';
  state.prompt = null;
  state.result = null;
  gameOver(state, state.final.board);
}

export function act(state, a, ctx) {
  switch (a.type) {
    case 'choose': {
      // A double tap (player and host at once) lands here a second time
      // after the phase has already moved on: ignore it quietly.
      if (state.phase !== 'ready') return;
      if (!canAct(state, a)) return fail('Only the player up or the host can pick.');
      if (a.payload !== 'truth' && a.payload !== 'dare') return fail('Pick truth or dare.');
      const who = currentPlayer(state);
      if (!who) return fail('No one is up.');
      state.promptSeq += 1;
      state.prompt = { type: a.payload, text: drawPrompt(state, ctx, state.options.spice, a.payload), promptId: state.promptSeq };
      state.phase = 'reveal';
      return;
    }
    case 'resolve': {
      if (state.phase !== 'reveal') return; // already marked, ignore the double tap
      if (!canAct(state, a)) return fail('Only the player up or the host can mark this.');
      if (a.payload !== 'did' && a.payload !== 'skip') return fail('Mark it done or skipped.');
      resolveTurn(state, a.payload);
      return;
    }
    case 'next':
      if (!a.host) return fail('Only the host can do that.');
      if (state.phase !== 'result') return fail('Resolve this turn first.');
      advance(state);
      if (state.phase === 'ready') deadlyCard(state, ctx.rng);
      return;
    case 'playAgain':
      if (!a.host) return fail('Only the host can do that.');
      if (state.phase !== 'final') return fail('The game is still going.');
      state.scores = {};
      state.used = {};
      state.gameKey = String(ctx.now);
      beginRotation(state, ctx);
      return;
    default:
      return fail('Unknown move.');
  }
}

export function addPlayer(state, player) {
  if (inGame(state, player.id)) return;
  state.players.push({ id: player.id, name: player.name, color: player.color });
  // Joins the end of the rotation so they still get a turn this game.
  if (state.phase !== 'final') state.order.push(player.id);
}

export function removePlayer(state, id) {
  const wasCurrent = currentPlayer(state) === id;
  const idx = state.order.indexOf(id);
  state.players = state.players.filter((p) => p.id !== id);
  if (idx === -1) return;
  state.order.splice(idx, 1);
  if (idx < state.turnIndex) state.turnIndex -= 1;
  if (wasCurrent && state.phase !== 'final') {
    state.prompt = null;
    state.result = null;
    state.turnIndex -= 1;
    advance(state);
  }
  if (state.players.length < 2 && state.phase !== 'final') finish(state);
}

function common(state) {
  const who = currentPlayer(state);
  return {
    phase: state.phase,
    players: ids(state),
    current: who,
    upNext: state.order[state.turnIndex + 1] || (state.rotation < state.options.turnsEach ? state.order[0] : null),
    turnNo: state.turnIndex + 1,
    turnsTotal: state.order.length,
    rotation: state.rotation,
    rotations: state.options.turnsEach,
    spice: state.options.spice,
    prompt: state.phase === 'reveal' ? state.prompt : null,
    result: state.phase === 'result' ? state.result : null,
    scores: leaderboard(state, ids(state)),
    final: state.final,
    // Deadly telegraph: the player up has already skipped once this game.
    upSkips: who ? (state.skips[who] || 0) : 0,
    gameKey: state.gameKey || '',
  };
}

// Nothing here is secret: the player view and the TV view carry the same
// information, as the whole point is the group hearing the prompt live.
export function playerView(state, playerId) {
  const base = common(state);
  if (!inGame(state, playerId)) return { ...base, me: null, watching: true };
  return { ...base, me: playerId };
}

export function tvView(state) {
  return common(state);
}

export function hostActions(state) {
  switch (state.phase) {
    case 'ready':
      return [
        { type: 'choose', label: 'Truth', payload: 'truth', tone: 'secondary' },
        { type: 'choose', label: 'Dare', payload: 'dare', tone: 'primary' },
      ];
    case 'reveal':
      return [
        { type: 'resolve', label: 'Skipped', payload: 'skip', tone: 'secondary' },
        { type: 'resolve', label: 'Did it', payload: 'did', tone: 'primary' },
      ];
    case 'result':
      return [{
        type: 'next',
        label: state.turnIndex + 1 >= state.order.length && state.rotation >= state.options.turnsEach ? 'See the results' : 'Next player',
        tone: 'primary',
      }];
    case 'final':
      return [{ type: 'playAgain', label: 'Play again', tone: 'primary' }];
    default:
      return [];
  }
}

// No private step: the prompt is public the moment it's drawn, so pass and
// play never needs to gate the phone to one person.
export function passTurn() {
  return null;
}

export function bot(state, playerId, ctx) {
  const who = currentPlayer(state);
  if (playerId === null) {
    if (state.phase === 'ready') return { type: 'choose', payload: ctx.rng() < 0.5 ? 'truth' : 'dare' };
    if (state.phase === 'reveal') return { type: 'resolve', payload: ctx.rng() < 0.75 ? 'did' : 'skip' };
    if (state.phase === 'result') return { type: 'next', payload: null };
    if (state.phase === 'final') return { type: 'playAgain', payload: null };
    return null;
  }
  if (!inGame(state, playerId)) return null;
  if (state.phase === 'ready' && playerId === who) return { type: 'choose', payload: ctx.rng() < 0.5 ? 'truth' : 'dare' };
  if (state.phase === 'reveal' && playerId === who) return { type: 'resolve', payload: ctx.rng() < 0.75 ? 'did' : 'skip' };
  return null;
}
