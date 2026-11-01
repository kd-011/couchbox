// Paranoia's whole premise is secrecy: the question must never reach anyone
// but the current Asker, and even the Asker loses it once a round resolves
// without being revealed. Drives RoomManager directly, the same way
// test/rooms.test.mjs and werewolf/secrets.test.mjs do, so it exercises the
// real wire protocol, not just the engine functions in isolation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { RoomManager } from '../../lib/rooms.mjs';
import { loadGame } from '../../lib/registry.mjs';

const GAMES_DIR = fileURLToPath(new URL('../', import.meta.url));
// Only this game: a sibling folder mid-edit must not fail paranoia's test.
const games = new Map([['paranoia', await loadGame(GAMES_DIR, 'paranoia')]]);

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

// A fixed rng still shuffles/picks deterministically, but lets us pin the
// coin flip: resolveAnswer's one rng() call decides `revealed = rng() < 0.5`.
function setup(rng = Math.random) {
  const clock = fakeTime();
  const rooms = new RoomManager({ games, now: clock.now, timers: clock.timers, rng });
  return { rooms, clock };
}

let seq = 0;
function client(rooms) {
  const c = { inbox: [], closed: false };
  c.handle = rooms.connect({ send: (m) => c.inbox.push(structuredClone(m)), close: () => { c.closed = true; } });
  c.send = (m) => { const id = ++seq; c.handle.message({ ...m, id }); return c.inbox.findLast((x) => x.id === id); };
  c.last = (t) => c.inbox.findLast((m) => m.t === t);
  c.state = () => c.last('state');
  return c;
}

function createRoom(rooms, name = 'Host', variant = 'standard') {
  const host = client(rooms);
  const r = host.send({ t: 'create', name, gameId: 'paranoia', variant });
  assert.equal(r.t, 'ack', JSON.stringify(r));
  const joined = host.last('joined');
  return { host, code: joined.code };
}

function joinRoom(rooms, code, name) {
  const c = client(rooms);
  const r = c.send({ t: 'join', code, name });
  assert.equal(r.t, 'ack', JSON.stringify(r));
  c.creds = c.last('joined');
  return c;
}

function clean(view, text) {
  return !JSON.stringify(view).includes(text);
}

test('secret isolation: only the Asker sees the question, and a secret that stays secret vanishes from everyone, including the Asker', () => {
  // rng() always returns 0.9: resolveAnswer's `rng() < 0.5` is always false.
  const { rooms } = setup(() => 0.9);
  const { host, code } = createRoom(rooms);
  const others = ['Sam', 'Alex', 'Jo'].map((n) => joinRoom(rooms, code, n));
  const tv = client(rooms);
  tv.send({ t: 'tv', code });
  host.send({ t: 'host', op: 'start' });

  const room = rooms.rooms.get(code);
  const everyone = [host, ...others];
  const askerId = room.state.askerId;
  const question = room.state.question;
  assert.ok(question, 'a question must be dealt at init');
  const asker = everyone.find((c) => c.state().room.you === askerId);
  const rest = everyone.filter((c) => c !== asker);

  // ask: only the Asker's own view carries the question text.
  assert.equal(asker.state().view.question, question);
  for (const c of rest) assert.ok(clean(c.state().view, question), 'a non-asker must never receive the question');
  assert.ok(clean(tv.last('tv').view, question), 'the TV must never receive the question');
  assert.ok(!('question' in tv.last('tv').view));

  asker.send({ t: 'act', type: 'read' });
  assert.equal(room.state.phase, 'target');
  for (const c of rest) assert.ok(clean(c.state().view, question));
  assert.ok(clean(tv.last('tv').view, question));

  const targetId = rest[0].state().room.you;
  assert.equal(asker.send({ t: 'act', type: 'chooseTarget', payload: targetId }).t, 'ack');
  assert.equal(room.state.phase, 'answer');
  for (const c of rest) assert.ok(clean(c.state().view, question));
  assert.ok(clean(tv.last('tv').view, question));

  const namedId = rest[1].state().room.you;
  assert.equal(asker.send({ t: 'act', type: 'recordAnswer', payload: namedId }).t, 'ack');
  assert.equal(room.state.phase, 'result');
  assert.equal(room.state.result.revealed, false);

  // The coin kept it secret: the question is gone from EVERY view, the
  // Asker's own included, and the Asker gets a private wink instead.
  for (const c of everyone) assert.ok(clean(c.state().view, question), 'the question must not survive an unrevealed result, not even for the asker');
  assert.ok(clean(tv.last('tv').view, question));
  assert.equal(asker.state().view.wink, true);
  for (const c of rest) assert.ok(!('wink' in c.state().view));
  assert.equal(asker.state().view.result.question, null);
  assert.equal(tv.last('tv').view.result.question, null);
});

test('secret isolation: a revealed coin flip shows the question to everyone, including the TV', () => {
  // rng() always returns 0.1: resolveAnswer's `rng() < 0.5` is always true.
  const { rooms } = setup(() => 0.1);
  const { host, code } = createRoom(rooms);
  const others = ['Sam', 'Alex', 'Jo'].map((n) => joinRoom(rooms, code, n));
  const tv = client(rooms);
  tv.send({ t: 'tv', code });
  host.send({ t: 'host', op: 'start' });

  const room = rooms.rooms.get(code);
  const everyone = [host, ...others];
  const askerId = room.state.askerId;
  const question = room.state.question;
  const asker = everyone.find((c) => c.state().room.you === askerId);
  const rest = everyone.filter((c) => c !== asker);

  asker.send({ t: 'act', type: 'read' });
  asker.send({ t: 'act', type: 'chooseTarget', payload: rest[0].state().room.you });
  asker.send({ t: 'act', type: 'recordAnswer', payload: rest[1].state().room.you });
  assert.equal(room.state.phase, 'result');
  assert.equal(room.state.result.revealed, true);

  for (const c of everyone) assert.equal(c.state().view.result.question, question);
  assert.equal(tv.last('tv').view.result.question, question);
});

test('removing the Asker mid-round voids it and deals a fresh question instead of getting stuck', () => {
  const { rooms } = setup();
  const { host, code } = createRoom(rooms);
  const others = ['Sam', 'Alex', 'Jo'].map((n) => joinRoom(rooms, code, n));
  host.send({ t: 'host', op: 'start' });
  const room = rooms.rooms.get(code);
  const everyone = [host, ...others];
  const askerId = room.state.askerId;
  const asker = everyone.find((c) => c.state().room.you === askerId);
  const hostId = host.state().room.you;

  // A host can't kick itself, so hand host off first if the asker is host
  // (a room-level rule, not part of what this test checks).
  let kicker = host;
  if (askerId === hostId) {
    kicker = everyone.find((c) => c !== asker);
    host.send({ t: 'host', op: 'passHost', to: kicker.state().room.you });
  }
  kicker.send({ t: 'host', op: 'kick', playerId: askerId });

  assert.notEqual(room.state.askerId, askerId, 'a fresh asker must be dealt once the old one is gone');
  assert.equal(room.state.phase, 'ask');
  assert.ok(room.state.players.length >= 2, 'the remaining players stay in the game');
});
