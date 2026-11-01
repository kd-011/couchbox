// Imposter: everyone gets the secret word except the imposter(s).
// Phases: reveal -> discuss -> vote -> result -> (nextRound) reveal ...
import {
  shuffle, pick, clamp, fail, addScore, leaderboard,
  sip, shot, giveOut, isDeadly, deadlyCard, stat, gameOver,
  startTimer, pauseTimer, resumeTimer, addTime, stopTimer, timerDeadline,
} from '../_kit/kit.js';

const CATEGORY_CHOICES = [
  ['random', 'Random'], ['movies', 'Movies'], ['celebrities', 'Famous people'], ['animals', 'Animals'],
  ['jobs', 'Jobs'], ['places', 'Places'], ['food', 'Food and drink'], ['sports', 'Sports'], ['things', 'Household things'],
  ['brands', 'Brands'], ['countries', 'Countries'], ['vehicles', 'Vehicles'],
];

export { CATEGORY_CHOICES };

export const meta = {
  id: 'imposter',
  name: 'Imposter',
  emoji: '🕵️',
  tagline: 'Everyone gets the secret word except the imposter. Sniff them out.',
  blurb: 'A social deduction game: give one-word clues about a secret word without giving it away, then vote out the player who is bluffing.',
  minPlayers: 3,
  maxPlayers: 16,
  order: 10,
  accent: '#ff5d73',
  pitch: "Find the one player who doesn't know the word",
  minutes: [10, 20],
  vibes: ['bluff'],
  modes: ['pass', 'room'],
  howto: [
    'Everyone but the imposter gets the secret word',
    'Say one word each that proves you know it, without giving it away',
    'Vote out who you think is faking it',
  ],
  variants: {
    standard: 'Crew score 1 for catching the imposter, imposters score 2 for getting away with it.',
    drinking: 'Caught imposters drink 3. Get away with it and the crew drink 2. Bad votes cost a sip.',
    deadly: 'The imposter voted out takes a shot. Get away with it and the crew drink 2.',
  },
  options: [
    {
      key: 'imposters', label: 'Imposters', type: 'choice', default: 'auto',
      choices: [{ value: 'auto', label: 'Auto' }, { value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }],
      help: 'Auto picks 2 imposters from 8 players up.',
    },
    {
      key: 'category', label: 'Category', type: 'choice', default: 'random',
      choices: CATEGORY_CHOICES.map(([value, label]) => ({ value, label })),
    },
    { key: 'minutes', label: 'Discussion', type: 'stepper', min: 1, max: 10, step: 1, default: 3, suffix: ' min' },
    { key: 'rounds', label: 'Rounds', type: 'stepper', min: 1, max: 12, step: 1, default: 5 },
  ],
};

// A custom pack is one or more secret-word categories of its own; loading
// one replaces the built-in categories entirely (the "Category" option
// above still works, it just only ever finds the pack's own categories).
export const pack = {
  label: 'Secret words',
  itemLabel: 'word',
  fields: [
    { key: 'category', label: 'Category', type: 'text', maxLength: 24, optional: true, placeholder: 'e.g. Inside jokes' },
    { key: 'word', label: 'Word', type: 'text', maxLength: 40, placeholder: 'e.g. Titanic' },
  ],
  minItems: 6,
  maxItems: 200,
  aiHint: 'This is Imposter: everyone except the imposter(s) secretly knows a word, and gives one-word clues about it without saying it outright. Invent secret words that fit the theme, loosely grouped into 2-5 short category names (or leave the category blank and call it one group).',
  apply(content, items, title) {
    const byCat = {};
    for (const it of items) {
      const key = (it.category || 'custom').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'custom';
      if (!byCat[key]) byCat[key] = { label: it.category || title || 'Custom', items: [] };
      byCat[key].items.push(it.word);
    }
    return { categories: byCat };
  },
};

function imposterCount(n, choice) {
  const max = clamp(Math.floor(n / 2) - 1, 1, 3);
  const want = choice === 'auto' ? (n >= 8 ? 2 : 1) : Number(choice) || 1;
  return clamp(want, 1, max);
}

function deal(state, ctx) {
  const cats = ctx.content.categories;
  const key = state.options.category === 'random' || !cats[state.options.category]
    ? pick(Object.keys(cats), ctx.rng)
    : state.options.category;
  const cat = cats[key];
  const unused = cat.items.filter((w) => !state.used.includes(w));
  const word = pick(unused.length ? unused : cat.items, ctx.rng);
  state.used = [...state.used.slice(-60), word];
  // Late joiners are dealt in from the next round.
  for (const id of state.waiting) if (!state.players.some((p) => p.id === id)) {
    const p = ctx.players.find((x) => x.id === id);
    if (p) state.players.push({ id: p.id, name: p.name, color: p.color });
  }
  state.waiting = [];
  const ids = state.players.map((p) => p.id);
  state.category = { key, label: cat.label };
  state.word = word;
  state.imposters = shuffle(ids, ctx.rng).slice(0, imposterCount(ids.length, state.options.imposters));
  state.firstSpeaker = pick(ids, ctx.rng);
  state.seen = {};
  state.votes = {};
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
  };
  deal(state, ctx);
  return state;
}

const ids = (state) => state.players.map((p) => p.id);
const inGame = (state, id) => state.players.some((p) => p.id === id);

function startDiscuss(state, now) {
  state.phase = 'discuss';
  startTimer(state, state.options.minutes * 60_000, now, 'timeUp');
}

function startVote(state) {
  state.phase = 'vote';
  stopTimer(state);
  state.votes = {};
}

function resolve(state, accused) {
  const crewWin = !!accused && state.imposters.includes(accused);
  const crew = ids(state).filter((id) => !state.imposters.includes(id));
  // Points in every tier (Party Night ranks on them); drinks on top.
  const drinks = [];
  if (crewWin) {
    for (const id of crew) addScore(state, id, 1);
    for (const id of state.imposters) {
      if (id === accused && isDeadly(state)) drinks.push(shot(state, id, 'caught'));
      else drinks.push(sip(state, id, 3, accused === id ? 'caught' : 'your partner got caught'));
    }
  } else {
    for (const id of state.imposters) { addScore(state, id, 2); stat(state, id, 'liar'); }
    for (const id of crew) drinks.push(sip(state, id, 2, 'the imposter got away'));
  }
  for (const [voter, target] of Object.entries(state.votes)) {
    if (state.imposters.includes(voter)) continue;
    if (state.imposters.includes(target)) stat(state, voter, 'sleuth');
    else drinks.push(sip(state, voter, 1, 'voted for an innocent'));
  }
  if (accused && !state.imposters.includes(accused)) drinks.push(giveOut(state, accused, 2, 'wrongly accused'));
  state.result = { accused: accused || null, crewWin, drinks: drinks.filter(Boolean) };
  state.phase = 'result';
  stopTimer(state);
  // The last round ends the game (play on and the board keeps up).
  if (state.round >= (state.options.rounds || 5)) gameOver(state);
}

function tally(votes) {
  const counts = {};
  for (const t of Object.values(votes)) counts[t] = (counts[t] || 0) + 1;
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!sorted.length || (sorted[1] && sorted[1][1] === sorted[0][1])) return null; // tie: nobody out
  return sorted[0][0];
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
    case 'vote': {
      if (state.phase !== 'vote') return fail('Voting is not open.');
      if (state.mode !== 'room') return fail('On one phone the host records the vote.');
      if (!inGame(state, from)) return fail('You are not in this round.');
      if (payload === from) return fail('You cannot vote for yourself.');
      if (!inGame(state, payload)) return fail('Pick a player in this round.');
      state.votes[from] = payload;
      if (ids(state).every((id) => state.votes[id])) resolve(state, tally(state.votes));
      return;
    }
    case 'closeVote':
      if (!host) return fail('Only the host can do that.');
      if (state.phase !== 'vote') return fail('Voting is not open.');
      resolve(state, tally(state.votes));
      return;
    case 'accuse':
      // One phone: the group votes out loud, the host taps who went out.
      if (!host) return fail('Only the host can do that.');
      if (state.phase !== 'vote') return fail('Voting is not open.');
      if (payload !== null && !inGame(state, payload)) return fail('Pick a player in this round.');
      resolve(state, payload);
      return;
    case 'nextRound':
      if (!host) return fail('Only the host can do that.');
      if (state.phase !== 'result') return fail('Finish this round first.');
      state.round += 1;
      deadlyCard(state, ctx.rng);
      deal(state, ctx);
      return;
    default:
      return fail('Unknown move.');
  }
}

export function deadline(state) {
  return timerDeadline(state);
}

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
  state.imposters = state.imposters.filter((x) => x !== id);
  if (state.imposters.length === 0 && state.players.length >= meta.minPlayers) {
    // The last imposter walked out mid-round: the round is void, re-deal.
    state.round += 1;
    deal(state, ctx);
  } else if (state.phase === 'reveal' && ids(state).every((x) => state.seen[x])) {
    startDiscuss(state, ctx.now);
  } else if (state.phase === 'vote' && state.mode === 'room' && ids(state).every((x) => state.votes[x])) {
    resolve(state, tally(state.votes));
  }
}

function common(state) {
  return {
    phase: state.phase,
    round: state.round,
    rounds: state.options.rounds || 5,
    over: !!state.$over,
    players: ids(state),
    waiting: state.waiting,
    category: state.category.label,
    firstSpeaker: state.firstSpeaker,
    impostersCount: state.imposters.length,
    timer: state.timer || null,
    scores: leaderboard(state, ids(state)),
    seen: ids(state).filter((id) => state.seen[id]),
    voted: ids(state).filter((id) => state.votes[id]),
  };
}

function resultView(state) {
  if (state.phase !== 'result') return null;
  return {
    word: state.word,
    imposters: state.imposters,
    votes: state.votes,
    ...state.result,
  };
}

export function playerView(state, playerId) {
  const base = common(state);
  // Watchers and late joiners see the result once it is public (the TV
  // shows the same thing), never the card.
  if (!inGame(state, playerId)) return { ...base, me: null, waiting: true, result: resultView(state) };
  const imp = state.imposters.includes(playerId);
  // The card: the only place the secret word or imposter role ever leaves
  // the engine before the result, and only to its owner.
  const card = imp ? { role: 'imposter', category: state.category.label } : { role: 'crew', word: state.word, category: state.category.label };
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
    case 'result':
      return [{ type: 'nextRound', label: 'Next round', tone: 'primary' }];
    default:
      return [];
  }
}

export function passTurn(state) {
  if (state.phase === 'reveal') return ids(state).find((id) => !state.seen[id]) || null;
  return null;
}

// A random legal move for this player (null = the host/shared screen).
// Drives test/contract.test.mjs and the e2e bots; never used in real play.
export function bot(state, playerId, ctx) {
  if (playerId === null) {
    if (state.phase === 'vote' && state.mode === 'pass') {
      return { type: 'accuse', payload: ctx.rng() < 0.2 ? null : pick(ids(state), ctx.rng) };
    }
    const acts = hostActions(state);
    return acts.length ? { type: pick(acts, ctx.rng).type, payload: null } : null;
  }
  if (!inGame(state, playerId)) return null;
  if (state.phase === 'reveal' && !state.seen[playerId]) return { type: 'seen', payload: null };
  if (state.phase === 'vote' && state.mode === 'room' && !state.votes[playerId]) {
    return { type: 'vote', payload: pick(ids(state).filter((id) => id !== playerId), ctx.rng) };
  }
  return null;
}
