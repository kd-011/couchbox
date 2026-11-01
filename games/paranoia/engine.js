// Paranoia: the Asker privately reads a secret question, picks a Target,
// paraphrases it to them quietly at the table (out loud, outside the app),
// the Target names someone out loud, and a coin flip decides whether the
// question ever reaches the rest of the table.
// Phases: ask -> target -> answer -> result -> (nextRound) ask ...
import {
  shuffle, pick, fail, addScore, leaderboard,
  sip, shot, isDeadly, deadlyCard, gameOver,
} from '../_kit/kit.js';

export const meta = {
  id: 'paranoia',
  name: 'Paranoia',
  emoji: '🤫',
  tagline: 'A question whispered in secret, an answer said out loud, and a coin flip that decides if anyone ever finds out what was asked.',
  blurb: 'One player reads a secret "who would..." question, whispers it to a target at the table, and the whole room waits on a coin flip to find out whether the question ever gets said out loud.',
  minPlayers: 3,
  maxPlayers: 14,
  order: 150,
  accent: '#1864ab',
  pitch: 'Whisper a question, answer aloud, flip a coin',
  minutes: [10, 20],
  vibes: ['silly'],
  modes: ['pass', 'room'],
  howto: [
    'The Asker reads a secret question and whispers it to one player',
    'That player answers out loud with a name from the table',
    'A coin flip decides if the question gets read out to everyone',
  ],
  variants: {
    standard: 'Revealed or kept secret, the Asker always scores a point for keeping the game moving.',
    drinking: 'If the coin reveals it, the named player sips 2.',
    deadly: 'If the coin reveals it, the named player takes a shot.',
  },
  options: [
    { key: 'rounds', label: 'Rounds', type: 'stepper', min: 4, max: 20, step: 1, default: 8 },
    { key: 'spicy', label: 'Spicy questions', type: 'toggle', default: false },
  ],
};

// Curated packs (games/paranoia/packs/) need no code here; this only names one
// item in the pack picker.
export const curated = { itemLabel: 'question' };

const ids = (state) => state.players.map((p) => p.id);
const inGame = (state, id) => state.players.some((p) => p.id === id);

// Who may operate chooseTarget/recordAnswer: on own phones, only the Asker's
// own device; on one phone, the Asker has already had their private peek
// (passTurn, below) so from here on the shared screen is the table's
// scorekeeper (same "host: true, from: null" convention as Imposter's
// accuse and Sketchy's canDraw once control is handed back).
function canOperate(state, a) {
  if (state.mode === 'pass') return a.host || a.from === null;
  return a.from === state.askerId;
}

function pool(state, ctx) {
  const all = (ctx.content && ctx.content.questions) || [];
  return state.options.spicy ? all : all.filter((q) => !q.spicy);
}

function pickQuestion(state, ctx) {
  const all = pool(state, ctx);
  const unused = all.filter((q) => !state.used.includes(q.text));
  const q = pick(unused.length ? unused : all, ctx.rng);
  state.used = [...state.used.slice(-40), q.text];
  return q.text;
}

function deal(state, ctx) {
  state.question = pickQuestion(state, ctx);
  state.askerId = state.order[state.turnIndex % state.order.length];
  state.targetId = null;
  state.namedId = null;
  state.result = null;
  state.phase = 'ask';
}

export function init(ctx) {
  const state = {
    phase: 'ask',
    round: 1,
    players: ctx.players.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    order: shuffle(ctx.players.map((p) => p.id), ctx.rng),
    turnIndex: 0,
    used: [],
    scores: {},
    question: null,
    askerId: null,
    targetId: null,
    namedId: null,
    result: null,
    mode: ctx.mode,
    variant: ctx.variant,
    options: ctx.options,
  };
  deal(state, ctx);
  return state;
}

// The coin flip happens right here, the instant the answer is recorded: no
// separate host "flip" step. Always keep score, even when the mystery wins.
function resolveAnswer(state, ctx) {
  const revealed = ctx.rng() < 0.5;
  const drinks = [];
  if (revealed) {
    const why = 'the coin revealed it';
    drinks.push(isDeadly(state) ? shot(state, state.namedId, why) : sip(state, state.namedId, 2, why));
  }
  addScore(state, state.askerId, 1);
  state.result = {
    question: state.question, targetId: state.targetId, namedId: state.namedId, revealed, drinks: drinks.filter(Boolean),
  };
  state.phase = 'result';
  if (state.round >= (state.options.rounds || 8)) gameOver(state);
}

export function act(state, a, ctx) {
  const { type, payload, from, host } = a;
  switch (type) {
    case 'read':
      if (state.phase !== 'ask') return fail('Not reading a question right now.');
      if (from !== state.askerId) return fail('Only the Asker can do that.');
      state.phase = 'target';
      return;
    case 'chooseTarget': {
      if (state.phase !== 'target') return fail('Not choosing a target right now.');
      if (!canOperate(state, a)) return fail('Only the Asker can do that.');
      if (typeof payload !== 'string' || !inGame(state, payload)) return fail('Pick a player in this round.');
      if (payload === state.askerId) return fail('Pick someone other than yourself.');
      state.targetId = payload;
      state.phase = 'answer';
      return;
    }
    case 'recordAnswer': {
      if (state.phase !== 'answer') return fail('Not recording an answer right now.');
      if (!canOperate(state, a)) return fail('Only the Asker can do that.');
      if (typeof payload !== 'string' || !inGame(state, payload)) return fail('Pick a player who was named.');
      state.namedId = payload;
      resolveAnswer(state, ctx);
      return;
    }
    case 'nextRound':
      if (!host) return fail('Only the host can do that.');
      if (state.phase !== 'result') return fail('Finish this round first.');
      state.turnIndex += 1;
      state.round += 1;
      deadlyCard(state, ctx.rng);
      deal(state, ctx);
      return;
    default:
      return fail('Unknown move.');
  }
}

export function addPlayer(state, player) {
  if (inGame(state, player.id)) return;
  state.players.push({ id: player.id, name: player.name, color: player.color });
  state.order.push(player.id);
}

export function removePlayer(state, id, ctx) {
  const wasAsker = state.askerId === id;
  const targetGoneMidRound = state.targetId === id && state.phase !== 'result';
  const idx = state.order.indexOf(id);
  state.players = state.players.filter((p) => p.id !== id);
  if (idx !== -1) {
    state.order.splice(idx, 1);
    if (idx < state.turnIndex) state.turnIndex -= 1;
  }
  if (state.targetId === id) state.targetId = null;
  if (state.namedId === id) state.namedId = null;
  if (!state.order.length) return; // nobody left to run a round
  // The Asker leaving (or the chosen Target leaving before the answer is
  // recorded) voids the round: re-deal to whoever is now up, same round.
  if (state.phase !== 'result' && (wasAsker || targetGoneMidRound)) deal(state, ctx);
}

function resultView(state) {
  if (state.phase !== 'result' || !state.result) return null;
  const r = state.result;
  return {
    targetId: r.targetId,
    namedId: r.namedId,
    revealed: r.revealed,
    question: r.revealed ? r.question : null,
    drinks: r.drinks,
  };
}

function common(state) {
  return {
    phase: state.phase,
    round: state.round,
    rounds: state.options.rounds || 8,
    over: !!state.$over,
    players: ids(state),
    askerId: state.askerId,
    targetId: state.targetId,
    namedId: state.namedId,
    scores: leaderboard(state, ids(state)),
    result: resultView(state),
  };
}

// The question text: only ever in the current Asker's own view, only before
// the result (or, in the result, only once the coin has made it public). A
// round that stays secret drops the question from the Asker's own view too.
export function playerView(state, playerId) {
  const base = common(state);
  if (!inGame(state, playerId)) return { ...base, me: null, watching: true };
  const isAsker = playerId === state.askerId;
  const view = { ...base, me: playerId, isAsker };
  if (isAsker) {
    if (state.phase !== 'result') view.question = state.question;
    else if (state.result && state.result.revealed) view.question = state.result.question;
    else if (state.result && !state.result.revealed) view.wink = true;
  }
  return view;
}

// Public screen: the TV in a room, the shared phone in pass and play. Never
// shows the question before the coin has revealed it.
export function tvView(state) {
  return common(state);
}

export function hostActions(state) {
  if (state.phase === 'result') return [{ type: 'nextRound', label: state.$over ? 'Play another round' : 'Next round', tone: 'primary' }];
  return [];
}

// The Asker's private peek at the question; everything after that (picking
// a target, recording the named answer, the reveal) is public, same shape
// as Imposter's reveal-then-public-vote rhythm.
export function passTurn(state) {
  if (state.phase !== 'ask') return null;
  return state.askerId;
}

export function bot(state, playerId, ctx) {
  if (playerId === null) {
    if (state.mode === 'pass') {
      if (state.phase === 'target') {
        const opts = ids(state).filter((id) => id !== state.askerId);
        if (opts.length) return { type: 'chooseTarget', payload: pick(opts, ctx.rng) };
      }
      if (state.phase === 'answer') return { type: 'recordAnswer', payload: pick(ids(state), ctx.rng) };
    }
    const acts = hostActions(state);
    return acts.length ? { type: pick(acts, ctx.rng).type, payload: null } : null;
  }
  if (!inGame(state, playerId) || playerId !== state.askerId) return null;
  if (state.phase === 'ask') return { type: 'read', payload: null };
  if (state.mode === 'room') {
    if (state.phase === 'target') {
      const opts = ids(state).filter((id) => id !== state.askerId);
      if (opts.length) return { type: 'chooseTarget', payload: pick(opts, ctx.rng) };
    }
    if (state.phase === 'answer') return { type: 'recordAnswer', payload: pick(ids(state), ctx.rng) };
  }
  return null;
}
