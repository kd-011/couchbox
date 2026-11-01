// Never Have I Ever: one prompt per round, everyone secretly declares "I
// have" or "I haven't", then the room finds out who has.
// Phases: prompt -> reveal -> (next) prompt ... -> final -> (playAgain) prompt
import {
  pick, fail, addScore, leaderboard, SHOT_SIPS,
  sip, shot, isDeadly, deadlyMoment, deadlyCard, stat, gameOver,
} from '../_kit/kit.js';

export const meta = {
  id: 'nhie',
  name: 'Never Have I Ever',
  emoji: '🙊',
  tagline: 'Secretly confess, then see who else has.',
  blurb: 'A classic party confession game: read the prompt, say whether you have or haven’t done it, then see the split.',
  minPlayers: 2,
  maxPlayers: 16,
  order: 30,
  accent: '#4fd1c5',
  pitch: 'Confess in secret, then see who else has',
  minutes: [10, 30],
  vibes: ['silly'],
  modes: ['pass', 'room'],
  howto: [
    'Read the prompt out: never have I ever...',
    'Everyone answers I have or I haven\'t, honestly',
    'Reveal the split and see who has done it',
  ],
  variants: {
    standard: 'Say "I have" to a prompt and score a confession point. See who’s lived the wildest.',
    drinking: 'Everyone who says "I have" drinks 1.',
    deadly: 'Be the only one who has: lonely confession, take a shot.',
  },
  options: [
    { key: 'rounds', label: 'Rounds', type: 'stepper', min: 5, max: 30, step: 1, default: 12, suffix: ' rounds' },
    { key: 'spicy', label: 'Spicy prompts', type: 'toggle', default: false },
  ],
};

// A custom pack replaces the built-in prompts outright (no separate spicy
// list of its own: the "Spicy prompts" option just has nothing extra to add
// while a pack is loaded).
export const pack = {
  label: 'Confession prompts',
  itemLabel: 'prompt',
  fields: [
    { key: 'prompt', label: 'Prompt', type: 'textarea', maxLength: 140, placeholder: 'e.g. forgotten a close friend’s birthday' },
  ],
  minItems: 8,
  maxItems: 150,
  aiHint: 'This is Never Have I Ever: each prompt finishes the sentence "Never have I ever...", written in the second half only (lowercase, no "Never have I ever" prefix), something a player may or may not have done. Invent prompts that fit the theme, playful rather than cruel.',
  apply(content, items) {
    return { prompts: items.map((it) => it.prompt), spicy: [] };
  },
};

// Curated packs (games/nhie/packs/): a pack's `spicy` list only plays with
// "Spicy prompts" on; a pack without one keeps the built-in spicy list.
export const curated = { spicyKeys: ['spicy'] };

const ids = (state) => state.players.map((p) => p.id);
const inGame = (state, id) => state.players.some((p) => p.id === id);

function pool(state, ctx) {
  const main = ctx.content.prompts || [];
  const spicy = state.options.spicy && ctx.content.spicy ? ctx.content.spicy : [];
  return spicy.length ? [...main, ...spicy] : main;
}

function pickPrompt(state, ctx) {
  const all = pool(state, ctx);
  const unused = all.filter((p) => !state.used.includes(p));
  const prompt = pick(unused.length ? unused : all, ctx.rng);
  state.used = [...state.used.slice(-120), prompt];
  return prompt;
}

function deal(state, ctx) {
  // Late joiners are dealt in from the next round.
  for (const id of state.waiting) if (!state.players.some((p) => p.id === id)) {
    const p = ctx.players.find((x) => x.id === id);
    if (p) state.players.push({ id: p.id, name: p.name, color: p.color });
  }
  state.waiting = [];
  state.promptId += 1;
  state.prompt = pickPrompt(state, ctx);
  state.votes = {};
  state.passHas = [];
  state.result = null;
  state.phase = 'prompt';
}

export function init(ctx) {
  const state = {
    phase: 'prompt',
    round: 1,
    players: ctx.players.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    waiting: [],
    used: [],
    scores: {},
    promptId: 0,
    prompt: null,
    votes: {},
    passHas: [],
    result: null,
    final: null,
    mode: ctx.mode,
    variant: ctx.variant,
    options: ctx.options,
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

function revealRound(state) {
  const everyone = ids(state);
  const hasIds = state.mode === 'pass'
    ? state.passHas.filter((id) => everyone.includes(id))
    : everyone.filter((id) => state.votes[id] === true);
  // Deadly: the only one at a table of 3+ who has done it takes a shot.
  const lonely = isDeadly(state) && hasIds.length === 1 && everyone.length >= 3;
  const drinks = [];
  for (const id of hasIds) {
    addScore(state, id, 1); // a confession point, every tier
    stat(state, id, 'guilty');
    drinks.push(lonely
      ? namedShot(state, id, 'lonely confession', 'Lonely Confession', 'The only one who has: take a shot')
      : sip(state, id, 1, 'said "I have"'));
  }
  state.result = { hasIds, lonely, drinks: drinks.filter(Boolean) };
  state.phase = 'reveal';
}

function finish(state) {
  const board = leaderboard(state, ids(state));
  const drinks = [];
  const max = board.length ? board[0].score : 0;
  if (max > 0) for (const r of board) if (r.score === max) drinks.push(sip(state, r.id, 3, `most confessions (${max})`));
  state.final = { board, drinks: drinks.filter(Boolean) };
  state.phase = 'final';
  gameOver(state, board);
}

export function act(state, a, ctx) {
  switch (a.type) {
    case 'vote': {
      if (state.phase !== 'prompt') return fail('Not answering right now.');
      if (state.mode !== 'room') return fail('On one phone the host marks everyone’s answer.');
      if (!inGame(state, a.from)) return fail('You are not in this round.');
      if (!a.payload || typeof a.payload !== 'object') return fail('Bad answer.');
      if (a.payload.promptId !== state.promptId) return; // stale tap, ignore quietly
      if (typeof a.payload.has !== 'boolean') return fail('Bad answer.');
      state.votes[a.from] = a.payload.has;
      if (ids(state).every((id) => state.votes[id] !== undefined)) revealRound(state);
      return;
    }
    case 'markPass': {
      if (state.phase !== 'prompt') return fail('Not answering right now.');
      if (state.mode !== 'pass') return fail('Players answer on their own phones in a room.');
      if (!a.host) return fail('Only the shared screen can mark answers.');
      if (!a.payload || typeof a.payload !== 'object') return fail('Bad mark.');
      if (a.payload.promptId !== state.promptId) return; // stale tap, ignore quietly
      const pid = a.payload.playerId;
      if (typeof pid !== 'string' || !inGame(state, pid)) return fail('Pick a player in this round.');
      if (state.passHas.includes(pid)) state.passHas = state.passHas.filter((id) => id !== pid);
      else state.passHas.push(pid);
      return;
    }
    case 'reveal':
      if (!a.host) return fail('Only the host can do that.');
      if (state.phase !== 'prompt') return fail('Already revealed.');
      revealRound(state);
      return;
    case 'next':
      if (!a.host) return fail('Only the host can do that.');
      if (state.phase !== 'reveal') return fail('Reveal this round first.');
      if (state.round >= state.options.rounds) { finish(state); return; }
      state.round += 1;
      deadlyCard(state, ctx.rng);
      deal(state, ctx);
      return;
    case 'playAgain':
      if (!a.host) return fail('Only the host can do that.');
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

export function removePlayer(state, id) {
  state.players = state.players.filter((p) => p.id !== id);
  state.waiting = state.waiting.filter((x) => x !== id);
  delete state.votes[id];
  state.passHas = state.passHas.filter((x) => x !== id);
  if (state.phase === 'prompt' && state.mode === 'room' && state.players.length && ids(state).every((x) => state.votes[x] !== undefined)) {
    revealRound(state);
  }
  if (state.players.length < meta.minPlayers && state.phase !== 'final') finish(state);
}

function common(state) {
  return {
    phase: state.phase,
    round: state.round,
    rounds: state.options.rounds,
    players: ids(state),
    waiting: state.waiting,
    prompt: state.prompt,
    promptId: state.promptId,
    answered: state.mode === 'room' ? ids(state).filter((id) => state.votes[id] !== undefined) : [],
    passHas: state.mode === 'pass' ? state.passHas : [],
    scores: leaderboard(state, ids(state)),
    result: state.phase === 'reveal' ? state.result : null,
    final: state.final,
  };
}

export function playerView(state, playerId) {
  const base = common(state);
  if (!inGame(state, playerId)) return { ...base, me: null, watching: true };
  const voted = Object.prototype.hasOwnProperty.call(state.votes, playerId);
  return { ...base, me: playerId, myVote: voted ? state.votes[playerId] : null };
}

export function tvView(state) {
  return common(state);
}

export function hostActions(state) {
  switch (state.phase) {
    case 'prompt':
      return state.mode === 'pass'
        ? [{ type: 'reveal', label: 'Reveal', tone: 'primary' }]
        : [{ type: 'reveal', label: 'Reveal now', tone: 'secondary', confirm: 'Reveal before everyone has answered?' }];
    case 'reveal':
      return [{ type: 'next', label: state.round >= state.options.rounds ? 'See the results' : 'Next prompt', tone: 'primary' }];
    case 'final':
      return [{ type: 'playAgain', label: 'Play again', tone: 'primary' }];
    default:
      return [];
  }
}

// Never Have I Ever has no privacy need on one phone: everyone's at the
// table, so there is never a private pass-the-phone step.
export function passTurn() {
  return null;
}

export function bot(state, playerId, ctx) {
  if (playerId === null) {
    if (state.phase === 'prompt' && state.mode === 'pass') {
      if (!ids(state).length || ctx.rng() < 0.25) return { type: 'reveal', payload: null };
      return { type: 'markPass', payload: { promptId: state.promptId, playerId: pick(ids(state), ctx.rng) } };
    }
    const acts = hostActions(state);
    return acts.length ? { type: pick(acts, ctx.rng).type, payload: null } : null;
  }
  if (!inGame(state, playerId)) return null;
  if (state.phase === 'prompt' && state.mode === 'room' && state.votes[playerId] === undefined) {
    return { type: 'vote', payload: { promptId: state.promptId, has: ctx.rng() < 0.5 } };
  }
  return null;
}
