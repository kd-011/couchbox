// Contract test: every folder in games/ (plus the _example) must load,
// validate, and survive a long random bot-played session in both modes and
// both variants without errors, illegal bot moves or non-JSON views.
// A new game gets this coverage for free. See docs/GAME-MODULES.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGame } from '../lib/registry.mjs';
import * as rt from '../games/_kit/runtime.js';

const GAMES_DIR = fileURLToPath(new URL('../games', import.meta.url));
// GAMES_ONLY=imposter,heads npm test  runs the contract for just those games.
const only = (process.env.GAMES_ONLY || '').split(',').filter(Boolean);
const ids = readdirSync(GAMES_DIR)
  .filter((n) => n !== '_kit' && !n.startsWith('.') && statSync(join(GAMES_DIR, n)).isDirectory())
  .filter((n) => !only.length || only.includes(n));

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ['Ava', 'Ben', 'Cat', 'Dev', 'Eli', 'Fin', 'Gus', 'Hana', 'Ivy', 'Jay', 'Kit', 'Leo', 'Mia', 'Ned', 'Oli', 'Pip'];

function jsonSafe(v, where) {
  const s = JSON.stringify(v);
  assert.ok(s !== undefined, `${where} must be JSON-serialisable`);
  assert.deepEqual(JSON.parse(s), v, `${where} must survive JSON round-trip`);
  assert.ok(s.length < 64_000, `${where} is ${s.length} bytes; keep views small`);
}

for (const id of ids) {
  test(`${id}: loads and validates`, async () => {
    await loadGame(GAMES_DIR, id);
  });

  for (const mode of ['pass', 'room']) {
    for (const variant of rt.VARIANTS) {
      test(`${id}: ${mode}/${variant} survives 400 bot steps`, async () => {
        const g = await loadGame(GAMES_DIR, id);
        const m = g.engine.meta;
        if (!(m.modes || ['pass', 'room']).includes(mode)) return;
        const rng = seeded(id.length * 1000 + mode.length * 10 + variant.length);
        const n = Math.min(m.maxPlayers, Math.max(m.minPlayers, 4));
        const players = NAMES.slice(0, n).map((name, i) => ({ id: `p${i}`, name, color: '#ff6b6b' }));
        let now = 1_700_000_000_000;
        const ctx = () => ({ players, content: g.content, rng, now });
        const created = rt.createGame(g.engine, { players, variant, mode, options: {}, content: g.content, rng, now });
        assert.ok(!created.error, created.error);
        let state = created.state;
        assert.equal(typeof state.phase, 'string', 'state.phase must be a string');
        assert.ok(Array.isArray(state.players), 'state.players must be an array of { id, ... }');

        // Too few players is refused, not crashed.
        if (m.minPlayers > 1) {
          const few = rt.createGame(g.engine, { players: players.slice(0, m.minPlayers - 1), variant, mode, options: {}, content: g.content, rng, now });
          assert.ok(few.error, 'createGame must refuse too few players');
        }

        const phases = new Set([state.phase]);
        for (let step = 0; step < 400; step++) {
          // Deadly runs: the host drops the tier halfway, then someone goes out.
          if (variant === 'deadly' && step === 200) state = rt.withDrinkPatch(state, { tier: rng() < 0.5 ? 'drinking' : 'standard' });
          if (variant === 'deadly' && step === 120) state = rt.withDrinkPatch(state, { out: ['p1', true] });
          // Views and actions must be valid at every step.
          for (const p of players) jsonSafe(rt.playerViewOf(g.engine, state, p.id, ctx()), `${id} playerView`);
          jsonSafe(rt.playerViewOf(g.engine, state, 'late-joiner', ctx()), `${id} playerView for a non-player`);
          jsonSafe(rt.tvViewOf(g.engine, state, ctx()), `${id} tvView`);
          const hostActs = rt.hostActionsOf(g.engine, state, ctx());
          jsonSafe(hostActs, `${id} hostActions`);
          for (const a of hostActs) assert.ok(a.label, `host action ${a.type} needs a label`);
          if (mode === 'pass') {
            const turn = rt.passTurnOf(g.engine, state, ctx());
            assert.ok(turn === null || players.some((p) => p.id === turn), 'passTurn must be null or a player id');
          }

          // Pick someone to move: in pass mode the private-turn player or the
          // shared screen (host); in room mode any player or the host.
          const candidates = [];
          if (mode === 'pass') {
            const turn = rt.passTurnOf(g.engine, state, ctx());
            if (turn) candidates.push(turn);
            else candidates.push(null);
          } else {
            candidates.push(null, ...players.map((p) => p.id));
          }
          const moves = [];
          for (const who of candidates) {
            const a = g.engine.bot(state, who, ctx());
            if (a) moves.push({ who, a });
          }
          const d = rt.deadlineOf(g.engine, state);
          if (!moves.length || (d && rng() < 0.15)) {
            if (!d) assert.fail(`${id} ${mode}/${variant} stuck in phase ${state.phase}: no bot move and no deadline`);
            now = Math.max(now, d.at);
            state = rt.runDeadlines(g.engine, state, ctx());
          } else {
            const { who, a } = moves[Math.floor(rng() * moves.length)];
            const hostSeat = who === null || who === 'p0';
            const r = rt.applyAction(g.engine, state, { type: a.type, payload: a.payload ?? null, from: who === null ? (mode === 'room' ? 'p0' : null) : who, host: hostSeat }, ctx());
            assert.ok(!r.error, `${id} ${mode}/${variant}: bot move ${JSON.stringify(a)} by ${who} rejected in ${state.phase}: ${r.error} ${r.detail || ''}`);
            state = r.state;
            now += 500;
          }
          phases.add(state.phase);
        }
        assert.ok(phases.size >= 2, `${id} never left phase ${[...phases][0]}`);
        // The drink ledger survives and stays sane.
        jsonSafe(state.$drink, `${id} drink ledger`);
        for (const [pid, t] of Object.entries(state.$drink.tally)) {
          for (const k of ['sips', 'shots', 'gives', 'forfeits']) assert.ok(t[k] >= 0, `${id}: ${pid} ${k} negative`);
          if (variant === 'standard') assert.equal(t.sips + t.shots, 0, `${id}: Standard must not record drinks`);
        }
        if (state.$over) {
          assert.ok(Array.isArray(state.$over.board), `${id}: gameOver board must be an array`);
          for (const r of state.$over.board) assert.ok(players.some((p) => p.id === r.id) || r.id, `${id}: board rows need ids`);
        }
        for (const [pid, s] of Object.entries(state.$stats || {})) {
          for (const [k, v] of Object.entries(s)) assert.ok(Number.isFinite(v) && v >= 0, `${id}: stat ${pid}.${k} must be a non-negative number`);
        }

        // Roster hooks, if present, must not throw and must leave valid views.
        const late = { id: 'late', name: 'Late', color: '#ffffff' };
        const s2 = structuredClone(state);
        if (g.engine.addPlayer) g.engine.addPlayer(s2, late, { ...ctx(), players: [...players, late] });
        jsonSafe(rt.tvViewOf(g.engine, s2, ctx()), `${id} tvView after addPlayer`);
        jsonSafe(rt.playerViewOf(g.engine, s2, 'late', ctx()), `${id} playerView for the late joiner`);
        if (g.engine.removePlayer) g.engine.removePlayer(s2, 'p1', ctx());
        jsonSafe(rt.tvViewOf(g.engine, s2, ctx()), `${id} tvView after removePlayer`);
        for (const p of players) jsonSafe(rt.playerViewOf(g.engine, s2, p.id, ctx()), `${id} playerView after removePlayer`);
      });
    }
  }
}
