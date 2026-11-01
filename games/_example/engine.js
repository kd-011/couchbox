// High Card: the minimal example game from docs/GAME-MODULES.md.
// Everyone is dealt a secret card, looks at it privately, then the host
// flips them all. Highest card wins the round. Not listed on the site
// (folders starting with '_' are skipped); test/contract.test.mjs plays it.
import {
  shuffle, fail, sip, shot, isDeadly, deadlyCard, gameOver, addScore, leaderboard, startTimer, stopTimer, timerDeadline,
} from '../_kit/kit.js';

export const meta = {
  id: '_example',
  name: 'High Card',
  emoji: '🃏',
  tagline: 'Highest secret card wins.',
  minPlayers: 2,
  maxPlayers: 12,
  modes: ['pass', 'room'],
  variants: {
    standard: 'Highest card scores a point.',
    drinking: 'Lowest card drinks 2.',
    deadly: 'Lowest card takes a shot.',
  },
  options: [
    { key: 'seconds', label: 'Look time', type: 'stepper', min: 5, max: 60, step: 5, default: 15, suffix: 's' },
  ],
};

const ids = (s) => s.players.map((p) => p.id);

function deal(state, ctx) {
  const deck = shuffle(ctx.content.cards, ctx.rng);
  state.cards = Object.fromEntries(ids(state).map((id, i) => [id, deck[i % deck.length]]));
  state.looked = {};
  state.result = null;
  state.phase = 'look';
  startTimer(state, state.options.seconds * 1000, ctx.now, 'flip');
}

export function init(ctx) {
  const state = { players: ctx.players, scores: {}, round: 1, mode: ctx.mode, variant: ctx.variant, options: ctx.options };
  deal(state, ctx);
  return state;
}

function flip(state) {
  stopTimer(state);
  const values = ids(state).map((id) => [id, state.cards[id].value]).sort((a, b) => b[1] - a[1]);
  const [hiId] = values[0];
  const [loId] = values[values.length - 1];
  addScore(state, hiId, 1); // score in every tier: Party Night ranks on it
  const d = isDeadly(state) ? shot(state, loId, 'lowest card') : sip(state, loId, 2, 'lowest card');
  state.result = { winner: hiId, drinks: [d] };
  state.phase = 'flip';
  if (state.scores[hiId] >= 3) gameOver(state); // first to 3
}

export function act(state, a, ctx) {
  switch (a.type) {
    case 'looked':
      if (state.phase !== 'look') return fail('Too late, the cards are flipped.');
      if (!state.cards[a.from]) return fail('You are not in this round.');
      state.looked[a.from] = true;
      return;
    case 'flip':
      if (!a.host && !a.system) return fail('Only the host can flip.');
      if (state.phase !== 'look') return fail('Already flipped.');
      flip(state);
      return;
    case 'next':
      if (!a.host) return fail('Only the host can deal.');
      if (state.phase !== 'flip') return fail('Flip first.');
      state.round += 1;
      deadlyCard(state, ctx.rng);
      deal(state, ctx);
      return;
    default:
      return fail('Unknown move.');
  }
}

export const deadline = timerDeadline;

export function playerView(state, playerId) {
  const mine = state.cards[playerId];
  return {
    phase: state.phase,
    round: state.round,
    timer: state.timer,
    me: mine ? playerId : null,
    myCard: mine || null, // only this player's card, never anyone else's
    looked: Object.keys(state.looked),
    players: ids(state),
    reveal: state.phase === 'flip' ? { cards: state.cards, ...state.result } : null,
    scores: leaderboard(state, ids(state)),
  };
}

export function tvView(state) {
  return {
    phase: state.phase,
    round: state.round,
    timer: state.timer,
    looked: Object.keys(state.looked),
    players: ids(state),
    reveal: state.phase === 'flip' ? { cards: state.cards, ...state.result } : null,
    scores: leaderboard(state, ids(state)),
  };
}

export function hostActions(state) {
  if (state.phase === 'look') return [{ type: 'flip', label: 'Flip the cards', tone: 'primary' }];
  return [{ type: 'next', label: 'Deal again', tone: 'primary' }];
}

// One phone: each player peeks privately in turn, then the shared screen.
export function passTurn(state) {
  if (state.phase !== 'look') return null;
  return ids(state).find((id) => !state.looked[id]) || null;
}

export function bot(state, playerId) {
  if (playerId === null) return hostActions(state)[0];
  if (state.phase === 'look' && state.cards[playerId] && !state.looked[playerId]) return { type: 'looked' };
  return null;
}
