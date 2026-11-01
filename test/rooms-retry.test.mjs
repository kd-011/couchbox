// A tap sent just as the connection died is re-sent by the client on the new
// socket (public/js/net.js). The server must treat the repeat as the same tap:
// answer it again, never apply it twice. Keyed by a client-made `rid`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { RoomManager } from '../lib/rooms.mjs';
import { loadGames } from '../lib/registry.mjs';

const games = await loadGames(fileURLToPath(new URL('../games', import.meta.url)), { strict: true });

let seq = 0;
function client(rooms) {
  const c = { inbox: [] };
  c.handle = rooms.connect({ send: (m) => c.inbox.push(structuredClone(m)), close() {} });
  c.send = (m) => { const id = ++seq; c.handle.message({ ...m, id }); return c.inbox.findLast((x) => x.id === id); };
  c.state = () => c.inbox.findLast((m) => m.t === 'state');
  return c;
}

function mltRound() {
  const rooms = new RoomManager({ games, now: () => 1_000_000, timers: { set: () => 0, clear() {} }, rng: Math.random });
  const host = client(rooms);
  host.send({ t: 'create', name: 'Ana', gameId: 'mlt', variant: 'standard' });
  const code = host.inbox.find((m) => m.t === 'joined').code;
  const others = ['Ben', 'Cy'].map((name) => { const c = client(rooms); c.send({ t: 'join', code, name }); return c; });
  assert.equal(host.send({ t: 'host', op: 'start' }).t, 'ack');
  const everyone = [host, ...others];
  for (const c of everyone) {
    const v = c.state().view;
    c.send({ t: 'act', type: 'vote', payload: v.players.find((id) => id !== v.me) });
  }
  assert.equal(host.state().view.phase, 'reveal');
  return { rooms, host, everyone };
}

test('a re-sent act with the same rid is acknowledged again but applied once', () => {
  const { host } = mltRound();
  const round = () => host.state().view.round;
  const before = round();
  const first = host.send({ t: 'act', type: 'next', payload: null, rid: 'tap-1' });
  assert.equal(first.t, 'ack');
  assert.equal(round(), before + 1);
  const seqAfter = host.state().seq;
  // The ack never reached the phone; it sends the same tap again.
  const again = host.send({ t: 'act', type: 'next', payload: null, rid: 'tap-1' });
  assert.equal(again.t, 'ack', 'the repeat gets the original answer');
  assert.equal(round(), before + 1, 'and does not skip another prompt');
  assert.equal(host.state().seq, seqAfter, 'and does not broadcast again');
});

test('a different rid, or none, is a new tap', () => {
  const { host } = mltRound();
  assert.equal(host.send({ t: 'act', type: 'next', payload: null, rid: 'a' }).t, 'ack');
  // New prompt is in the vote phase, so a second Next is a real, rejected move.
  assert.equal(host.send({ t: 'act', type: 'next', payload: null, rid: 'b' }).t, 'error');
  assert.equal(host.send({ t: 'act', type: 'next', payload: null }).t, 'error');
});

test('rids are per player: two phones using the same rid do not collide', () => {
  const { everyone } = mltRound();
  const [host, ben] = everyone;
  assert.equal(host.send({ t: 'act', type: 'next', payload: null, rid: 'x' }).t, 'ack');
  // Ben is not the host: his Next is refused even though 'x' was already used by someone else.
  assert.equal(ben.send({ t: 'act', type: 'next', payload: null, rid: 'x' }).t, 'error');
});

test('a junk rid is ignored, not trusted', () => {
  const { host } = mltRound();
  assert.equal(host.send({ t: 'act', type: 'next', payload: null, rid: { evil: true } }).t, 'ack');
  assert.equal(host.send({ t: 'act', type: 'next', payload: null, rid: { evil: true } }).t, 'error');
  assert.equal(host.send({ t: 'act', type: 'next', payload: null, rid: 'x'.repeat(500) }).t, 'error');
});
