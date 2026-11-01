// The QA hook e2e/matrix.mjs uses to read a room's real state exposes every
// secret in the room, so it must only exist when GAMES_TEST_HOOKS=1, and it
// must do what the matrix relies on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RoomManager } from '../lib/rooms.mjs';
import { loadGames } from '../lib/registry.mjs';
import { makeTestHooks } from '../lib/testhooks.mjs';

const games = await loadGames(fileURLToPath(new URL('../games', import.meta.url)), { strict: true });

test('server.mjs only wires the test hook behind GAMES_TEST_HOOKS=1', () => {
  const src = readFileSync(fileURLToPath(new URL('../server.mjs', import.meta.url)), 'utf8');
  assert.match(src, /process\.env\.GAMES_TEST_HOOKS === '1' \? makeTestHooks\(/);
  assert.equal((src.match(/makeTestHooks\(/g) || []).length, 1);
});

test('the hook reads state, fires a deadline and makes a move', async () => {
  const rooms = new RoomManager({ games, now: () => 1_000_000, timers: { set: () => 0, clear: () => {} } });
  const conns = [0, 1, 2].map(() => { const c = { inbox: [] }; c.h = rooms.connect({ send: (m) => c.inbox.push(m), close() {} }); return c; });
  conns[0].h.message({ t: 'create', name: 'Ana', gameId: 'imposter', variant: 'standard', id: 1 });
  const code = conns[0].inbox.find((m) => m.t === 'joined').code;
  conns[1].h.message({ t: 'join', code, name: 'Ben', id: 2 });
  conns[2].h.message({ t: 'join', code, name: 'Cy', id: 3 });
  conns[0].h.message({ t: 'host', op: 'start', id: 4 });
  const hook = makeTestHooks({ rooms, games });
  const call = (path, method = 'GET', body = null) => new Promise((resolve) => {
    const res = {};
    const sendJson = (_r, status, json) => resolve({ status, json });
    const req = { method };
    const readBody = (_req, _max, cb) => cb(null, body);
    assert.equal(hook(req, res, path, sendJson, readBody), true);
  });
  assert.equal(hook({ method: 'GET' }, {}, '/__test/other', () => {}, () => {}), false);
  const snap = await call(`/__test/room/${code}`);
  assert.equal(snap.status, 200);
  assert.equal(snap.json.state.phase, 'reveal');
  const ben = snap.json.players.find((p) => p.name === 'Ben').id;
  const r = await call(`/__test/room/${code}/act`, 'POST', { playerId: ben, type: 'seen', payload: null });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(rooms.rooms.get(code).state.seen[ben]);
  const bad = await call(`/__test/room/${code}/act`, 'POST', { playerId: ben, type: 'nonsense', payload: null });
  assert.equal(bad.status, 400);
  assert.equal((await call('/__test/room/ZZZZ')).status, 404);
});
