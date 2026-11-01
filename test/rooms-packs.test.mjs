// Custom packs inside a running room: create with a pack, switch games
// (the pack choice is per-game, like options), change pack from the lobby,
// a bad/foreign pack code is rejected up front rather than degrading quietly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoomManager } from '../lib/rooms.mjs';
import { makePacks } from '../lib/packs.mjs';
import { loadGames } from '../lib/registry.mjs';

const GAMES_DIR = fileURLToPath(new URL('../games', import.meta.url));
const games = await loadGames(GAMES_DIR, { strict: true });

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'games-rooms-packs-'));
  const packs = makePacks({ dir, games, log: () => {} });
  const rooms = new RoomManager({ games, packs, now: () => 1_000_000, rng: Math.random });
  return { rooms, packs, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

let seq = 0;
function client(rooms) {
  const c = { inbox: [] };
  c.handle = rooms.connect({ send: (m) => c.inbox.push(structuredClone(m)), close: () => {} });
  c.send = (m) => { const id = ++seq; c.handle.message({ ...m, id }); return c.inbox.findLast((x) => x.id === id); };
  c.last = (t) => c.inbox.findLast((m) => m.t === t);
  c.state = () => c.last('state');
  return c;
}

const WORDS = (n, prefix = 'w') => Array.from({ length: n }, (_, i) => ({ category: '', word: `${prefix}${i}` }));

test('a room can be created with a pack, and its content replaces the built-in deck', () => {
  const { rooms, packs, cleanup } = setup();
  try {
    const pairs = [{ a: 'zzOptionA', b: 'zzOptionB' }, { a: 'zz2A', b: 'zz2B' }, { a: 'zz3A', b: 'zz3B' }, { a: 'zz4A', b: 'zz4B' }, { a: 'zz5A', b: 'zz5B' }, { a: 'zz6A', b: 'zz6B' }];
    const made = packs.create({ ip: '1.1.1.1', gameId: 'wyr', title: 'My pairs', items: pairs });
    const host = client(rooms);
    const r = host.send({ t: 'create', name: 'Host', gameId: 'wyr', variant: 'standard', packCode: made.pack.code });
    assert.equal(r.t, 'ack', JSON.stringify(r));
    assert.equal(host.state().room.pack.code, made.pack.code);
    assert.equal(host.state().room.pack.title, 'My pairs');
    const code = host.last('joined').code;
    client(rooms).send({ t: 'join', code, name: 'Sam' });
    host.send({ t: 'host', op: 'start' });
    const view = host.state().view;
    assert.ok(view.pair.a.startsWith('zz'));
  } finally { cleanup(); }
});

test('a bad or foreign pack code is rejected at create time', () => {
  const { rooms, packs, cleanup } = setup();
  try {
    const made = packs.create({ ip: '1.1.1.1', gameId: 'wyr', title: 'Pairs', items: [{ a: 'A', b: 'B' }, { a: 'C', b: 'D' }, { a: 'E', b: 'F' }, { a: 'G', b: 'H' }, { a: 'I', b: 'J' }, { a: 'K', b: 'L' }] });
    const host = client(rooms);
    const wrongGame = host.send({ t: 'create', name: 'Host', gameId: 'imposter', variant: 'standard', packCode: made.pack.code });
    assert.equal(wrongGame.t, 'error');
    const unknown = host.send({ t: 'create', name: 'Host', gameId: 'imposter', variant: 'standard', packCode: 'nosuchcode' });
    assert.equal(unknown.t, 'error');
    const noPackSupport = host.send({ t: 'create', name: 'Host', gameId: 'quiz-show', variant: 'standard', packCode: made.pack.code });
    assert.equal(noPackSupport.t, 'error');
  } finally { cleanup(); }
});

test('setPack changes the lobby pack, remembered per game like options', () => {
  const { rooms, packs, cleanup } = setup();
  try {
    const packA = packs.create({ ip: '1.1.1.1', gameId: 'imposter', title: 'A', items: WORDS(8, 'aa') });
    const packB = packs.create({ ip: '1.1.1.1', gameId: 'nhie', title: 'B', items: Array.from({ length: 8 }, (_, i) => ({ prompt: `done thing ${i}` })) });
    const host = client(rooms);
    host.send({ t: 'create', name: 'Host', gameId: 'imposter', variant: 'standard' });
    assert.equal(host.state().room.pack, null);
    const set = host.send({ t: 'host', op: 'setPack', packCode: packA.pack.code });
    assert.equal(set.t, 'ack', JSON.stringify(set));
    assert.equal(host.state().room.pack.code, packA.pack.code);
    // Switch games: imposter's pack choice is parked, nhie starts with none.
    host.send({ t: 'host', op: 'setGame', gameId: 'nhie' });
    assert.equal(host.state().room.pack, null);
    host.send({ t: 'host', op: 'setPack', packCode: packB.pack.code });
    assert.equal(host.state().room.pack.code, packB.pack.code);
    // Back to imposter: its own pack choice is still remembered.
    host.send({ t: 'host', op: 'setGame', gameId: 'imposter' });
    assert.equal(host.state().room.pack.code, packA.pack.code);
  } finally { cleanup(); }
});

test('setPack(null) goes back to the built-in deck', () => {
  const { rooms, packs, cleanup } = setup();
  try {
    const pairs = [{ a: 'zzOptionA', b: 'zzOptionB' }, { a: 'zz2A', b: 'zz2B' }, { a: 'zz3A', b: 'zz3B' }, { a: 'zz4A', b: 'zz4B' }, { a: 'zz5A', b: 'zz5B' }, { a: 'zz6A', b: 'zz6B' }];
    const made = packs.create({ ip: '1.1.1.1', gameId: 'wyr', title: 'Custom', items: pairs });
    const host = client(rooms);
    host.send({ t: 'create', name: 'Host', gameId: 'wyr', variant: 'standard', packCode: made.pack.code });
    const code = host.last('joined').code;
    client(rooms).send({ t: 'join', code, name: 'Sam' });
    host.send({ t: 'host', op: 'setPack', packCode: null });
    assert.equal(host.state().room.pack, null);
    host.send({ t: 'host', op: 'start' });
    assert.ok(!host.state().view.pair.a.startsWith('zz'));
  } finally { cleanup(); }
});

test('a RoomManager with no packs module still works (packCode is simply refused)', () => {
  const rooms = new RoomManager({ games, now: () => 1_000_000 });
  const host = client(rooms);
  const plain = host.send({ t: 'create', name: 'Host', gameId: 'imposter', variant: 'standard' });
  assert.equal(plain.t, 'ack');
  const withPack = host.send({ t: 'create', name: 'Host2', gameId: 'imposter', variant: 'standard', packCode: 'anything1' });
  assert.equal(withPack.t, 'error');
});
