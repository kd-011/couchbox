// Curated packs in rooms and in pass and play: the host picks a built-in
// themed pack by its curated code (c:<id>), the server validates it like a
// custom pack code, and the deck the game actually deals from is the pack's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { RoomManager } from '../lib/rooms.mjs';
import { loadGames } from '../lib/registry.mjs';
import { curatedBundle } from '../lib/curated.mjs';
import * as rt from '../games/_kit/runtime.js';

const GAMES_DIR = fileURLToPath(new URL('../games', import.meta.url));
const games = await loadGames(GAMES_DIR, { strict: true });

let seq = 0;
function client(rooms) {
  const c = { inbox: [] };
  c.handle = rooms.connect({ send: (m) => c.inbox.push(structuredClone(m)), close: () => {} });
  c.send = (m) => { const id = ++seq; c.handle.message({ ...m, id }); return c.inbox.findLast((x) => x.id === id); };
  c.last = (t) => c.inbox.findLast((m) => m.t === t);
  c.state = () => c.last('state');
  return c;
}

const firstPack = (gameId) => [...games.get(gameId).curated.values()][0];
const samePair = (x, y) => x.a === y.a && x.b === y.b;

// No custom-pack store at all: curated packs ship with the code, so they
// must work even where lib/packs.mjs is not wired in.
function roomsNoStore() { return new RoomManager({ games, now: () => 1_000_000, rng: Math.random }); }

test('a room created with a curated pack deals from that pack', () => {
  const rooms = roomsNoStore();
  const p = firstPack('wyr');
  const host = client(rooms);
  const r = host.send({ t: 'create', name: 'Host', gameId: 'wyr', variant: 'standard', packCode: p.code });
  assert.equal(r.t, 'ack', JSON.stringify(r));
  const info = host.state().room.pack;
  assert.equal(info.code, p.code);
  assert.equal(info.title, p.title);
  assert.equal(info.curated, true);
  assert.equal(info.emoji, p.emoji);
  const code = host.last('joined').code;
  client(rooms).send({ t: 'join', code, name: 'Sam' });
  host.send({ t: 'host', op: 'start' });
  // Several rounds, every pair from the pack, none from the built-in deck.
  const room = rooms.rooms.get(code);
  const engine = games.get('wyr').engine;
  for (let i = 0; i < 4; i++) {
    assert.ok(p.content.pairs.some((x) => samePair(x, room.state.pair)), `pair ${JSON.stringify(room.state.pair)} is not from ${p.id}`);
    for (const type of ['reveal', 'next']) {
      const r = rt.applyAction(engine, room.state, { type, payload: null, from: null, host: true }, rooms.ctx(room));
      assert.ok(!r.error, r.error);
      room.state = r.state;
    }
  }
});

test('a category game plays only the curated pack\'s categories', () => {
  const rooms = roomsNoStore();
  const p = firstPack('imposter');
  const host = client(rooms);
  host.send({ t: 'create', name: 'Host', gameId: 'imposter', variant: 'standard', packCode: p.code });
  const code = host.last('joined').code;
  client(rooms).send({ t: 'join', code, name: 'Sam' });
  client(rooms).send({ t: 'join', code, name: 'Kit' });
  host.send({ t: 'host', op: 'start' });
  const st = rooms.rooms.get(code).state;
  const labels = Object.values(p.content.categories).map((c) => c.label);
  assert.ok(labels.includes(st.category.label), `${st.category.label} not in ${labels}`);
  const words = Object.values(p.content.categories).flatMap((c) => c.items);
  assert.ok(words.includes(st.word));
});

test('a game without custom packs still takes a curated pack (quiz show)', () => {
  const rooms = roomsNoStore();
  const p = firstPack('quiz-show');
  const host = client(rooms);
  const r = host.send({ t: 'create', name: 'Host', gameId: 'quiz-show', variant: 'standard', packCode: p.code });
  assert.equal(r.t, 'ack', JSON.stringify(r));
  const code = host.last('joined').code;
  client(rooms).send({ t: 'join', code, name: 'Sam' });
  host.send({ t: 'host', op: 'start' });
  const st = rooms.rooms.get(code).state;
  const packLabels = Object.values(p.content.categories).map((c) => c.label);
  for (const tile of st.board.filter((t) => t.type !== 'emoji')) assert.ok(packLabels.includes(tile.label), `${tile.label} not from ${p.id}`);
});

test('an unknown or foreign curated id is rejected at create and in the lobby', () => {
  const rooms = roomsNoStore();
  const host = client(rooms);
  const bad = host.send({ t: 'create', name: 'Host', gameId: 'wyr', variant: 'standard', packCode: 'c:no-such-pack' });
  assert.equal(bad.t, 'error');
  const foreign = host.send({ t: 'create', name: 'Host', gameId: 'wyr', variant: 'standard', packCode: firstPack('nhie').code });
  // Pack ids are per game: an nhie pack id only counts if wyr has one of the same id.
  if (!games.get('wyr').curated.has(firstPack('nhie').id)) assert.equal(foreign.t, 'error');
  const weird = host.send({ t: 'create', name: 'Host', gameId: 'wyr', variant: 'standard', packCode: { evil: true } });
  assert.equal(weird.t, 'error');
  const ok = host.send({ t: 'create', name: 'Host', gameId: 'wyr', variant: 'standard' });
  assert.equal(ok.t, 'ack');
  const lobbyBad = host.send({ t: 'host', op: 'setPack', packCode: 'c:../../etc' });
  assert.equal(lobbyBad.t, 'error');
});

test('the lobby can switch to a curated pack, and the choice is kept per game', () => {
  const rooms = roomsNoStore();
  const host = client(rooms);
  host.send({ t: 'create', name: 'Host', gameId: 'wyr', variant: 'standard' });
  assert.equal(host.state().room.pack, null);
  const wp = firstPack('wyr');
  assert.equal(host.send({ t: 'host', op: 'setPack', packCode: wp.code }).t, 'ack');
  assert.equal(host.state().room.pack.code, wp.code);
  host.send({ t: 'host', op: 'setGame', gameId: 'mlt' });
  assert.equal(host.state().room.pack, null, 'mlt has its own (empty) choice');
  const mp = firstPack('mlt');
  host.send({ t: 'host', op: 'setPack', packCode: mp.code });
  host.send({ t: 'host', op: 'setGame', gameId: 'wyr' });
  assert.equal(host.state().room.pack.code, wp.code, 'wyr kept its pack');
  host.send({ t: 'host', op: 'setPack', packCode: null });
  assert.equal(host.state().room.pack, null, 'back to the built-in deck');
});

test('Party Night: each queued game plays its own curated pack', () => {
  const rooms = roomsNoStore();
  const host = client(rooms);
  host.send({ t: 'create', name: 'Host', gameId: 'mlt', variant: 'standard' });
  const code = host.last('joined').code;
  client(rooms).send({ t: 'join', code, name: 'Sam' });
  client(rooms).send({ t: 'join', code, name: 'Kit' });
  const room = rooms.rooms.get(code);
  // Set wyr's pack in the lobby first, then go back to mlt with its own pack.
  const wp = firstPack('wyr');
  const mp = firstPack('mlt');
  host.send({ t: 'host', op: 'setGame', gameId: 'wyr' });
  host.send({ t: 'host', op: 'setPack', packCode: wp.code });
  host.send({ t: 'host', op: 'setGame', gameId: 'mlt' });
  host.send({ t: 'host', op: 'setPack', packCode: mp.code });
  assert.equal(host.send({ t: 'host', op: 'queueAdd', gameId: 'wyr' }).t, 'ack');
  host.send({ t: 'host', op: 'start' });
  assert.ok(mp.content.prompts.includes(room.state.prompt), `mlt prompt ${room.state.prompt} not from ${mp.id}`);
  assert.equal(host.send({ t: 'host', op: 'standings' }).t, 'ack');
  assert.equal(host.state().room.pack.code, wp.code, 'between games the lined-up game shows its own pack');
  assert.equal(host.send({ t: 'host', op: 'next' }).t, 'ack');
  assert.equal(room.gameId, 'wyr');
  assert.ok(wp.content.pairs.some((x) => samePair(x, room.state.pair)), 'the second game of the night deals from its own pack');
});

/* pass and play: the same path the browser runs */

test('pass and play: a curated pack from the bundle becomes the game\'s content', () => {
  for (const id of ['wyr', 'imposter', 'tod', 'quiz-show', 'spyfall']) {
    const g = games.get(id);
    // What /games/<id>/packs.json delivers to the phone (and the service worker caches).
    const bundle = JSON.parse(JSON.stringify(curatedBundle(g)));
    const pick = bundle.packs[0];
    const content = rt.withCurated(g.engine, g.content, pick.content);
    const n = Math.max(g.engine.meta.minPlayers, 4);
    const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, color: '#fff' }));
    const r = rt.createGame(g.engine, { players, variant: 'standard', mode: 'pass', options: {}, content, rng: Math.random, now: 1 });
    assert.ok(!r.error, `${id}: ${r.error}`);
    if (id === 'wyr') assert.ok(pick.content.pairs.some((x) => samePair(x, r.state.pair)));
    if (id === 'imposter') assert.ok(Object.values(pick.content.categories).some((c) => c.items.includes(r.state.word)));
    if (id === 'spyfall') assert.ok(pick.content.locations.some((l) => l.key === r.state.location.key), `spyfall location ${r.state.location.key}`);
    for (const k of Object.keys(pick.content)) assert.deepEqual(content[k], pick.content[k], `${id}: ${k} must come from the pack`);
  }
});
