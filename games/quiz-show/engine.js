// Quiz Show: a TV quiz night. Host picks tiles off a board (category x
// round type); rounds are multiple choice, a buzzer race, an emoji/picture
// round or true-or-false, each against a timer with speed scoring; after
// every round a dramatic reveal then a leaderboard; the board ends in a
// final wager. Pass-and-play plays it as a quizmaster-reads-aloud show with
// two teams; own phones let everyone answer from their own screen.
// Phases: teams(pass only) -> board -> question|buzzer -> reveal ->
// leaderboard -> (board again or) wager-bid -> wager-question -> final.
import {
  shuffle, pick, clamp, fail, addScore, leaderboard, startTimer, stopTimer, timerDeadline,
  sip, shot, isDrinking, isDeadly, deadlyMoment, lastPlaceShot, deadlyCard, stat, gameOver, teamOf,
} from '../_kit/kit.js';

const CATEGORY_CHOICES = [
  ['general', 'General Knowledge'], ['film', 'Movies'], ['music', 'Music'], ['tv', 'Television'],
  ['videogames', 'Video Games'], ['science', 'Science & Nature'], ['computers', 'Computers & Tech'],
  ['sport', 'Sport'], ['geography', 'Geography'], ['history', 'History'], ['animals', 'Animals'], ['books', 'Books'],
];

export const meta = {
  id: 'quiz-show',
  name: 'Quiz Show',
  emoji: '🎤',
  tagline: 'A full TV quiz night: a board, a buzzer and a final wager.',
  blurb: 'Pick tiles off a quiz board, race the buzzer, guess the emoji round and wager it all in the final, with a live leaderboard between every round.',
  minPlayers: 2,
  maxPlayers: 12,
  order: 40,
  accent: '#5b8cff',
  pitch: 'A TV quiz night with a board and a final wager',
  minutes: [30, 45],
  vibes: ['brain'],
  modes: ['pass', 'room'],
  teams: true,
  audience: true,
  howto: [
    'Pick a tile off the board: a category and a round type',
    'Answer fast against the clock, or buzz in first on a buzzer round',
    'When the board is empty, wager your points on one last question',
  ],
  variants: {
    standard: 'Points for speed and accuracy. Biggest score after the final wager wins.',
    drinking: 'Wrong answers sip 1, last place each round drinks, and the final wager can cost you big.',
    deadly: 'Three right in a row puts you on Double or Nothing: next one right scores double, wrong is a shot. Last place after the final takes a shot.',
  },
  options: [
    {
      key: 'length', label: 'Rounds', type: 'choice', default: 'standard',
      choices: [{ value: 'quick', label: 'Quick (6)' }, { value: 'standard', label: 'Standard (9)' }, { value: 'full', label: 'Full (12)' }],
    },
    {
      key: 'categories', label: 'Categories', type: 'multi', default: CATEGORY_CHOICES.map(([v]) => v),
      choices: CATEGORY_CHOICES.map(([value, label]) => ({ value, label })),
    },
  ],
};

// Curated packs (games/quiz-show/packs/) need no code here; this only names one
// item in the pack picker.
export const curated = { itemLabel: 'question' };

const TILES = { quick: 6, standard: 9, full: 12 };
const ROUND_TYPES = ['multiple', 'buzzer', 'truefalse', 'emoji'];
const TIMER_MS = { multiple: 15_000, truefalse: 7_000, emoji: 15_000 };
const TEAM_COLORS = ['#5b8cff', '#ff5d73'];

const contestantIds = (state) => state.contestants.map((c) => c.id);
const inContestants = (state, id) => state.contestants.some((c) => c.id === id);
// Which contestant a player answers for: their own id solo, or their
// team's id once the host has split the room into teams (state.teamsOn).
const contestantOf = (state, playerId) => (state.contestants.find((c) => c.memberIds.includes(playerId)) || {}).id;

/* ---------- drinks, stats and Double or Nothing ----------
   Contestants are players in a room but TEAMS in pass and play, and the
   drink ledger and the awards count people. So every drink or stat for a
   contestant goes to each of its members. */

const DOUBLE_AT = 3; // right answers in a row that put you on Double or Nothing

function membersOf(state, cid) {
  const c = state.contestants.find((x) => x.id === cid);
  return c ? c.memberIds.filter((id) => state.players.some((p) => p.id === id)) : [];
}
const sipTeam = (state, cid, n, why) => membersOf(state, cid).map((id) => sip(state, id, n, why)).filter(Boolean);
const shotTeam = (state, cid, why) => membersOf(state, cid).map((id) => shot(state, id, why)).filter(Boolean);
function statTeam(state, cid, key) {
  for (const id of membersOf(state, cid)) stat(state, id, key);
}
function streaksOf(state) {
  if (!state.streaks) state.streaks = {};
  return state.streaks;
}
const onDouble = (state, cid) => isDeadly(state) && (streaksOf(state)[cid] || 0) >= DOUBLE_AT;

// Score one answered question for a contestant and keep their streak. On
// Double or Nothing (Deadly only) a right answer scores double and a wrong
// one is a shot for every member; either way the streak starts again.
function judge(state, cid, correct, pts, why) {
  const s = streaksOf(state);
  const r = state.round;
  if (onDouble(state, cid)) {
    s[cid] = 0;
    if (correct) {
      pts *= 2;
      (r.doubled ||= []).push(cid);
    } else {
      const shots = shotTeam(state, cid, 'wrong on Double or Nothing');
      r.drinks.push(...shots);
      if (shots.length) (r.donShots ||= []).push(cid);
    }
  } else if (correct) {
    s[cid] = (s[cid] || 0) + 1;
  } else {
    s[cid] = 0;
    r.drinks.push(...sipTeam(state, cid, 1, why));
  }
  if (correct) {
    addScore(state, cid, pts);
    statTeam(state, cid, 'quiz');
  }
  r.scoreDelta[cid] = correct ? pts : 0;
}

// One takeover per action for everyone caught wrong on Double or Nothing.
function doubleMoment(state, before) {
  if ((state.round.donShots || []).length > before) {
    deadlyMoment(state, { kind: 'streak', title: 'Double or Nothing', sub: 'Three in a row, then wrong: shot' });
  }
}

// Party Night standings rank people: each member gets their team's score.
function playerBoard(state) {
  const rows = [];
  for (const c of state.contestants) for (const id of membersOf(state, c.id)) rows.push({ id, score: state.scores[c.id] || 0 });
  return rows.sort((a, b) => b.score - a.score);
}

// Deadly, after the final: last place takes a shot. Rooms use the kit (a tie
// spins the wheel); a last-place team drinks together, every member a shot.
function lastPlace(state, board, ctx) {
  if (!isDeadly(state) || board.length < 2) return [];
  const why = 'last place after the final';
  // One real player per contestant: the kit's generic helper (board ids are
  // player ids) is fine. A contestant with more than one member (a team, in
  // pass and play or a room split into teams) needs every member fanned out.
  if (state.mode === 'room' && !state.teamsOn) return lastPlaceShot(state, board, why, ctx.rng);
  const low = Math.min(...board.map((r) => r.score));
  if (board.every((r) => r.score === low)) return [];
  const last = board.filter((r) => r.score === low);
  const team = last[Math.floor(ctx.rng() * last.length)];
  const shots = shotTeam(state, team.id, why);
  const c = state.contestants.find((x) => x.id === team.id);
  if (shots.length) deadlyMoment(state, { kind: 'last', title: 'Last Place', sub: `${c ? c.name : 'The last team'} finished last: every member takes a shot` });
  return shots;
}

/* ---------- content pools ---------- */

function poolFor(content, categoryKey, type) {
  if (type === 'emoji') return content.emoji || [];
  const cat = content.categories[categoryKey];
  if (!cat) return [];
  return type === 'truefalse' ? cat.boolean : cat.multiple; // 'multiple' and 'buzzer' share the pool
}

// The categories in play: the host's picks that exist in the deck, else
// every category in it. A curated pack brings its own categories, so the
// picks (built-in keys) may match none of them: then the whole pack plays.
function activeCategories(state, ctx) {
  const all = Object.keys(ctx.content.categories);
  const picked = state.options.categories.filter((k) => ctx.content.categories[k]);
  return picked.length ? picked : all;
}

function wagerPool(state, ctx) {
  const keys = activeCategories(state, ctx);
  const hard = keys.flatMap((k) => (ctx.content.categories[k]?.multiple || []).filter((q) => q.difficulty === 'hard'));
  return hard.length ? hard : keys.flatMap((k) => ctx.content.categories[k]?.multiple || []);
}

function drawQuestion(state, ctx, categoryKey, type) {
  const pool = type === 'wager' ? wagerPool(state, ctx) : poolFor(ctx.content, categoryKey, type);
  if (!pool.length) return null;
  const fresh = pool.filter((q) => !state.usedIds.includes(q.id));
  const chosen = fresh.length ? pick(fresh, ctx.rng) : pick(pool, ctx.rng);
  if (chosen) state.usedIds.push(chosen.id);
  return chosen;
}

/* ---------- teams (pass and play) ---------- */

function autoTeams(state, ctx) {
  const shuffled = shuffle(state.players.map((p) => p.id), ctx.rng);
  const teams = [0, 1].map((i) => ({ id: `team-${i + 1}`, name: `Team ${i + 1}`, color: TEAM_COLORS[i], memberIds: [] }));
  shuffled.forEach((id, i) => teams[i % 2].memberIds.push(id));
  state.contestants = teams.filter((t) => t.memberIds.length);
}

/* ---------- the board ---------- */

function buildBoard(state, ctx) {
  const n = TILES[state.options.length] || 9;
  const cats = activeCategories(state, ctx);
  const types = shuffle(Array.from({ length: n }, (_, i) => ROUND_TYPES[i % ROUND_TYPES.length]), ctx.rng);
  const shuffledCats = shuffle(cats, ctx.rng);
  state.board = types.map((type, i) => {
    const category = type === 'emoji' ? 'emoji' : shuffledCats[i % shuffledCats.length];
    const label = type === 'emoji' ? 'Emoji & Pictures' : ctx.content.categories[category].label;
    return { id: `t${i}`, category, label, type, used: false };
  });
  state.round = null;
  state.wager = null;
  state.phase = 'board';
}

function startRoundFromTile(state, tile, ctx) {
  const q = drawQuestion(state, ctx, tile.category, tile.type);
  state.round = {
    tile, question: q, type: tile.type, startedAt: ctx.now,
    answers: {}, buzzOrder: [], buzzWrong: [], buzzActive: null, winner: null,
    resolved: false, scoreDelta: {}, drinks: [], doubled: [], donShots: [], audienceBets: {},
  };
  if (tile.type === 'buzzer') {
    state.phase = 'buzzer';
    startTimer(state, 20_000, ctx.now, 'buzzWaitTimeUp');
  } else {
    state.phase = 'question';
    startTimer(state, TIMER_MS[tile.type], ctx.now, 'timeUp');
  }
}

/* ---------- resolving a question round ---------- */

function resolveQuestion(state) {
  stopTimer(state);
  const q = state.round.question;
  const total = TIMER_MS[state.round.type];
  const startedAt = state.round.startedAt;
  const before = (state.round.donShots || []).length;
  for (const cid of contestantIds(state)) {
    const a = state.round.answers[cid];
    if (!a) {
      // No answer: the streak breaks, but Double or Nothing waits for the
      // next question actually answered.
      if (!onDouble(state, cid)) streaksOf(state)[cid] = 0;
      state.round.scoreDelta[cid] = 0;
      state.round.drinks.push(...sipTeam(state, cid, 1, 'no answer'));
      continue;
    }
    const correct = a.choice === q.answer;
    const frac = clamp(1 - (a.at - startedAt) / total, 0, 1);
    judge(state, cid, correct, Math.round(200 + 800 * frac), 'wrong answer');
  }
  doubleMoment(state, before);
  state.phase = 'reveal';
  applyLastPlaceDrink(state);
  settleAudienceBets(state, Object.entries(state.round.scoreDelta).filter(([, d]) => d > 0).map(([cid]) => cid));
}

// Audience members bet on which contestant will score this round. Right,
// nothing happens (bragging rights); wrong, a sip (Drinking/Deadly only).
// Never touches a real contestant's score: watching, not playing.
function settleAudienceBets(state, winners) {
  const bets = state.round.audienceBets;
  if (!bets) return;
  for (const [bettorId, cid] of Object.entries(bets)) {
    if (!winners.includes(cid)) state.round.drinks.push(sip(state, bettorId, 1, 'bad bet'));
  }
}

function maybeAutoResolveQuestion(state, ctx) {
  if (contestantIds(state).every((id) => state.round.answers[id])) resolveQuestion(state);
}

function applyLastPlaceDrink(state) {
  if (!isDrinking(state)) return;
  const board = leaderboard(state, contestantIds(state));
  if (!board.length) return;
  const low = board[board.length - 1].score;
  for (const r of board) if (r.score === low) state.round.drinks.push(...sipTeam(state, r.id, 1, 'last place'));
}

/* ---------- resolving a buzzer round ---------- */

function resolveBuzzCorrect(state, cid) {
  stopTimer(state);
  judge(state, cid, true, 500, '');
  state.round.winner = cid;
  state.round.resolved = true;
  state.phase = 'reveal';
  applyLastPlaceDrink(state);
  settleAudienceBets(state, [cid]);
}

function resolveBuzzNone(state) {
  stopTimer(state);
  state.round.winner = null;
  state.round.resolved = true;
  state.phase = 'reveal';
  applyLastPlaceDrink(state);
  settleAudienceBets(state, []);
}

// A wrong buzz is a wrong answer: the sip (or the Double or Nothing shot)
// pours straight away.
function buzzWrong(state, ctx, cid) {
  state.round.buzzWrong.push(cid);
  state.round.buzzActive = null;
  const before = (state.round.donShots || []).length;
  judge(state, cid, false, 0, 'buzzed wrong');
  doubleMoment(state, before);
  const remaining = contestantIds(state).filter((id) => !state.round.buzzWrong.includes(id));
  if (!remaining.length) resolveBuzzNone(state);
  else startTimer(state, 10_000, ctx.now, 'buzzWaitTimeUp');
}

const normaliseGuess = (s) => String(s || '').toLowerCase().replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9]/g, '');

/* ---------- the final wager ---------- */

function startWager(state) {
  state.round = null;
  state.wager = { bids: {}, question: null, answers: {}, startedAt: 0, drinks: [] };
  state.phase = 'wager-bid';
}

function closeBids(state, ctx) {
  for (const id of contestantIds(state)) if (state.wager.bids[id] === undefined) state.wager.bids[id] = 0;
  state.wager.question = drawQuestion(state, ctx, null, 'wager');
  state.wager.startedAt = ctx.now;
  state.phase = 'wager-question';
  startTimer(state, 20_000, ctx.now, 'wagerTimeUp');
}

function resolveWager(state, ctx) {
  stopTimer(state);
  const q = state.wager.question;
  for (const cid of contestantIds(state)) {
    const choice = state.wager.answers[cid];
    const correct = q && choice === q.answer;
    const bid = state.wager.bids[cid] || 0;
    addScore(state, cid, correct ? bid : -bid);
    if (correct) statTeam(state, cid, 'quiz');
    else if (bid > 0) state.wager.drinks.push(...sipTeam(state, cid, 2, 'lost the wager'));
  }
  state.phase = 'final';
  const board = leaderboard(state, contestantIds(state));
  state.wager.drinks.push(...lastPlace(state, board, ctx));
  state.final = { board, drinks: state.wager.drinks };
  gameOver(state, playerBoard(state));
}

/* ---------- init ---------- */

export function init(ctx) {
  const state = {
    phase: ctx.mode === 'pass' ? 'teams' : 'board',
    mode: ctx.mode, variant: ctx.variant, options: ctx.options,
    players: ctx.players.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    contestants: [],
    teamsOn: ctx.mode === 'room' && !!(ctx.teams && ctx.teams.length),
    scores: {},
    streaks: {},
    usedIds: [],
    board: [],
    round: null,
    wager: null,
    final: null,
  };
  if (ctx.mode === 'room') {
    state.contestants = state.teamsOn
      ? ctx.teams.map((t) => ({ id: t.id, name: t.name, color: t.color, memberIds: t.memberIds.slice() }))
      : state.players.map((p) => ({ id: p.id, name: p.name, color: p.color, memberIds: [p.id] }));
    buildBoard(state, ctx);
  } else {
    autoTeams(state, ctx);
  }
  return state;
}

/* ---------- actions ---------- */

export function act(state, a, ctx) {
  switch (a.type) {
    case 'shuffleTeams':
      if (!a.host) return fail('Only the quizmaster can do that.');
      if (state.phase !== 'teams') return fail('Teams are already set.');
      autoTeams(state, ctx);
      return;
    case 'confirmTeams':
      if (!a.host) return fail('Only the quizmaster can do that.');
      if (state.phase !== 'teams') return fail('Teams are already set.');
      buildBoard(state, ctx);
      return;

    case 'pickTile': {
      if (!a.host) return fail('Only the host can pick the board.');
      if (state.phase !== 'board') return fail('Not picking right now.');
      const tile = state.board.find((t) => t.id === a.payload && !t.used);
      if (!tile) return fail('Pick a tile still on the board.');
      tile.used = true;
      startRoundFromTile(state, tile, ctx);
      return;
    }

    case 'answer': {
      if (state.phase !== 'question') return fail('No question live.');
      let cid, choice;
      if (state.mode === 'pass') {
        if (!a.host) return fail('Only the quizmaster can record an answer.');
        ({ contestantId: cid, choice } = a.payload || {});
      } else {
        cid = contestantOf(state, a.from);
        choice = a.payload;
      }
      if (!inContestants(state, cid)) return fail('Not in this round.');
      if (typeof choice !== 'number' || choice < 0 || choice >= state.round.question.options.length) return fail('Pick a valid option.');
      state.round.answers[cid] = { choice, at: ctx.now };
      maybeAutoResolveQuestion(state, ctx);
      return;
    }

    case 'buzz': {
      if (state.phase !== 'buzzer') return fail('No buzzer question live.');
      if (state.round.buzzActive) return; // someone already buzzed; ignore the race loser quietly
      let cid;
      if (state.mode === 'pass') {
        if (!a.host) return fail('Only the quizmaster can register a buzz.');
        cid = a.payload;
      } else {
        cid = contestantOf(state, a.from);
      }
      if (!inContestants(state, cid)) return fail('Not in this round.');
      if (state.round.buzzWrong.includes(cid)) return; // already locked out, ignore
      if (!state.round.buzzOrder.includes(cid)) state.round.buzzOrder.push(cid);
      state.round.buzzActive = cid;
      startTimer(state, 15_000, ctx.now, 'buzzAnswerTimeUp');
      return;
    }
    case 'submitBuzzAnswer': {
      if (state.phase !== 'buzzer') return fail('No buzzer question live.');
      if (state.mode !== 'room') return fail('On one phone the quizmaster judges.');
      const buzzCid = contestantOf(state, a.from);
      if (!buzzCid || buzzCid !== state.round.buzzActive) return fail('Not your buzz.');
      const text = String((a.payload || {}).text || '').slice(0, 80);
      const q = state.round.question;
      if (normaliseGuess(text) === normaliseGuess(q.options[q.answer])) resolveBuzzCorrect(state, buzzCid);
      else buzzWrong(state, ctx, buzzCid);
      return;
    }
    case 'judgeBuzz': {
      if (state.phase !== 'buzzer') return fail('No buzzer question live.');
      if (state.mode !== 'pass') return fail('That one judges itself on your own phone.');
      if (!a.host) return fail('Only the quizmaster can judge.');
      if (!state.round.buzzActive) return fail('Nobody has buzzed.');
      const cid = state.round.buzzActive;
      if ((a.payload || {}).correct) resolveBuzzCorrect(state, cid);
      else buzzWrong(state, ctx, cid);
      return;
    }
    case 'buzzWaitTimeUp':
      if (!a.system) return fail('Only the clock can do that.');
      if (state.phase === 'buzzer' && !state.round.buzzActive) resolveBuzzNone(state);
      return;
    case 'buzzAnswerTimeUp':
      if (!a.system) return fail('Only the clock can do that.');
      if (state.phase === 'buzzer' && state.round.buzzActive) buzzWrong(state, ctx, state.round.buzzActive);
      return;

    case 'timeUp':
      if (!a.system) return fail('Only the clock can do that.');
      if (state.phase === 'question') resolveQuestion(state);
      return;

    case 'audienceBet': {
      if (state.phase !== 'question' && state.phase !== 'buzzer') return fail('No bet to place right now.');
      if (!(state.audience || []).includes(a.from)) return fail('Only the crowd can bet.');
      if (!inContestants(state, a.payload)) return fail('Pick a contestant on the board.');
      state.round.audienceBets[a.from] = a.payload;
      return;
    }

    case 'revealNow':
      if (!a.host) return fail('Only the host can do that.');
      if (state.phase === 'question') { resolveQuestion(state); return; }
      if (state.phase === 'buzzer') { resolveBuzzNone(state); return; }
      if (state.phase === 'wager-question') { resolveWager(state, ctx); return; }
      return fail('Nothing to reveal yet.');

    case 'continue':
      if (!a.host) return fail('Only the host can do that.');
      if (state.phase !== 'reveal') return fail('Finish this round first.');
      state.phase = 'leaderboard';
      return;
    case 'nextRound':
      if (!a.host) return fail('Only the host can do that.');
      if (state.phase !== 'leaderboard') return fail('Not ready yet.');
      if (state.board.every((t) => t.used)) startWager(state);
      else {
        state.round = null;
        state.phase = 'board';
        deadlyCard(state, ctx.rng);
      }
      return;

    case 'placeBid': {
      if (state.phase !== 'wager-bid') return fail('Not wagering right now.');
      let cid, amount;
      if (state.mode === 'pass') {
        if (!a.host) return fail('Only the quizmaster can record a wager.');
        ({ contestantId: cid, amount } = a.payload || {});
      } else {
        cid = contestantOf(state, a.from);
        amount = a.payload;
      }
      if (!inContestants(state, cid)) return fail('Not in this round.');
      const max = Math.max(0, state.scores[cid] || 0);
      state.wager.bids[cid] = clamp(Math.round(Number(amount) || 0), 0, max);
      if (contestantIds(state).every((id) => state.wager.bids[id] !== undefined)) closeBids(state, ctx);
      return;
    }
    case 'closeBids':
      if (!a.host) return fail('Only the host can do that.');
      if (state.phase !== 'wager-bid') return fail('Not wagering right now.');
      closeBids(state, ctx);
      return;
    case 'wagerAnswer': {
      if (state.phase !== 'wager-question') return fail('No final question live.');
      let cid, choice;
      if (state.mode === 'pass') {
        if (!a.host) return fail('Only the quizmaster can record an answer.');
        ({ contestantId: cid, choice } = a.payload || {});
      } else {
        cid = contestantOf(state, a.from);
        choice = a.payload;
      }
      if (!inContestants(state, cid)) return fail('Not in this round.');
      if (typeof choice !== 'number') return fail('Pick an option.');
      state.wager.answers[cid] = choice;
      if (contestantIds(state).every((id) => state.wager.answers[id] !== undefined)) resolveWager(state, ctx);
      return;
    }
    case 'wagerTimeUp':
      if (!a.system) return fail('Only the clock can do that.');
      if (state.phase === 'wager-question') resolveWager(state, ctx);
      return;

    case 'playAgain':
      if (!a.host) return fail('Only the host can do that.');
      if (state.phase !== 'final') return fail('The game is still going.');
      state.scores = {};
      state.streaks = {};
      state.usedIds = [];
      state.round = null;
      state.wager = null;
      state.final = null;
      if (state.mode === 'pass') { autoTeams(state, ctx); state.phase = 'teams'; } else buildBoard(state, ctx);
      return;

    default:
      return fail('Unknown move.');
  }
}

export function deadline(state) {
  return timerDeadline(state);
}

// Host Box: a live buzzer race with nobody in yet turns the box's button
// into a physical buzzer for whichever player it is assigned to (room mode
// only; in pass and play the quizmaster already holds the box). See
// lib/hostbox.mjs buttonModeFor and docs/HOSTBOX-PROTOCOL.md.
export function boxButton(state) {
  if (state.mode === 'room' && state.phase === 'buzzer' && !state.round.buzzActive) {
    return { mode: 'buzzer', label: 'Buzz in', action: { type: 'buzz', payload: null }, asHost: false };
  }
  return null;
}

/* ---------- late joiners and leavers ---------- */

export function addPlayer(state, player) {
  if (state.players.some((p) => p.id === player.id)) return;
  state.players.push({ id: player.id, name: player.name, color: player.color });
  if (state.mode === 'room' && !state.teamsOn) {
    if (!inContestants(state, player.id)) state.contestants.push({ id: player.id, name: player.name, color: player.color, memberIds: [player.id] });
  } else if (state.contestants.length) {
    const smallest = state.contestants.reduce((a, b) => (a.memberIds.length <= b.memberIds.length ? a : b));
    smallest.memberIds.push(player.id);
  }
}

export function removePlayer(state, id, ctx) {
  state.players = state.players.filter((p) => p.id !== id);
  if (state.mode === 'room' && !state.teamsOn) {
    state.contestants = state.contestants.filter((c) => c.id !== id);
  } else {
    for (const c of state.contestants) c.memberIds = c.memberIds.filter((m) => m !== id);
    if (state.mode === 'room') state.contestants = state.contestants.filter((c) => c.memberIds.length);
  }

  if (state.round) {
    delete state.round.answers[id];
    delete state.round.audienceBets[id];
    state.round.buzzOrder = state.round.buzzOrder.filter((x) => x !== id);
    state.round.buzzWrong = state.round.buzzWrong.filter((x) => x !== id);
    if (state.round.buzzActive === id) {
      state.round.buzzActive = null;
      if (state.phase === 'buzzer') {
        const remaining = contestantIds(state).filter((cid) => !state.round.buzzWrong.includes(cid));
        if (!remaining.length) resolveBuzzNone(state);
        else startTimer(state, 10_000, ctx.now, 'buzzWaitTimeUp');
      }
    }
  }
  if (state.wager) {
    delete state.wager.bids[id];
    delete state.wager.answers[id];
  }
  const ids = contestantIds(state);
  if (state.phase === 'question' && ids.length && ids.every((cid) => state.round.answers[cid])) resolveQuestion(state);
  if (state.phase === 'wager-bid' && ids.length && ids.every((cid) => state.wager.bids[cid] !== undefined)) closeBids(state, ctx);
  if (state.phase === 'wager-question' && ids.length && ids.every((cid) => state.wager.answers[cid] !== undefined)) resolveWager(state, ctx);
}

/* ---------- views ---------- */

function common(state) {
  return {
    phase: state.phase,
    mode: state.mode,
    contestants: state.contestants.map((c) => ({ id: c.id, name: c.name, color: c.color, memberIds: c.memberIds })),
    board: state.board.map((t) => ({ id: t.id, label: t.label, type: t.type, used: t.used })),
    boardLeft: state.board.filter((t) => !t.used).length,
    timer: state.timer || null,
    scores: leaderboard(state, contestantIds(state)),
    // Deadly: who is on Double or Nothing, and streaks building towards it.
    don: contestantIds(state).filter((cid) => onDouble(state, cid)),
    streaks: isDeadly(state) ? Object.fromEntries(contestantIds(state).map((cid) => [cid, streaksOf(state)[cid] || 0])) : {},
    doubleAt: DOUBLE_AT,
    audienceCount: (state.audience || []).length,
    // Whether contestants are teams (pass and play, or a room split into
    // teams) or one real player each: a team of exactly one still needs
    // team-style rendering (teamAvatar/c.name), so the client can't infer
    // it from a contestant's own memberIds.length.
    teamsOn: state.mode === 'pass' || state.teamsOn,
  };
}

function roundViewPublic(state) {
  const q = state.round.question;
  return {
    type: state.round.type,
    categoryLabel: state.round.tile.label,
    text: q.text,
    options: q.options,
    answered: contestantIds(state).filter((id) => state.round.answers[id]),
  };
}

function buzzerViewPublic(state) {
  const q = state.round.question;
  return {
    categoryLabel: state.round.tile.label,
    text: q.text,
    buzzActive: state.round.buzzActive,
    buzzedOut: state.round.buzzWrong.slice(),
  };
}

function revealViewOf(state) {
  const q = state.round.question;
  return {
    type: state.round.type,
    categoryLabel: state.round.tile.label,
    text: q.text,
    options: q.options || null,
    correctText: q.options ? q.options[q.answer] : null,
    winner: state.round.winner,
    results: contestantIds(state).map((id) => ({ id, points: state.round.scoreDelta[id] || 0 })),
    drinks: state.round.drinks,
    doubled: state.round.doubled || [],
    donShots: state.round.donShots || [],
  };
}

function wagerBidViewPublic(state) {
  return { bidsIn: contestantIds(state).filter((id) => state.wager.bids[id] !== undefined) };
}

function wagerQuestionViewPublic(state) {
  const q = state.wager.question;
  return { text: q.text, options: q.options, answeredIn: contestantIds(state).filter((id) => state.wager.answers[id] !== undefined) };
}

export function playerView(state, playerId) {
  const base = common(state);
  if (!state.players.some((p) => p.id === playerId)) {
    const audience = (state.audience || []).includes(playerId);
    const betting = audience && (state.phase === 'question' || state.phase === 'buzzer');
    if (betting) return { ...base, me: null, audience: true, myBet: state.round.audienceBets[playerId] || null };
    return { ...base, me: null, audience, watching: true };
  }
  const mine = state.contestants.find((c) => c.memberIds.includes(playerId));
  const view = { ...base, me: playerId, myContestantId: mine ? mine.id : null };
  switch (state.phase) {
    case 'question':
      view.round = { ...roundViewPublic(state), myAnswer: mine ? state.round.answers[mine.id]?.choice ?? null : null };
      return view;
    case 'buzzer': {
      const r = buzzerViewPublic(state);
      view.round = {
        ...r,
        canBuzz: state.mode === 'room' && !!mine && !r.buzzActive && !state.round.buzzWrong.includes(mine.id),
        isBuzzActive: state.mode === 'room' && !!mine && r.buzzActive === mine.id,
      };
      return view;
    }
    case 'reveal':
      view.round = revealViewOf(state);
      return view;
    case 'wager-bid':
      view.wager = { ...wagerBidViewPublic(state), myBid: mine ? state.wager.bids[mine.id] ?? null : null, myMax: mine ? Math.max(0, state.scores[mine.id] || 0) : 0 };
      return view;
    case 'wager-question':
      view.wager = { ...wagerQuestionViewPublic(state), myAnswer: mine ? state.wager.answers[mine.id] ?? null : null };
      return view;
    case 'final':
      view.final = state.final;
      return view;
    default:
      return view; // teams, board, leaderboard
  }
}

export function tvView(state) {
  const base = common(state);
  switch (state.phase) {
    case 'question':
      return { ...base, round: roundViewPublic(state) };
    case 'buzzer': {
      const r = buzzerViewPublic(state);
      if (state.mode === 'pass' && r.buzzActive) {
        const q = state.round.question;
        return { ...base, round: { ...r, judgeAnswer: q.options[q.answer] } };
      }
      return { ...base, round: r };
    }
    case 'reveal':
      return { ...base, round: revealViewOf(state) };
    case 'wager-bid':
      return { ...base, wager: wagerBidViewPublic(state) };
    case 'wager-question':
      return { ...base, wager: wagerQuestionViewPublic(state) };
    case 'final':
      return { ...base, final: state.final };
    default:
      return base; // teams, board, leaderboard
  }
}

export function hostActions(state) {
  switch (state.phase) {
    case 'teams':
      return [
        { type: 'shuffleTeams', label: 'Shuffle teams', tone: 'secondary' },
        { type: 'confirmTeams', label: 'Start the quiz', tone: 'primary' },
      ];
    case 'board':
      return [];
    case 'question':
      return [{ type: 'revealNow', label: 'Reveal now', tone: 'secondary', confirm: 'Lock in answers and reveal now?' }];
    case 'buzzer':
      if (state.mode === 'pass' && state.round.buzzActive) {
        return [
          { type: 'judgeBuzz', label: 'Correct', tone: 'primary', payload: { correct: true } },
          { type: 'judgeBuzz', label: 'Wrong', tone: 'danger', payload: { correct: false } },
        ];
      }
      return [{ type: 'revealNow', label: 'Nobody buzzed, reveal', tone: 'secondary', confirm: 'Reveal the answer now?' }];
    case 'reveal':
      return [{ type: 'continue', label: 'Show standings', tone: 'primary' }];
    case 'leaderboard':
      return [{ type: 'nextRound', label: state.board.every((t) => t.used) ? 'Go to the final wager' : 'Back to the board', tone: 'primary' }];
    case 'wager-bid':
      return [{ type: 'closeBids', label: 'Lock in wagers', tone: 'primary' }];
    case 'wager-question':
      return [{ type: 'revealNow', label: 'Reveal now', tone: 'secondary', confirm: 'Lock in answers and reveal now?' }];
    case 'final':
      return [{ type: 'playAgain', label: 'Play again', tone: 'primary' }];
    default:
      return [];
  }
}

export function passTurn() {
  return null; // quiz-show is always played on the shared screen in pass and play
}

/* ---------- bot: drives test/contract.test.mjs and the e2e bots ---------- */

function botAdminMove(state, ctx) {
  switch (state.phase) {
    case 'board': {
      const free = state.board.filter((t) => !t.used);
      return free.length ? { type: 'pickTile', payload: pick(free, ctx.rng).id } : null;
    }
    case 'reveal': return { type: 'continue', payload: null };
    case 'leaderboard': return { type: 'nextRound', payload: null };
    case 'final': return { type: 'playAgain', payload: null };
    default: return null;
  }
}

function botPersonalMove(state, playerId, ctx) {
  const cid = contestantOf(state, playerId);
  if (!cid) return null;
  switch (state.phase) {
    case 'question':
      if (state.round.answers[cid]) return null;
      return { type: 'answer', payload: Math.floor(ctx.rng() * state.round.question.options.length) };
    case 'buzzer':
      if (!state.round.buzzActive && !state.round.buzzWrong.includes(cid)) return { type: 'buzz', payload: null };
      if (state.round.buzzActive === cid) {
        const q = state.round.question;
        const guess = ctx.rng() < 0.5 ? q.options[q.answer] : 'a wrong guess';
        return { type: 'submitBuzzAnswer', payload: { text: guess } };
      }
      return null;
    case 'wager-bid':
      if (state.wager.bids[cid] !== undefined) return null;
      return { type: 'placeBid', payload: Math.floor(ctx.rng() * (Math.max(0, state.scores[cid] || 0) + 1)) };
    case 'wager-question':
      if (state.wager.answers[cid] !== undefined) return null;
      return { type: 'wagerAnswer', payload: Math.floor(ctx.rng() * state.wager.question.options.length) };
    default:
      return null;
  }
}

function botAudienceMove(state, playerId, ctx) {
  if (!(state.audience || []).includes(playerId)) return null;
  if (state.phase !== 'question' && state.phase !== 'buzzer') return null;
  if (state.round.audienceBets[playerId] !== undefined) return null;
  const ids = contestantIds(state);
  return ids.length ? { type: 'audienceBet', payload: pick(ids, ctx.rng) } : null;
}

function botHostMove(state, ctx) {
  switch (state.phase) {
    case 'teams': return { type: 'confirmTeams', payload: null };
    case 'board': {
      const free = state.board.filter((t) => !t.used);
      return free.length ? { type: 'pickTile', payload: pick(free, ctx.rng).id } : null;
    }
    case 'question': {
      const next = contestantIds(state).find((id) => !state.round.answers[id]);
      return next ? { type: 'answer', payload: { contestantId: next, choice: Math.floor(ctx.rng() * state.round.question.options.length) } } : null;
    }
    case 'buzzer': {
      if (state.round.buzzActive) return { type: 'judgeBuzz', payload: { correct: ctx.rng() < 0.5 } };
      const free = contestantIds(state).filter((id) => !state.round.buzzWrong.includes(id));
      return free.length ? { type: 'buzz', payload: pick(free, ctx.rng) } : null;
    }
    case 'reveal': return { type: 'continue', payload: null };
    case 'leaderboard': return { type: 'nextRound', payload: null };
    case 'wager-bid': {
      const next = contestantIds(state).find((id) => state.wager.bids[id] === undefined);
      return next ? { type: 'placeBid', payload: { contestantId: next, amount: Math.floor(ctx.rng() * (Math.max(0, state.scores[next] || 0) + 1)) } } : null;
    }
    case 'wager-question': {
      const next = contestantIds(state).find((id) => state.wager.answers[id] === undefined);
      return next ? { type: 'wagerAnswer', payload: { contestantId: next, choice: Math.floor(ctx.rng() * state.wager.question.options.length) } } : null;
    }
    case 'final': return { type: 'playAgain', payload: null };
    default: return null;
  }
}

export function bot(state, playerId, ctx) {
  if (playerId === null) return state.mode === 'pass' ? botHostMove(state, ctx) : botAdminMove(state, ctx);
  if (state.mode === 'pass') return null; // everything in pass mode runs through the shared screen
  const move = botPersonalMove(state, playerId, ctx);
  return move || botAudienceMove(state, playerId, ctx);
}
