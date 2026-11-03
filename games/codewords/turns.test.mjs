// Codewords: a turn can never stall, a lone Caller cannot clear the board in
// one go, and the clue check does not reject innocent words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadGame } from '../../lib/registry.mjs';
import * as rt from '../_kit/runtime.js';

const GAMES_DIR = fileURLToPath(new URL('../', import.meta.url));
const g = await loadGame(GAMES_DIR, 'codewords');
const engine = g.engine;

const WORDS = ['Hem', 'Den', 'Seal', 'Fountain', 'Mine', 'Web', 'Ash', 'Anchor', 'Banjo', 'Cloud', 'Dune', 'Esky', 'Fern', 'Glove', 'Harbour', 'Island',
  'Jelly', 'Kettle', 'Lantern', 'Marble', 'Needle', 'Orchard', 'Pepper', 'Quiver', 'Ribbon'];

function game({ n = 4, variant = 'standard', mode = 'room', teams = null } = {}) {
  const players = ['Ana', 'Ben', 'Cy', 'Dee', 'Eli', 'Fay'].slice(0, n).map((name, i) => ({ id: `p${i}`, name, color: '#fff' }));
  const clock = { now: 1_700_000_000_000 };
  const ctx = () => ({ players, content: { words: WORDS }, rng: Math.random, now: clock.now });
  const created = rt.createGame(engine, { players, variant, mode, options: {}, content: { words: WORDS }, rng: Math.random, now: clock.now, teams });
  assert.ok(!created.error, created.error);
  const h = { state: created.state, players, ctx, clock };
  h.act = (type, payload, from, host = false) => {
    const r = rt.applyAction(engine, h.state, { type, payload, from, host }, ctx());
    if (r.state) h.state = r.state;
    return r;
  };
  h.caller = () => h.state.callerOf[h.state.active];
  return h;
}

/* a stalled Caller */

test('room: the host can skip a turn while the Caller is clueing', () => {
  const h = game();
  const first = h.state.active;
  const acts = rt.hostActionsOf(engine, h.state, h.ctx());
  const skip = acts.find((a) => a.type === 'skipTurn');
  assert.ok(skip, 'a Skip turn button for the host');
  assert.ok(skip.confirm, 'it asks first');
  assert.equal(skip.tone, 'secondary');
  const r = h.act('skipTurn', null, 'p0', true);
  assert.ok(!r.error, r.error);
  assert.notEqual(h.state.active, first);
  assert.equal(h.state.phase, 'clue');
});

test('room: the host can also skip once guessing has started', () => {
  const h = game();
  const first = h.state.active;
  h.act('giveClue', { word: 'zorpish', count: 1 }, h.caller());
  assert.equal(h.state.phase, 'guess');
  assert.ok(rt.hostActionsOf(engine, h.state, h.ctx()).some((a) => a.type === 'skipTurn'));
  h.act('skipTurn', null, 'p0', true);
  assert.notEqual(h.state.active, first);
  assert.equal(h.state.phase, 'clue');
  assert.equal(h.state.clue, null);
});

test('only the host can skip, and only in a room', () => {
  const h = game();
  assert.ok(h.act('skipTurn', null, 'p1', false).error);
  const p = game({ mode: 'pass' });
  assert.ok(!rt.hostActionsOf(engine, p.state, p.ctx()).some((a) => a.type === 'skipTurn'));
  assert.ok(p.act('skipTurn', null, null, true).error, 'on one phone the group just stops guessing');
});

test('no skip once the game is over', () => {
  const h = game();
  h.state.phase = 'final';
  assert.ok(!rt.hostActionsOf(engine, h.state, h.ctx()).some((a) => a.type === 'skipTurn'));
  assert.ok(h.act('skipTurn', null, 'p0', true).error);
});

/* a lone Caller (3 players: one side is just a Caller) */

function soloGame() {
  const h = game({ n: 3 });
  const solo = h.state.contestants.find((c) => c.memberIds.length === 1);
  const pair = h.state.contestants.find((c) => c.memberIds.length === 2);
  assert.ok(solo && pair, 'three players make a pair and a solo');
  const toTeam = (team) => { h.state.active = team.id; h.state.phase = 'clue'; };
  return { h, solo, pair, toTeam };
}

test('a lone Caller cannot give an unlimited or big clue: they know the key, so one tap of slack at most', () => {
  const { h, solo, toTeam } = soloGame();
  toTeam(solo);
  const who = solo.memberIds[0];
  for (const count of [0, 2, 5, 9]) {
    const r = h.act('giveClue', { word: 'zorpish', count }, who);
    assert.ok(r.error, `count ${count} must be refused for a solo Caller`);
    assert.match(r.error, /alone|solo|just you/i);
  }
  const ok = h.act('giveClue', { word: 'zorpish', count: 1 }, who);
  assert.ok(!ok.error, ok.error);
  assert.equal(h.state.turnGuessesLeft, 2);
});

test('a team with a real guesser keeps every count, including unlimited', () => {
  const { h, pair, toTeam } = soloGame();
  toTeam(pair);
  const r0 = h.act('giveClue', { word: 'zorpish', count: 0 }, h.state.callerOf[pair.id]);
  assert.ok(!r0.error, r0.error);
});

test('the Caller view carries the cap so the form can show it', () => {
  const { h, solo, pair, toTeam } = soloGame();
  toTeam(solo);
  assert.equal(rt.playerViewOf(engine, h.state, solo.memberIds[0], h.ctx()).maxCount, 1);
  toTeam(pair);
  assert.equal(rt.playerViewOf(engine, h.state, h.state.callerOf[pair.id], h.ctx()).maxCount ?? null, null);
});

/* the clue check */

function clueError(h, word) {
  const r = rt.applyAction(engine, h.state, { type: 'giveClue', payload: { word, count: 1 }, from: h.caller(), host: false }, h.ctx());
  return r.error || null;
}

test('short board words do not block longer clues that merely contain them', () => {
  const h = game();
  for (const word of ['garden', 'them', 'determine', 'splash', 'cashew', 'hemisphere']) {
    assert.equal(clueError(h, word), null, `${word} is a fair clue`);
  }
});

test('the board word itself, and its plurals and endings, are still refused', () => {
  const h = game();
  for (const word of ['seal', 'SEALS', 'sealed', 'Sealing', 'fountains', 'fountain', 'anchored', 'webs']) {
    assert.ok(clueError(h, word), `${word} must be refused`);
  }
});

test('long board words still block clues built on them', () => {
  const h = game();
  assert.ok(clueError(h, 'fountainhead'));
  assert.ok(clueError(h, 'harbourside'));
});

test('the refusal names the board word it clashes with', () => {
  const h = game();
  assert.match(clueError(h, 'seals'), /SEAL/i);
});

/* review fixes: skip after a guess, and bots at 3 players */

test('a skip after a guess leaves no stale word behind', () => {
  const h = game();
  h.act('giveClue', { word: 'zorpish', count: 2 }, h.caller());
  const tile = h.state.tiles.find((t) => !t.revealed && t.color === 'neutral');
  h.act('guess', tile.word, h.state.contestants.find((c) => c.id === h.state.active).memberIds.find((id) => id !== h.caller()));
  assert.equal(h.state.lastGuess.word, tile.word, 'the neutral ended the turn and is the last guess');
  const skipped = h.state.active;
  const r = h.act('skipTurn', null, 'p0', true);
  assert.ok(!r.error, r.error);
  assert.equal(h.state.lastGuess.word, undefined);
  assert.equal(h.state.lastGuess.endedTurn, 'skipped');
  assert.notEqual(h.state.active, skipped);
});

test('bots play whole 3-player room and pass games without a refused move', () => {
  for (const mode of ['room', 'pass']) {
    for (let seed = 1; seed <= 20; seed++) {
      const h = game({ n: 3, mode });
      let s = seed;
      h.ctx = () => ({ players: h.players, content: { words: WORDS }, rng: () => { s = (s * 16807) % 2147483647; return s / 2147483647; }, now: h.clock.now });
      for (let step = 0; step < 300 && h.state.phase !== 'final'; step++) {
        const turn = mode === 'pass' ? rt.passTurnOf(engine, h.state, h.ctx()) : undefined;
        const who = mode === 'pass' ? turn : (engine.bot(h.state, h.caller(), h.ctx()) ? h.caller() : h.players.map((p) => p.id).find((id) => engine.bot(h.state, id, h.ctx())) ?? null);
        const a = engine.bot(h.state, who ?? null, h.ctx());
        if (!a) break;
        const r = h.act(a.type, a.payload, who ?? null, who === null || who === 'p0');
        assert.ok(!r.error, `${mode} seed ${seed}: bot move ${JSON.stringify(a)} refused: ${r.error}`);
      }
    }
  }
});
