// Teams and audience: a second, shorter bot session in room mode for every
// game that declares meta.teams / meta.audience, with teams set up and extra
// players over the cap watching as audience. See docs/GAME-MODULES.md,
// "Teams and audience". test/contract.test.mjs already covers every game
// with ctx.teams/ctx.audience null (no teams, nobody over the cap); this
// file is the "declare support" half of the contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGame } from '../lib/registry.mjs';
import * as rt from '../games/_kit/runtime.js';
import { TEAM_COLORS } from '../games/_kit/palette.js';

const GAMES_DIR = fileURLToPath(new URL('../games', import.meta.url));
const ids = readdirSync(GAMES_DIR)
  .filter((n) => n !== '_kit' && !n.startsWith('.') && statSync(join(GAMES_DIR, n)).isDirectory());

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
  test(`${id}: teams/audience contract`, async () => {
    const g = await loadGame(GAMES_DIR, id);
    const m = g.engine.meta;
    if (!m.teams && !m.audience) return; // nothing to exercise here

    for (const variant of ['drinking', 'deadly']) {
      const rng = seeded(id.length * 97 + variant.length * 13);
      const activeN = Math.min(m.maxPlayers, Math.max(m.minPlayers, 4));
      const overflowN = m.audience ? Math.min(2, 24 - activeN) : 0;
      const all = NAMES.slice(0, activeN + overflowN).map((name, i) => ({ id: `p${i}`, name, color: '#ff6b6b' }));
      const players = all.slice(0, activeN);
      const audience = overflowN ? all.slice(activeN) : null;
      let teams = null;
      if (m.teams) {
        const half = Math.ceil(players.length / 2);
        teams = [
          { id: 't1', name: 'Team Red', color: TEAM_COLORS[0], memberIds: players.slice(0, half).map((p) => p.id) },
          { id: 't2', name: 'Team Blue', color: TEAM_COLORS[1], memberIds: players.slice(half).map((p) => p.id) },
        ].filter((t) => t.memberIds.length);
        if (teams.length < 2) teams = null;
      }
      let now = 1_700_000_000_000;
      const ctx = () => ({ players, content: g.content, rng, now });
      const created = rt.createGame(g.engine, {
        players, variant, mode: 'room', options: {}, content: g.content, rng, now, teams, audience,
      });
      assert.ok(!created.error, `${id} ${variant}: ${created.error}`);
      let state = created.state;
      const allIds = all.map((p) => p.id);
      const hostId = players[0].id;

      for (let step = 0; step < 300; step++) {
        if (variant === 'deadly' && step === 150) state = rt.withDrinkPatch(state, { out: [hostId, true] });
        for (const p of all) jsonSafe(rt.playerViewOf(g.engine, state, p.id, ctx()), `${id} playerView ${p.id}`);
        jsonSafe(rt.tvViewOf(g.engine, state, ctx()), `${id} tvView`);
        const hostActs = rt.hostActionsOf(g.engine, state, ctx());
        jsonSafe(hostActs, `${id} hostActions`);

        const moves = [];
        for (const who of [null, ...allIds]) {
          const a = g.engine.bot(state, who, ctx());
          if (a) moves.push({ who, a });
        }
        const d = rt.deadlineOf(g.engine, state);
        if (!moves.length || (d && rng() < 0.15)) {
          if (!d) assert.fail(`${id} ${variant} (teams/audience) stuck in phase ${state.phase}: no bot move and no deadline`);
          now = Math.max(now, d.at);
          state = rt.runDeadlines(g.engine, state, ctx());
        } else {
          const { who, a } = moves[Math.floor(rng() * moves.length)];
          const from = who === null ? hostId : who;
          const r = rt.applyAction(g.engine, state, { type: a.type, payload: a.payload ?? null, from, host: from === hostId }, ctx());
          assert.ok(!r.error, `${id} ${variant} (teams/audience): bot move ${JSON.stringify(a)} by ${who} rejected in ${state.phase}: ${r.error} ${r.detail || ''}`);
          state = r.state;
          now += 500;
        }
      }

      jsonSafe(state.$drink, `${id} drink ledger`);
      if (audience) {
        for (const p of audience) {
          assert.ok(!(state.players || []).some((x) => x.id === p.id), `${id}: audience member ${p.id} must never enter state.players`);
        }
      }
      if (teams) jsonSafe(state.teams, `${id} state.teams`);
    }
  });
}
