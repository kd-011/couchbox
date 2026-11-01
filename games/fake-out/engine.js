// Fake Out: a Fibbage-style bluffing game. Everyone writes a convincing fake
// answer to an obscure true fact, then votes for which answer (among the
// fakes and the real one) they think is true.
// Phases: write -> vote -> result -> (nextRound) write ... -> final.
import {
  shuffle, pick, fail, addScore, leaderboard,
  sip, giveOut, social, isDrinking, isDeadly, shotRoulette, lastPlaceShot, deadlyCard, stat, gameOver,
  startTimer, stopTimer, timerDeadline, teamSip, teamShot, teamLeaderboard,
} from '../_kit/kit.js';

export const meta = {
  id: 'fake-out',
  name: 'Fake Out',
  emoji: '🪤',
  tagline: 'Write a convincing lie, spot the truth.',
  blurb: 'A bluffing game: an obscure true fact is missing its key detail. Everyone invents a fake answer, then the group votes on which one is real.',
  minPlayers: 3,
  maxPlayers: 12,
  order: 90,
  accent: '#4dabf7',
  pitch: 'Write a convincing lie, then spot the real fact',
  minutes: [20, 30],
  vibes: ['bluff', 'brain'],
  modes: ['pass', 'room'],
  teams: true,
  audience: true,
  variants: {
    standard: 'Score 1 for finding the truth, plus 1 for every voter your fake fools.',
    drinking: 'Fooled voters drink 1. A fake that fools nobody costs its author 1.',
    deadly: 'Fool every other player with your fake and the Shot Roulette spins between them. Last place at the end takes a shot.',
  },
  options: [
    { key: 'writeSeconds', label: 'Write time', type: 'stepper', min: 30, max: 90, step: 10, default: 60, suffix: 's' },
    { key: 'rounds', label: 'Rounds', type: 'stepper', min: 3, max: 10, step: 1, default: 6 },
  ],
  howto: [
    'Read the true fact. Its key detail is blanked out.',
    'Write a fake answer that sounds true enough to fool everyone.',
    'Vote for the real one. Finding it and fooling others both score.',
  ],
};

// Curated packs (games/fake-out/packs/) need no code here; this only names one
// item in the pack picker.
export const curated = { itemLabel: 'question' };

const ids = (state) => state.players.map((p) => p.id);
const inGame = (state, id) => state.players.some((p) => p.id === id);

// Lowercase, strip accents and punctuation, collapse whitespace, so a fake
// that is just "the truth with different capitalisation/punctuation" is
// caught even though the literal strings differ.
function norm(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function deal(state, ctx) {
  const pool = ctx.content.prompts;
  const unused = pool.filter((p) => !state.used.includes(p.id));
  const prompt = pick(unused.length ? unused : pool, ctx.rng);
  state.used = [...state.used.slice(-180), prompt.id];
  // Late joiners are dealt in from the next round, like Imposter.
  for (const id of state.waiting) if (!state.players.some((p) => p.id === id)) {
    const p = ctx.players.find((x) => x.id === id);
    if (p) state.players.push({ id: p.id, name: p.name, color: p.color });
  }
  state.waiting = [];
  state.prompt = { id: prompt.id, text: prompt.text, answer: prompt.answer };
  state.fakes = {};
  state.voteOptions = null;
  state.votes = {};
  state.audienceVotes = {};
  state.result = null;
  state.final = null;
  state.phase = 'write';
  startTimer(state, state.options.writeSeconds * 1000, ctx.now, 'writeTimeUp');
}

export function init(ctx) {
  const state = {
    phase: 'write',
    round: 1,
    players: ctx.players.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    waiting: [],
    used: [],
    scores: {},
    mode: ctx.mode,
    variant: ctx.variant,
    options: ctx.options,
    // Unique per game, for the client's once-only effects (confetti).
    gameKey: String(ctx.now),
  };
  deal(state, ctx);
  return state;
}

function startVote(state, ctx) {
  stopTimer(state);
  const entries = [{ text: state.prompt.answer, truth: true, authorId: null }];
  for (const [authorId, text] of Object.entries(state.fakes)) entries.push({ text, truth: false, authorId });
  const shuffled = shuffle(entries, ctx.rng);
  state.voteOptions = shuffled.map((e, i) => ({ id: `o${i}`, ...e }));
  state.votes = {};
  state.phase = 'vote';
}

// The author whose fake fooled every other player this round (at least two
// of them), or null. That is the Deadly moment: a perfect fake.
function perfectFake(state) {
  for (const opt of state.voteOptions) {
    if (opt.truth || !opt.authorId) continue;
    const others = ids(state).filter((id) => id !== opt.authorId);
    if (others.length >= 2 && others.every((id) => state.votes[id] === opt.id)) return opt;
  }
  return null;
}

function resolve(state, ctx) {
  stopTimer(state);
  const counts = {};
  for (const optionId of Object.values(state.votes)) counts[optionId] = (counts[optionId] || 0) + 1;
  const drinks = [];
  const truthOpt = state.voteOptions.find((o) => o.truth);
  const perfect = isDeadly(state) ? perfectFake(state) : null;
  // Points in every tier (Party Night ranks on them); drinks on top. Votes
  // are public from here on, so the award stats are safe to record now.
  const fooled = [];
  for (const [voter, optionId] of Object.entries(state.votes)) {
    if (optionId === truthOpt.id) {
      addScore(state, voter, 1);
      stat(state, voter, 'sleuth');
    } else {
      const opt = state.voteOptions.find((o) => o.id === optionId);
      if (opt && opt.authorId) { addScore(state, opt.authorId, 1); stat(state, opt.authorId, 'liar'); }
      if (perfect && optionId === perfect.id) fooled.push(voter);
      else drinks.push(sip(state, voter, 1, 'fooled by a decoy'));
    }
  }
  if (perfect) drinks.push(...shotRoulette(state, fooled, 'fooled by a perfect fake', ctx.rng, { title: 'Shot Roulette', sub: 'A perfect fake' }));
  if (isDrinking(state)) {
    for (const opt of state.voteOptions) {
      if (opt.truth || !opt.authorId) continue;
      if (!(counts[opt.id] > 0)) drinks.push(sip(state, opt.authorId, 1, 'nobody bought it'));
    }
  }
  // The crowd votes too, just for themselves: fooled, they drink; nobody
  // else's score or fake is affected by it.
  for (const [voter, optionId] of Object.entries(state.audienceVotes)) {
    if (optionId !== truthOpt.id) drinks.push(sip(state, voter, 1, 'fooled too'));
  }
  state.result = {
    prompt: state.prompt,
    voteOptions: state.voteOptions,
    votes: state.votes,
    perfectBy: perfect ? perfect.authorId : null,
    drinks: drinks.filter(Boolean),
  };
  state.phase = 'result';
}

// Teams drink together at the end: the losing team shares the shot, not
// just whoever's individual score was lowest. Scoring stays per player
// (the Party Night board needs real player ids), only the final drink
// changes shape when the host has split the room into teams.
function finishDrinks(state, ctx, board) {
  if (!isDrinking(state) || board.length < 2) return [];
  if (state.teams) {
    const tb = teamLeaderboard(state, state.teams);
    if (tb.length < 2) return [];
    const low = tb[tb.length - 1].score;
    const high = tb[0].score;
    if (high === low) return [social(state, 1, 'all tied')].filter(Boolean);
    const drinks = [];
    for (const row of tb) {
      const team = state.teams.find((t) => t.id === row.id);
      if (row.score === low) drinks.push(...(isDeadly(state) ? teamShot(state, team, 'lowest team') : teamSip(state, team, 2, 'lowest team')));
      if (row.score === high) for (const id of team.memberIds) drinks.push(giveOut(state, id, 2, 'top team'));
    }
    return drinks.filter(Boolean);
  }
  const low = board[board.length - 1].score;
  const high = board[0].score;
  if (high === low) return [social(state, 1, 'all tied')].filter(Boolean);
  const drinks = [];
  if (isDeadly(state)) drinks.push(...lastPlaceShot(state, board, 'last place', ctx.rng));
  else for (const r of board) if (r.score === low) drinks.push(sip(state, r.id, 2, 'lowest score'));
  for (const r of board) if (r.score === high) drinks.push(giveOut(state, r.id, 2, 'top score'));
  return drinks.filter(Boolean);
}

function finish(state, ctx) {
  const board = leaderboard(state, ids(state));
  state.final = {
    board,
    teamBoard: state.teams ? teamLeaderboard(state, state.teams) : null,
    drinks: finishDrinks(state, ctx, board),
  };
  state.phase = 'final';
  gameOver(state, board);
}

export function act(state, a, ctx) {
  const { type, payload, from, host } = a;
  switch (type) {
    case 'write': {
      if (state.phase !== 'write') return fail('Writing is closed for this round.');
      if (!inGame(state, from)) return fail('You are not in this round.');
      if (!payload || typeof payload.text !== 'string') return fail('Write something first.');
      const text = payload.text.trim().slice(0, 60);
      if (!text) return fail('Write something first.');
      if (norm(text) === norm(state.prompt.answer)) return fail('Too close to the truth. Write something else.');
      // Two identical fakes would show twice on the vote screen.
      if (Object.entries(state.fakes).some(([id, f]) => id !== from && norm(f) === norm(text))) return fail('Someone already wrote that one. Try another.');
      state.fakes[from] = text;
      if (ids(state).every((id) => state.fakes[id] !== undefined)) startVote(state, ctx);
      return;
    }
    case 'writeTimeUp':
      if (!a.system) return fail('Only the clock can do that.');
      if (state.phase === 'write') startVote(state, ctx);
      return;
    case 'forceVote':
      if (!host) return fail('Only the host can do that.');
      if (state.phase !== 'write') return fail('Not writing right now.');
      startVote(state, ctx);
      return;
    case 'vote': {
      if (state.phase !== 'vote') return fail('Voting is not open.');
      if (!inGame(state, from)) return fail('You are not in this round.');
      if (typeof payload !== 'string') return fail('Pick an answer.');
      const opt = state.voteOptions.find((o) => o.id === payload);
      if (!opt) return fail('Pick a valid answer.');
      if (opt.authorId === from) return fail('You cannot vote for your own fake.');
      state.votes[from] = payload;
      if (ids(state).every((id) => state.votes[id] !== undefined)) resolve(state, ctx);
      return;
    }
    case 'audienceVote': {
      if (state.phase !== 'vote') return fail('Voting is not open.');
      if (!(state.audience || []).includes(from)) return fail('Only the crowd can do that.');
      const opt = state.voteOptions.find((o) => o.id === payload);
      if (!opt) return fail('Pick a valid answer.');
      state.audienceVotes[from] = payload;
      return;
    }
    case 'closeVote':
      if (!host) return fail('Only the host can do that.');
      if (state.phase !== 'vote') return fail('Voting is not open.');
      resolve(state, ctx);
      return;
    case 'nextRound':
      if (!host) return fail('Only the host can do that.');
      if (state.phase !== 'result') return fail('Finish this round first.');
      if (state.round >= state.options.rounds) { finish(state, ctx); return; }
      state.round += 1;
      deadlyCard(state, ctx.rng);
      deal(state, ctx);
      return;
    case 'playAgain':
      if (!host) return fail('Only the host can do that.');
      if (state.phase !== 'final') return fail('The game is still going.');
      state.round = 1;
      state.scores = {};
      state.gameKey = String(ctx.now);
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
  state.players = state.players.filter((p) => p.id !== id);
  state.waiting = state.waiting.filter((x) => x !== id);
  delete state.fakes[id];
  delete state.votes[id];
  delete state.audienceVotes[id];
  if (state.phase === 'result' || state.phase === 'final') return;
  if (state.players.length < 1) return;
  if (state.phase === 'write' && ids(state).every((x) => state.fakes[x] !== undefined)) {
    startVote(state, ctx);
  } else if (state.phase === 'vote') {
    // Remove any vote that pointed at the departed player's fake, and
    // resolve straight away if everyone left now has voted.
    for (const [voter, optionId] of Object.entries(state.votes)) {
      const opt = state.voteOptions.find((o) => o.id === optionId);
      if (opt && opt.authorId === id) delete state.votes[voter];
    }
    if (ids(state).length && ids(state).every((x) => state.votes[x] !== undefined)) resolve(state, ctx);
  }
}

function publicOptions(state) {
  return state.voteOptions ? state.voteOptions.map((o) => ({ id: o.id, text: o.text })) : null;
}

function common(state) {
  return {
    phase: state.phase,
    round: state.round,
    roundsTotal: state.options.rounds,
    players: ids(state),
    waiting: state.waiting,
    timer: state.timer || null,
    promptText: state.prompt.text,
    writtenCount: Object.keys(state.fakes).length,
    votedCount: Object.keys(state.votes).length,
    // Who still has to write (write phase) or vote (vote phase). Only who,
    // never what they wrote or picked.
    pending: state.phase === 'write' ? ids(state).filter((id) => state.fakes[id] === undefined)
      : state.phase === 'vote' ? ids(state).filter((id) => state.votes[id] === undefined) : [],
    totalPlayers: ids(state).length,
    lastRound: state.round >= state.options.rounds,
    scores: leaderboard(state, ids(state)),
    audienceCount: (state.audience || []).length,
    teams: state.teams,
    gameKey: state.gameKey || '',
  };
}

function resultView(state) {
  if (state.phase !== 'result' || !state.result) return null;
  return {
    answer: state.result.prompt.answer,
    voteOptions: state.result.voteOptions,
    votes: state.result.votes,
    perfectBy: state.result.perfectBy || null,
    drinks: state.result.drinks,
  };
}

export function playerView(state, playerId) {
  const base = common(state);
  if (!inGame(state, playerId)) {
    const audience = (state.audience || []).includes(playerId);
    const view = { ...base, me: null, final: state.final || null, audience };
    if (audience && state.phase === 'vote') {
      view.options = publicOptions(state);
      view.myVote = state.audienceVotes[playerId] || null;
    }
    // The reveal is public (the TV shows it): the crowd and late joiners see
    // it too, and the crowd sees whether their own pick was right.
    if (state.phase === 'result') {
      view.result = resultView(state);
      if (audience) view.myVote = state.audienceVotes[playerId] || null;
    }
    return view;
  }
  const view = { ...base, me: playerId, final: state.final || null };
  if (state.phase === 'write') {
    view.myFake = state.fakes[playerId] !== undefined ? state.fakes[playerId] : null;
  }
  if (state.phase === 'vote') {
    view.options = publicOptions(state);
    view.myVote = state.votes[playerId] || null;
    view.myFakeText = state.fakes[playerId] !== undefined ? state.fakes[playerId] : null;
  }
  if (state.phase === 'result') {
    view.result = resultView(state);
  }
  return view;
}

export function tvView(state) {
  const base = common(state);
  const view = { ...base, final: state.final || null };
  if (state.phase === 'vote') view.options = publicOptions(state);
  if (state.phase === 'result') view.result = resultView(state);
  return view;
}

export function hostActions(state) {
  switch (state.phase) {
    case 'write':
      return state.mode === 'room'
        ? [{ type: 'forceVote', label: 'Start voting now', tone: 'secondary', confirm: 'Move to voting? Anyone who has not written loses their fake this round.' }]
        : [];
    case 'vote':
      return [{ type: 'closeVote', label: 'Close voting', tone: 'secondary', confirm: 'Count the votes now?' }];
    case 'result':
      return [{ type: 'nextRound', label: state.round >= state.options.rounds ? 'See the results' : 'Next round', tone: 'primary' }];
    case 'final':
      return [{ type: 'playAgain', label: 'Play again', tone: 'primary' }];
    default:
      return [];
  }
}

// One phone: each player writes their fake privately, then each voter casts
// their vote privately too (so nobody sees either secret). Returns null once
// nobody still needs a private turn, handing the shared screen back.
export function passTurn(state) {
  if (state.phase === 'write') return ids(state).find((id) => state.fakes[id] === undefined) || null;
  if (state.phase === 'vote') return ids(state).find((id) => state.votes[id] === undefined) || null;
  return null;
}

// A random legal move for this player, or one for the host/shared screen
// when playerId is null. Drives test/contract.test.mjs and the e2e bots.
export function bot(state, playerId, ctx) {
  if (playerId === null) {
    const acts = hostActions(state);
    return acts.length ? { type: pick(acts, ctx.rng).type, payload: null } : null;
  }
  if (!inGame(state, playerId)) {
    if ((state.audience || []).includes(playerId) && state.phase === 'vote' && state.audienceVotes[playerId] === undefined) {
      return { type: 'audienceVote', payload: pick(state.voteOptions, ctx.rng).id };
    }
    return null;
  }
  if (state.phase === 'write' && state.fakes[playerId] === undefined) {
    return { type: 'write', payload: { text: `A made-up answer ${Math.floor(ctx.rng() * 100000)}` } };
  }
  if (state.phase === 'vote' && state.votes[playerId] === undefined) {
    const choices = state.voteOptions.filter((o) => o.authorId !== playerId);
    if (!choices.length) return null;
    return { type: 'vote', payload: pick(choices, ctx.rng).id };
  }
  return null;
}
