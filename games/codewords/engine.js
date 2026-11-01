// Codewords: a Codenames-style word-grid game. Two teams each have a secret
// set of words hidden among neutral words and one Bomb on a shared grid.
// Each team's Caller sees the key (which word belongs to who) and gives a
// one-word clue + a count; their teammates tap the board to guess. Find all
// your words first, or get handed the win when the other team reveals the
// Bomb. Phases: clue (the active team's Caller is composing a clue) ->
// guess (their team taps the board) -> clue (the other team) -> ... ->
// final (someone has won).
import {
  shuffle, pick, fail, addScore, leaderboard, stat, gameOver,
  teamOf, teamSip, teamShot, isDrinking, deadlyCard,
} from '../_kit/kit.js';
import { TEAM_COLORS } from '../_kit/palette.js';

export const meta = {
  id: 'codewords',
  name: 'Codewords',
  emoji: '🔤',
  tagline: 'One player on each team sees the key. Everyone else has to guess the words from a one-word clue.',
  blurb: 'Two teams race to find every one of their own words on a shared grid from one-word clues, before the other side finishes first or someone reveals the Bomb.',
  minPlayers: 3,
  maxPlayers: 12,
  order: 130,
  accent: '#12b886',
  pitch: "Find your team's words from one-word clues",
  minutes: [15, 30],
  vibes: ['brain'],
  modes: ['pass', 'room'],
  teams: true,
  howto: [
    "Each team's Caller sees the key and gives a one-word clue and a number",
    'Their teammates tap the words they think the clue points to',
    'Find all your words first, and never touch the Bomb',
  ],
  variants: {
    standard: 'Find every one of your team’s words before the other team does, or win the moment they reveal the Bomb.',
    drinking: 'A wrong guess costs your whole team a sip; hit the Bomb and everyone on that team sips extra.',
    deadly: 'Whoever hits the Bomb, their whole team takes a shot together.',
  },
  options: [
    {
      key: 'boardSize', label: 'Board size', type: 'choice', default: '25',
      choices: [{ value: '16', label: '16 words' }, { value: '25', label: '25 words' }],
    },
  ],
};

// Curated packs (games/codewords/packs/): a themed word bank, at least two
// full boards' worth so back-to-back games don't deal the same 25.
export const curated = { itemLabel: 'word', minItems: 50 };

const TEAM_COLOR_FOR = (i) => TEAM_COLORS[i % TEAM_COLORS.length];

/* ---------- teams: always exactly two ----------
   Fallback rule (documented here because it's a judgement call): in a room,
   if the lobby gave us exactly two teams with at least one member each, we
   use them as-is (names, colors, memberIds). Any other shape - no teams, one
   team, three or more teams, or a team with nobody in it - falls back to our
   own auto-split of the current roster, the same round-robin-after-shuffle
   split pass-and-play always uses (mirrors quiz-show's autoTeams). */
function autoTeams(state, ctx) {
  const shuffled = shuffle(state.players.map((p) => p.id), ctx.rng);
  const teams = [0, 1].map((i) => ({ id: `team-${i + 1}`, name: `Team ${i + 1}`, color: TEAM_COLOR_FOR(i), memberIds: [] }));
  shuffled.forEach((id, i) => teams[i % 2].memberIds.push(id));
  state.contestants = teams;
}

function buildContestants(state, ctx) {
  const usable = ctx.mode === 'room' && Array.isArray(ctx.teams) && ctx.teams.length === 2
    && ctx.teams.every((t) => Array.isArray(t.memberIds) && t.memberIds.length);
  if (usable) {
    state.contestants = ctx.teams.map((t) => ({ id: t.id, name: t.name, color: t.color, memberIds: t.memberIds.slice() }));
  } else {
    autoTeams(state, ctx);
  }
}

// One Caller per team. The same person stays a team's Caller for the whole
// game (so they keep the key secrets for a turn-switch mid-reveal); playAgain
// rotates each team to its next member so the role moves around a group
// across a night, same as a real Codenames table passing the key card on.
function assignCallers(state, ctx, rotate) {
  state.callerOf = state.callerOf || {};
  for (const c of state.contestants) {
    const prev = state.callerOf[c.id];
    if (!prev || !c.memberIds.includes(prev)) {
      state.callerOf[c.id] = pick(c.memberIds, ctx.rng);
    } else if (rotate) {
      const idx = c.memberIds.indexOf(prev);
      state.callerOf[c.id] = c.memberIds[(idx + 1) % c.memberIds.length];
    }
  }
}

// A team of one is its own Caller AND its own guesser (3 players: a pair and
// a loner). That Caller knows the whole key, so unlimited or big clues would
// clear the board in one turn: their number is held at 1 (two taps).
const SOLO_MAX_COUNT = 1;
const isSolo = (team) => !!team && team.memberIds.length === 1;

// Is `clue` too close to a board word? The word itself, its plural or ending
// (-s, -ed, -ing, -er), or anything built on a longer word. A short board
// word (Den, Hem, Ash) hiding inside an unrelated word (garden, them,
// splash) is fine.
function clashesWith(clue, boardWord) {
  const w = boardWord.toLowerCase();
  if (clue === w || w.includes(clue)) return true;
  if (w.length >= 5) return clue.includes(w);
  return clue.startsWith(w) && clue.length - w.length <= 3;
}

const teamOfPlayer = (state, playerId) => teamOf(state.contestants, playerId);
const otherTeamId = (state, id) => (state.contestants.find((c) => c.id !== id) || {}).id;

// Only the Caller's own teammates can tap the board, except on a solo team
// (just the Caller themselves): then there is nobody else to do it, so the
// Caller guesses too rather than the team being unable to ever play.
function canGuess(state, team, playerId) {
  if (!team || !team.memberIds.includes(playerId)) return false;
  if (team.memberIds.length === 1) return true;
  return playerId !== state.callerOf[team.id];
}

/* ---------- the board ---------- */

function buildBoard(state, ctx) {
  const n = Number(state.options.boardSize) === 16 ? 16 : 25;
  const firstCount = Math.ceil(n / 3);
  const secondCount = firstCount - 1;
  const neutralCount = n - firstCount - secondCount - 1; // 1 = the Bomb

  const bank = ctx.content.words;
  const fresh = bank.filter((w) => !state.used.includes(w));
  const pool = fresh.length >= n ? fresh : bank;
  const words = shuffle(pool, ctx.rng).slice(0, n);
  state.used = [...state.used, ...words].slice(-Math.max(bank.length - n, 0));

  // Which team goes first: a real edge, like the physical game, since the
  // first team's pile is one bigger than the second's.
  const firstIdx = ctx.rng() < 0.5 ? 0 : 1;
  const secondIdx = 1 - firstIdx;
  const firstTeam = state.contestants[firstIdx];
  const secondTeam = state.contestants[secondIdx];

  const slots = shuffle(Array.from({ length: n }, (_, i) => i), ctx.rng);
  const colors = new Array(n);
  let p = 0;
  const assign = (count, color) => { for (let i = 0; i < count; i++) colors[slots[p++]] = color; };
  assign(firstCount, firstTeam.id);
  assign(secondCount, secondTeam.id);
  assign(1, 'bomb');
  assign(neutralCount, 'neutral');

  state.tiles = words.map((word, i) => ({ word, color: colors[i], revealed: false }));
  state.remaining = { [firstTeam.id]: firstCount, [secondTeam.id]: secondCount };
  state.active = firstTeam.id;
  state.clue = null;
  state.turnGuessesLeft = null;
  state.lastGuess = null;
  state.turnDrinks = [];
  state.result = null;
  state.phase = 'clue';
}

/* ---------- scoring the whole game ---------- */

function playerBoard(state) {
  const rows = [];
  for (const c of state.contestants) {
    for (const id of c.memberIds) if (state.players.some((p) => p.id === id)) rows.push({ id, score: state.scores[c.id] || 0 });
  }
  return rows.sort((a, b) => b.score - a.score);
}

function finishGame(state, ctx, winnerId, reason, drinks = []) {
  for (const t of state.tiles) t.revealed = true;
  if (winnerId) {
    addScore(state, winnerId, 1);
    const team = state.contestants.find((c) => c.id === winnerId);
    const caller = state.callerOf[winnerId];
    if (team) for (const id of team.memberIds) if (id !== caller) stat(state, id, 'guesser');
  }
  state.phase = 'final';
  state.result = { winner: winnerId || null, reason, drinks };
  gameOver(state, playerBoard(state));
}

function endTurn(state, ctx, why) {
  const ended = state.active;
  state.active = otherTeamId(state, state.active);
  state.clue = null;
  state.turnGuessesLeft = null;
  // turnDrinks is kept (not cleared) so the sips the wrong guess just cost
  // stay on screen while the other Caller thinks; giveClue clears them.
  // A skip drops the old word, or the screens would show a stale result instead of saying so.
  state.lastGuess = why === 'skipped' ? { team: ended, endedTurn: why } : { ...state.lastGuess, team: ended, endedTurn: why };
  state.phase = 'clue';
  // A team-turn switch is this game's "between rounds" moment.
  deadlyCard(state, ctx.rng);
}

function bombHit(state, ctx) {
  const loser = state.active;
  const winner = otherTeamId(state, loser);
  const team = state.contestants.find((c) => c.id === loser);
  const shots = teamShot(state, team, 'hit the Bomb').filter(Boolean);
  finishGame(state, ctx, winner, 'bomb', shots);
}

function resolveGuess(state, ctx, tile) {
  tile.revealed = true;
  if (tile.color === 'bomb') { bombHit(state, ctx); return; }
  if (tile.color === 'neutral') {
    state.lastGuess = { word: tile.word, color: 'neutral' };
    const drinks = teamSip(state, state.contestants.find((c) => c.id === state.active), 1, 'a neutral word').filter(Boolean);
    state.turnDrinks.push(...drinks);
    endTurn(state, ctx, 'a neutral word');
    return;
  }
  // tile.color is a contestant id: either the active team's own word, or the
  // other team's. Either way their remaining count drops; a revealed
  // opponent word is public now too, which can finish their board for them
  // even though it wasn't their turn (same as the physical game).
  state.remaining[tile.color] = Math.max(0, (state.remaining[tile.color] || 0) - 1);
  const isOwn = tile.color === state.active;
  state.lastGuess = { word: tile.word, color: tile.color };
  if (state.remaining[tile.color] <= 0) { finishGame(state, ctx, tile.color, 'found-all'); return; }
  if (!isOwn) {
    const drinks = teamSip(state, state.contestants.find((c) => c.id === state.active), 1, 'the other team’s word').filter(Boolean);
    state.turnDrinks.push(...drinks);
    endTurn(state, ctx, 'the other team’s word');
    return;
  }
  if (state.turnGuessesLeft !== null) {
    state.turnGuessesLeft -= 1;
    if (state.turnGuessesLeft <= 0) { endTurn(state, ctx, 'no guesses left'); return; }
  }
  // else: correct and guesses remain (or unlimited) - stay in guess phase.
}

/* ---------- init ---------- */

export function init(ctx) {
  const state = {
    phase: 'clue',
    mode: ctx.mode, variant: ctx.variant, options: ctx.options,
    players: ctx.players.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    contestants: [],
    callerOf: {},
    scores: {},
    used: [],
    tiles: [],
    remaining: {},
    active: null,
    clue: null,
    turnGuessesLeft: null,
    turnDrinks: [],
    lastGuess: null,
    result: null,
  };
  buildContestants(state, ctx);
  assignCallers(state, ctx, false);
  buildBoard(state, ctx);
  return state;
}

/* ---------- actions ---------- */

export function act(state, a, ctx) {
  switch (a.type) {
    case 'giveClue': {
      if (state.phase !== 'clue') return fail('Not giving a clue right now.');
      if (a.from !== state.callerOf[state.active]) return fail('Only the active team’s Caller can give the clue.');
      const { word, count } = a.payload || {};
      const w = String(word || '').trim();
      if (!w || w.length > 24 || !/^[A-Za-z]+$/.test(w)) return fail('Give one plain word as the clue.');
      const lower = w.toLowerCase();
      for (const t of state.tiles) {
        if (clashesWith(lower, t.word)) return fail(`The clue is too close to ${t.word.toUpperCase()} on the board.`);
      }
      const n = Math.round(Number(count));
      if (!Number.isInteger(n) || n < 0 || n > 9) return fail('Pick a count from 0 to 9 (0 = unlimited guesses).');
      if (isSolo(state.contestants.find((c) => c.id === state.active)) && n !== SOLO_MAX_COUNT) {
        return fail(`You are playing alone and can see the key, so your clue number stays at ${SOLO_MAX_COUNT}.`);
      }
      state.clue = { word: w, count: n };
      state.turnGuessesLeft = n === 0 ? null : n + 1;
      state.lastGuess = null;
      state.turnDrinks = [];
      state.phase = 'guess';
      return;
    }

    case 'guess': {
      if (state.phase !== 'guess') return fail('Not guessing right now.');
      if (state.mode === 'pass') {
        if (!a.host) return fail('On one phone, taps come from the shared screen.');
      } else {
        const team = teamOfPlayer(state, a.from);
        if (!team || team.id !== state.active) return fail('Not your team’s turn.');
        if (!canGuess(state, team, a.from)) return fail('The Caller can’t tap the board.');
      }
      const word = String(a.payload || '');
      const tile = state.tiles.find((t) => t.word === word);
      if (!tile) return fail('Unknown tile.');
      if (tile.revealed) return; // stale tap from another phone, ignore quietly
      resolveGuess(state, ctx, tile);
      return;
    }

    case 'stopGuessing': {
      if (state.phase !== 'guess') return fail('Not guessing right now.');
      if (state.mode === 'pass') {
        if (!a.host) return fail('On one phone, the shared screen calls it.');
      } else {
        const team = teamOfPlayer(state, a.from);
        if (!team || team.id !== state.active) return fail('Not your team’s turn.');
        if (!canGuess(state, team, a.from)) return fail('The Caller can’t stop the guessing.');
      }
      endTurn(state, ctx, 'stopped guessing');
      return;
    }

    case 'skipTurn':
      // A Caller who has gone quiet (phone locked, wandered off) must not hold the room.
      if (!a.host) return fail('Only the host can do that.');
      if (state.mode !== 'room') return fail('On one phone, just stop guessing.');
      if (state.phase !== 'clue' && state.phase !== 'guess') return fail('There is no turn to skip.');
      endTurn(state, ctx, 'skipped');
      return;

    case 'playAgain':
      if (!a.host) return fail('Only the host can do that.');
      if (state.phase !== 'final') return fail('This game is still going.');
      state.scores = {};
      assignCallers(state, ctx, true);
      buildBoard(state, ctx);
      return;

    default:
      return fail('Unknown move.');
  }
}

/* ---------- late joiners and leavers ---------- */

export function addPlayer(state, player) {
  if (state.players.some((p) => p.id === player.id)) return;
  state.players.push({ id: player.id, name: player.name, color: player.color });
  if (!state.contestants.length) return;
  const smallest = state.contestants.reduce((x, y) => (x.memberIds.length <= y.memberIds.length ? x : y));
  smallest.memberIds.push(player.id);
}

export function removePlayer(state, id, ctx) {
  state.players = state.players.filter((p) => p.id !== id);
  for (const c of state.contestants) c.memberIds = c.memberIds.filter((m) => m !== id);
  for (const c of state.contestants) if (state.callerOf[c.id] === id) state.callerOf[c.id] = c.memberIds[0] || null;

  if (state.phase === 'final') return;
  const empty = state.contestants.find((c) => !c.memberIds.length);
  const other = state.contestants.find((c) => c !== empty);
  if (empty && other) {
    if (other.memberIds.length > 1) {
      // Rebalance, same rule as addPlayer: pull a spare member across so
      // neither team is ever left with nobody at all. Prefer moving someone
      // who is not the other team's own Caller, so their turn isn't disrupted.
      const spare = other.memberIds.find((m) => m !== state.callerOf[other.id]) || other.memberIds[0];
      other.memberIds = other.memberIds.filter((m) => m !== spare);
      empty.memberIds.push(spare);
      state.callerOf[empty.id] = spare;
    } else {
      // Nobody left to move over: that team can never take a turn again, so
      // hand the win to whoever remains rather than leave the game stuck.
      finishGame(state, ctx, other.id, 'the other team left', []);
      return;
    }
  }
  if (state.phase === 'clue' && !state.callerOf[state.active]) {
    const active = state.contestants.find((c) => c.id === state.active);
    state.callerOf[state.active] = active ? active.memberIds[0] : null;
  }
}

/* ---------- views ---------- */

function tilesFor(state, showKey) {
  return state.tiles.map((t) => ({
    word: t.word,
    revealed: t.revealed,
    color: t.revealed ? t.color : (showKey ? t.color : null),
  }));
}

function common(state) {
  return {
    phase: state.phase,
    mode: state.mode,
    contestants: state.contestants.map((c) => ({ id: c.id, name: c.name, color: c.color, memberIds: c.memberIds })),
    callerOf: state.callerOf,
    active: state.active,
    remaining: state.remaining,
    clue: state.clue,
    turnGuessesLeft: state.turnGuessesLeft,
    // The most a clue may promise this turn (a lone Caller), else null.
    maxCount: isSolo(state.contestants.find((c) => c.id === state.active)) ? SOLO_MAX_COUNT : null,
    lastGuess: state.lastGuess,
    scores: leaderboard(state, state.contestants.map((c) => c.id)),
    drinks: state.turnDrinks || [],
    result: state.result,
    isDrinking: isDrinking(state),
  };
}

export function playerView(state, playerId) {
  const base = common(state);
  if (!state.players.some((p) => p.id === playerId)) return { ...base, me: null, watching: true, tiles: tilesFor(state, false) };
  const team = teamOfPlayer(state, playerId);
  const isCaller = !!team && state.callerOf[team.id] === playerId;
  // The only moment the full key ever leaves the engine: the active team's
  // own Caller, only while they are the one composing the clue. Everyone
  // else, and the Caller at every other moment (including their own team's
  // guess phase), sees only tiles that have actually been revealed.
  const showKey = isCaller && state.phase === 'clue' && team.id === state.active;
  return {
    ...base,
    me: playerId,
    myTeamId: team ? team.id : null,
    isCaller,
    canGuess: !!team && state.phase === 'guess' && team.id === state.active && canGuess(state, team, playerId),
    tiles: tilesFor(state, showKey),
  };
}

export function tvView(state) {
  return { ...common(state), tiles: tilesFor(state, false) };
}

export function hostActions(state) {
  if (state.phase === 'final') return [{ type: 'playAgain', label: 'Play again', tone: 'primary' }];
  if (state.mode === 'room' && (state.phase === 'clue' || state.phase === 'guess')) {
    const team = state.contestants.find((c) => c.id === state.active);
    return [{ type: 'skipTurn', label: 'Skip turn', tone: 'secondary', confirm: `Skip ${team ? team.name : 'this'}'s turn?` }];
  }
  return [];
}

// One phone: the active team's Caller gets a private look at the key while
// composing their clue, then the phone goes back to the shared screen (the
// tv view, which never shows unrevealed colours) for the whole table to tap
// together - nobody but the Caller is meant to know the colours, and a
// shared phone being tapped by the group out loud is exactly the physical
// game's own worst-kept secret, just digital.
export function passTurn(state) {
  if (state.phase === 'clue') return state.callerOf[state.active] || null;
  return null;
}

/* ---------- bot: drives test/contract.test.mjs and teams-audience.test.mjs ---------- */

// Deliberately not real board words (checked offline against content.json):
// gibberish the Caller-bot can always legally submit as a clue.
const BOT_CLUES = ['vexnomir', 'drazzuquil', 'fwomprakt', 'znorbelix', 'quixoltar', 'blibvorn'];

function botClueMove(state, ctx) {
  const mine = state.tiles.filter((t) => !t.revealed && t.color === state.active).length;
  const n = Math.max(1, Math.min(3, mine));
  // Never a clue that overlaps a board word either way (giveClue rejects
  // those): a short pack word like "Orb" hides inside "znorbelix".
  const board = state.tiles.map((t) => String(t.word).toLowerCase());
  const legal = BOT_CLUES.filter((c) => !board.some((w) => w.includes(c) || c.includes(w)));
  // A lone Caller is held to SOLO_MAX_COUNT (giveClue refuses anything else).
  const solo = isSolo(state.contestants.find((c) => c.id === state.active));
  const count = solo ? SOLO_MAX_COUNT : 1 + Math.floor(ctx.rng() * n);
  return { type: 'giveClue', payload: { word: pick(legal.length ? legal : BOT_CLUES, ctx.rng), count } };
}

function botGuessMove(state, ctx) {
  const open = state.tiles.filter((t) => !t.revealed);
  if (!open.length) return { type: 'stopGuessing', payload: null };
  if (ctx.rng() < 0.2) return { type: 'stopGuessing', payload: null };
  return { type: 'guess', payload: pick(open, ctx.rng).word };
}

export function bot(state, playerId, ctx) {
  if (state.phase === 'final') return playerId === null ? { type: 'playAgain', payload: null } : null;
  if (state.phase === 'clue') {
    return playerId === state.callerOf[state.active] ? botClueMove(state, ctx) : null;
  }
  if (state.phase === 'guess') {
    if (state.mode === 'pass') return playerId === null ? botGuessMove(state, ctx) : null;
    if (playerId === null) return null;
    const team = teamOfPlayer(state, playerId);
    if (team && team.id === state.active && canGuess(state, team, playerId)) return botGuessMove(state, ctx);
    return null;
  }
  return null;
}
