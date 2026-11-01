// Host Box device pairing and the button/scene/audio fan-out, driven
// through lib/rooms.mjs's real wire protocol (fake connections, no socket).
// docs/HOSTBOX-PROTOCOL.md. lib/hostbox.mjs and lib/voice.mjs have their own
// pure-function unit tests; this file is about the wiring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { RoomManager } from '../lib/rooms.mjs';
import { loadGames } from '../lib/registry.mjs';

const GAMES_DIR = fileURLToPath(new URL('../games', import.meta.url));
const games = await loadGames(GAMES_DIR, { strict: true });

function fakeTime() {
  let t = 1_000_000;
  let seq = 0;
  const jobs = new Map();
  return {
    now: () => t,
    timers: {
      set(fn, ms) { const id = ++seq; jobs.set(id, { at: t + ms, fn }); return id; },
      clear(id) { jobs.delete(id); },
    },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = [...jobs.entries()].filter(([, j]) => j.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        jobs.delete(due[0]);
        t = due[1].at;
        due[1].fn();
      }
      t = end;
    },
  };
}

function setup(opts = {}) {
  const clock = fakeTime();
  const spoken = []; // every line the room asked to have rendered, in order
  const speak = opts.speak || (async (text) => { spoken.push(text); return `/hostbox/voice/${encodeURIComponent(text)}.wav`; });
  const rooms = new RoomManager({ games, now: clock.now, timers: clock.timers, rng: Math.random, speak, ...opts });
  return { rooms, clock, spoken };
}

// announce() is fire-and-forget (lib/rooms.mjs never blocks an action on
// Kokoro), so a test that checks for an 'audio' message has to let that
// promise chain's microtask actually run first.
const flush = () => new Promise((r) => setImmediate(r));

let seq = 0;
function client(rooms) {
  const c = { inbox: [], closed: false };
  c.handle = rooms.connect({ send: (m) => c.inbox.push(structuredClone(m)), close: () => { c.closed = true; } });
  c.send = (m) => { const id = ++seq; c.handle.message({ ...m, id }); return c.inbox.findLast((x) => x.id === id); };
  c.last = (t) => c.inbox.findLast((m) => m.t === t);
  c.all = (t) => c.inbox.filter((m) => m.t === t);
  c.state = () => c.last('state');
  c.drop = () => c.handle.close();
  return c;
}

function createRoom(rooms, name = 'Host', gameId = 'imposter', variant = 'standard') {
  const host = client(rooms);
  const r = host.send({ t: 'create', name, gameId, variant });
  assert.equal(r.t, 'ack', JSON.stringify(r));
  const joined = host.last('joined');
  return { host, code: joined.code, hostCreds: joined };
}

function joinRoom(rooms, code, name) {
  const c = client(rooms);
  const r = c.send({ t: 'join', code, name });
  assert.equal(r.t, 'ack', JSON.stringify(r));
  c.creds = c.last('joined');
  return c;
}

// A fresh virtual box that has said hello with no code: waiting to be
// claimed by a host's pairBox from the lobby.
function freeBox(rooms, boxId = `box${++seq}`) {
  const c = client(rooms);
  const r = c.send({ t: 'device', boxId });
  assert.equal(r.t, 'ack', JSON.stringify(r));
  c.boxId = boxId;
  return c;
}

test('a box waits unpaired until a host claims it by ID', () => {
  const { rooms } = setup();
  const { host, code } = createRoom(rooms);
  const box = freeBox(rooms);
  assert.equal(box.last('paired'), undefined);
  const bad = host.send({ t: 'host', op: 'pairBox', boxId: 'nopenope' });
  assert.equal(bad.code, 'notfound');
  const r = host.send({ t: 'host', op: 'pairBox', boxId: box.boxId });
  assert.equal(r.t, 'ack', JSON.stringify(r));
  const paired = box.last('paired');
  assert.equal(paired.code, code);
  assert.equal(host.state().room.box.connected, true);
});

test('only the host can pair or unpair a box', () => {
  const { rooms } = setup();
  const { code } = createRoom(rooms);
  const sam = joinRoom(rooms, code, 'Sam');
  const box = freeBox(rooms);
  assert.equal(sam.send({ t: 'host', op: 'pairBox', boxId: box.boxId }).code, 'nothost');
});

test('a bad or unknown Host Box ID is a clear error, never a crash', () => {
  const { rooms } = setup();
  const { host } = createRoom(rooms);
  assert.equal(host.send({ t: 'host', op: 'pairBox', boxId: '!!' }).code, 'bad');
  assert.equal(host.send({ t: 'host', op: 'pairBox', boxId: 'ZZZZZZ' }).code, 'notfound');
});

test('SECURITY: knowing only the room code (no prior pairBox approval) must never attach a box', () => {
  // The room code is shared broadly (QR code, invite link) so strangers can
  // join as a player; it must never, by itself, grant Host Box trust (host
  // actions: start/standings/next, plus passing host on long-press). A
  // client that only knows the code and makes up a boxId must be left
  // waiting, exactly like a box with no code at all.
  const { rooms } = setup();
  const { host, code } = createRoom(rooms);
  const attacker = client(rooms);
  const r = attacker.send({ t: 'device', boxId: 'ATTACKR', code });
  assert.equal(r.t, 'ack', 'the hello itself is not an error...');
  assert.equal(attacker.last('paired'), undefined, '...but it must not be paired');
  assert.equal(rooms.rooms.get(code).box, null, 'the room must still have no box attached');
  // Confirms it really did land in pendingBoxes, not silently dropped: the
  // host can now legitimately claim it from the lobby.
  assert.equal(host.send({ t: 'host', op: 'pairBox', boxId: 'ATTACKR' }).t, 'ack');
  assert.equal(attacker.last('paired').code, code);
});

test('a room code is a noroom error when the room genuinely does not exist, before any approval question arises', () => {
  const { rooms } = setup();
  const box = client(rooms);
  assert.equal(box.send({ t: 'device', boxId: 'fw123', code: 'ZZZZ' }).code, 'noroom');
});

test('first-boot flow: a box only attaches by its remembered code once the host has approved it for that room; then every reconnect is automatic', () => {
  const { rooms } = setup();
  const { host, code } = createRoom(rooms);
  const first = client(rooms);
  first.send({ t: 'device', boxId: 'fw123', code }); // not yet approved: waits
  assert.equal(first.last('paired'), undefined);
  assert.equal(host.send({ t: 'host', op: 'pairBox', boxId: 'fw123' }).t, 'ack');
  assert.equal(first.last('paired').code, code);

  // Now a genuine reconnect (new socket, same remembered boxId+code)
  // attaches with no further host action, which is the whole point of
  // remembering the code.
  first.drop();
  const reconnected = client(rooms);
  const r = reconnected.send({ t: 'device', boxId: 'fw123', code });
  assert.equal(r.t, 'ack');
  assert.equal(reconnected.last('paired').code, code);
});

test('a box that reconnects (wifi blip, or just reloading) always gets a fresh scene and button, even if nothing in the room changed', () => {
  const { rooms } = setup();
  const { host, code } = createRoom(rooms);
  const box = client(rooms);
  box.send({ t: 'device', boxId: 'fw123', code }); // not yet approved: waits
  assert.equal(host.send({ t: 'host', op: 'pairBox', boxId: 'fw123' }).t, 'ack');
  assert.equal(box.last('scene').name, 'idle');
  assert.equal(box.last('button').mode, 'start');

  box.drop(); // the socket drops; room.box.lastScene/lastButtonMode survive on the room
  const reconnected = client(rooms);
  reconnected.send({ t: 'device', boxId: 'fw123', code }); // already approved for this room: reattaches straight away
  assert.equal(reconnected.last('scene').name, 'idle', 'a fresh connection must be sent the current scene, not rely on a diff');
  assert.equal(reconnected.last('button').mode, 'start', 'and the current button mode');
});

test('a second, different box cannot claim a room that already has one', () => {
  const { rooms } = setup();
  const { host, code } = createRoom(rooms);
  const a = freeBox(rooms, 'boxA');
  host.send({ t: 'host', op: 'pairBox', boxId: a.boxId });
  const b = client(rooms);
  assert.equal(b.send({ t: 'device', boxId: 'boxB', code }).code, 'paired');
  const c = freeBox(rooms, 'boxC');
  assert.equal(host.send({ t: 'host', op: 'pairBox', boxId: c.boxId }).code, 'paired');
});

test('unpairBox frees the box, which can then be paired to a new room', () => {
  const { rooms } = setup();
  const { host: hostA, code: codeA } = createRoom(rooms, 'A');
  const { host: hostB } = createRoom(rooms, 'B');
  const box = freeBox(rooms);
  hostA.send({ t: 'host', op: 'pairBox', boxId: box.boxId });
  assert.equal(box.last('paired').code, codeA);
  assert.equal(hostA.send({ t: 'host', op: 'unpairBox' }).t, 'ack');
  assert.equal(box.last('unpaired').reason, 'The host unpaired this box.');
  assert.equal(hostB.send({ t: 'host', op: 'pairBox', boxId: box.boxId }).t, 'ack');
});

test('setBoxSlots validates and dedupes against real players; assignBoxPlayer too', () => {
  const { rooms } = setup();
  const { host, code } = createRoom(rooms);
  const sam = joinRoom(rooms, code, 'Sam');
  const samId = sam.state().room.you;
  const box = freeBox(rooms);
  host.send({ t: 'host', op: 'pairBox', boxId: box.boxId });
  const r = host.send({ t: 'host', op: 'setBoxSlots', slots: [samId, 'ghost-id', samId] });
  assert.equal(r.t, 'ack');
  assert.deepEqual(host.state().room.box.slots, [samId, null, null, null, null, null]);
  assert.equal(host.send({ t: 'host', op: 'assignBoxPlayer', playerId: samId }).t, 'ack');
  assert.equal(host.state().room.box.asPlayerId, samId);
  assert.equal(host.send({ t: 'host', op: 'assignBoxPlayer', playerId: 'ghost-id' }).t, 'ack', 'an unknown id is ignored, not an error');
  assert.equal(host.state().room.box.asPlayerId, samId, 'and the previous assignment is kept');
});

test('the button mode follows the room (start in the lobby, standings once over), and pressing it does the thing', () => {
  const { rooms } = setup();
  const { host, code } = createRoom(rooms);
  const sam = joinRoom(rooms, code, 'Sam');
  const alex = joinRoom(rooms, code, 'Alex');
  const box = freeBox(rooms);
  host.send({ t: 'host', op: 'pairBox', boxId: box.boxId });
  host.send({ t: 'host', op: 'setOptions', options: { rounds: 1 } }); // one round is the whole game, for this test
  assert.equal(box.last('button').mode, 'start');
  assert.equal(box.send({ t: 'press' }).t, 'ack');
  assert.equal(host.state().room.phase, 'game', 'the box\'s press started the game, acting as the host');
  assert.equal(box.last('buttonResult').ok, true);
  // Finish the round so the room is over, then press again (-> standings).
  const all = [host, sam, alex];
  for (const c of all) c.send({ t: 'act', type: 'seen' });
  host.send({ t: 'act', type: 'startVote' });
  const imp = rooms.rooms.get(code).state.imposters[0];
  const crew = all.map((c) => c.state().room.you).filter((id) => id !== imp);
  for (const c of all) {
    const me = c.state().room.you;
    c.send({ t: 'act', type: 'vote', payload: me === imp ? crew[0] : imp });
  }
  assert.ok(host.state().room.over);
  assert.equal(box.last('button').mode, 'standings');
  box.send({ t: 'press' });
  assert.equal(host.state().room.phase, 'between');
});

test('a press while unpaired, or from a stale/replaced connection, is rejected not silently dropped', () => {
  const { rooms } = setup();
  const lone = client(rooms);
  assert.equal(lone.send({ t: 'press' }).code, 'noroom');
  const box = freeBox(rooms); // identified, but not paired to any room yet
  assert.equal(box.send({ t: 'press' }).code, 'noroom');
});

// With more than one round left, a round's shot is its own spotlight: the
// game is not over yet, so `winner` does not pre-empt it.
function voteOutTheImposter(all, code, rooms) {
  for (const c of all) c.send({ t: 'act', type: 'seen' });
  all[0].send({ t: 'act', type: 'startVote' });
  const imp = rooms.rooms.get(code).state.imposters[0];
  const crew = all.map((c) => c.state().room.you).filter((id) => id !== imp);
  for (const c of all) {
    const me = c.state().room.you;
    c.send({ t: 'act', type: 'vote', payload: me === imp ? crew[0] : imp });
  }
  return imp;
}

test('Deadly in a room: a real shot drives the box scene and queues the voice line', async () => {
  const { rooms, spoken } = setup();
  const { host, code } = createRoom(rooms, 'Host', 'imposter', 'deadly');
  const sam = joinRoom(rooms, code, 'Sam');
  const alex = joinRoom(rooms, code, 'Alex');
  const box = freeBox(rooms);
  host.send({ t: 'host', op: 'pairBox', boxId: box.boxId });
  host.send({ t: 'host', op: 'setBoxSlots', slots: [host.state().room.you, sam.state().room.you, alex.state().room.you] });
  host.send({ t: 'host', op: 'start' }); // default 5 rounds: this one shot does not end the game
  assert.match(spoken[0], /Imposter/);
  assert.match(spoken[0], /Deadly/);

  voteOutTheImposter([host, sam, alex], code, rooms);
  await flush();

  assert.equal(host.state().room.over, false);
  const scene = box.last('scene');
  assert.equal(scene.name, 'deadlyTakeover');
  assert.equal(scene.params.slots.length, 1, 'the shot targets exactly one glass');
  const audio = box.last('audio');
  assert.ok(audio, 'a voice line was queued for the shot');
  assert.ok(spoken.length >= 2);
});

test('the game ending takes over the scene from a Deadly moment, and only announces once', async () => {
  const { rooms, spoken } = setup();
  const { host, code } = createRoom(rooms, 'Host', 'imposter', 'deadly');
  const sam = joinRoom(rooms, code, 'Sam');
  const alex = joinRoom(rooms, code, 'Alex');
  const box = freeBox(rooms);
  host.send({ t: 'host', op: 'pairBox', boxId: box.boxId });
  host.send({ t: 'host', op: 'setOptions', options: { rounds: 1 } }); // this one shot also ends the game
  host.send({ t: 'host', op: 'start' });

  voteOutTheImposter([host, sam, alex], code, rooms);
  await flush();
  assert.ok(host.state().room.over);

  const scene = box.last('scene');
  assert.equal(scene.name, 'winner', 'the ending wins over the shot that happened in the same action');
  assert.ok(Array.isArray(rooms.rooms.get(code).state.$over.board) && rooms.rooms.get(code).state.$over.board.length === 3);
  const afterGameOver = box.all('audio').length;
  assert.ok(afterGameOver >= 2, 'both the shot and the game-over line were queued');
  assert.ok(spoken.length >= 2);

  // Any further action that re-runs afterChange() must not re-announce the
  // same ending (room.box.announcedOver dedupes it).
  host.send({ t: 'host', op: 'setShotCap', shotCap: 3 });
  await flush();
  assert.equal(box.all('audio').length, afterGameOver, 'no duplicate game-over announcement');
});

test('a Mercy water moment never lights the box up (idle, not deadlyTakeover)', () => {
  // Unit-level precedence is covered in test/hostbox.test.mjs; this just
  // confirms rooms.mjs passes the drink ledger's moment through untouched.
  const { rooms } = setup();
  const { host, code } = createRoom(rooms, 'Host', 'imposter', 'deadly');
  const box = freeBox(rooms);
  host.send({ t: 'host', op: 'pairBox', boxId: box.boxId });
  const room = rooms.rooms.get(code);
  room.ledger.moment = { id: 'm1', kind: 'water', targets: [], candidates: [], lines: [], at: rooms.now() };
  room.state = null; // stay in the lobby so nothing else overrides the scene
  rooms.broadcast(room);
  assert.equal(box.last('scene').name, 'idle');
});

test('closing a room releases its box back to pendingBoxes, ready to re-pair', () => {
  const { rooms } = setup();
  const { host, code } = createRoom(rooms);
  const box = freeBox(rooms);
  host.send({ t: 'host', op: 'pairBox', boxId: box.boxId });
  host.send({ t: 'leave' }); // last player leaves -> room closes
  assert.equal(box.last('unpaired').reason, 'Everyone left.');
  assert.equal(rooms.rooms.has(code), false);
  const { host: host2 } = createRoom(rooms, 'Host2');
  assert.equal(host2.send({ t: 'host', op: 'pairBox', boxId: box.boxId }).t, 'ack');
});

test('long-press hands host to the box\'s assigned player; a no-op with nobody assigned', () => {
  const { rooms } = setup();
  const { host, code } = createRoom(rooms);
  const sam = joinRoom(rooms, code, 'Sam');
  const samId = sam.state().room.you;
  const box = freeBox(rooms);
  host.send({ t: 'host', op: 'pairBox', boxId: box.boxId });
  assert.equal(box.send({ t: 'longpress' }).t, 'ack');
  assert.equal(host.state().room.hostId, host.state().room.you, 'no assigned player yet: no-op');
  host.send({ t: 'host', op: 'assignBoxPlayer', playerId: samId });
  box.send({ t: 'longpress' });
  assert.equal(host.state().room.hostId, samId);
  assert.equal(rooms.rooms.get(code).hostId, samId);
});
