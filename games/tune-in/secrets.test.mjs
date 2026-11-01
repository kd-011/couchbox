// Tune In is the one game on this site where a plain number is the secret:
// the hidden target on the dial. Nobody but the Psychic may see it before
// the result, and in a room, nobody's in-progress dial guess may leak into
// anyone else's view before the result either (that's a deliberate design
// choice, not an oversight: see docs/GAME-MODULES.md's note on groupthink).
// Drives RoomManager directly, the same way test/rooms.test.mjs and
// games/werewolf/secrets.test.mjs do, so it exercises the real wire
// protocol, not just the engine functions in isolation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { RoomManager } from '../../lib/rooms.mjs';
import { loadGame } from '../../lib/registry.mjs';

const GAMES_DIR = fileURLToPath(new URL('../', import.meta.url));
// Only this game: a sibling folder mid-edit must not fail tune-in's test.
const games = new Map([['tune-in', await loadGame(GAMES_DIR, 'tune-in')]]);

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

function setup() {
  const clock = fakeTime();
  const rooms = new RoomManager({ games, now: clock.now, timers: clock.timers, rng: Math.random });
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

function createRoom(rooms, name, variant = 'standard') {
  const host = client(rooms);
  const r = host.send({ t: 'create', name, gameId: 'tune-in', variant });
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

test('tune-in: only the Psychic ever sees the target before the result, and the TV never does', () => {
  const { rooms } = setup();
  const { host, code } = createRoom(rooms, 'Host');
  const others = ['Sam', 'Alex', 'Jo'].map((n) => joinRoom(rooms, code, n));
  const tv = client(rooms);
  tv.send({ t: 'tv', code });
  host.send({ t: 'host', op: 'start' });

  const room = rooms.rooms.get(code);
  const everyone = [host, ...others];
  const psychicId = room.state.order[room.state.psychicIndex];
  const psychicClient = everyone.find((c) => c.state().room.you === psychicId);
  const others2 = everyone.filter((c) => c !== psychicClient);

  // Before the clue: the Psychic alone has the target (and the spectrum,
  // which the rest of the table has not been shown yet either).
  assert.equal(typeof psychicClient.state().view.target, 'number');
  assert.ok(psychicClient.state().view.spectrum, 'the Psychic sees the spectrum while thinking of a clue');
  for (const c of others2) {
    assert.ok(!('target' in c.state().view), 'a non-Psychic must never receive the target');
    assert.equal(c.state().view.spectrum, null, 'the spectrum is not public until the clue is given');
  }
  assert.ok(!('target' in tv.last('tv').view), 'the TV must never receive the target before the result');
  const target = psychicClient.state().view.target;

  // The clue is given: the spectrum and clue text go public, the target does
  // not, and the Psychic's own view still carries it correctly.
  assert.equal(psychicClient.send({ t: 'act', type: 'giveClue', payload: { text: 'frosty' } }).t, 'ack');
  assert.equal(room.state.phase, 'guess');
  for (const c of everyone) {
    const v = c.state().view;
    assert.equal(v.clue, 'frosty');
    assert.deepEqual(v.spectrum, room.state.spectrum);
  }
  for (const c of others2) assert.ok(!('target' in c.state().view), 'the target stays hidden through the guess phase');
  assert.ok(!('target' in tv.last('tv').view));
  assert.equal(psychicClient.state().view.target, target);

  // One guesser submits a dial. Their own view shows it; nobody else's view
  // (not another guesser, not the Psychic, not the TV) ever receives that
  // value before the round resolves.
  const [guesserA, guesserB] = others2;
  assert.equal(guesserA.send({ t: 'act', type: 'setDial', payload: { value: 63 } }).t, 'ack');
  assert.equal(guesserA.state().view.myDial, 63);
  assert.equal(guesserB.state().view.myDial, null, 'a guesser who has not submitted yet sees no dial of their own');
  assert.ok(!('myDial' in psychicClient.state().view), 'the Psychic never gets a myDial field');
  assert.ok(!('myDial' in tv.last('tv').view), 'the TV never gets a myDial field');
  for (const blob of [psychicClient.state(), guesserB.state(), tv.last('tv')]) {
    assert.ok(!JSON.stringify(blob).includes('"myDial":63'), "another screen must never show a guesser's in-progress dial value");
  }
  // The public "who has submitted" roster is ids only, never values.
  assert.deepEqual(tv.last('tv').view.submitted, [guesserA.state().room.you]);

  // Now everyone else submits: the round resolves and the target is public.
  for (const c of others2) if (c !== guesserA) c.send({ t: 'act', type: 'setDial', payload: { value: 40 } });
  assert.equal(room.state.phase, 'result');
  for (const c of [...everyone, tv]) {
    const v = c === tv ? tv.last('tv').view : c.state().view;
    assert.equal(v.result.target, target);
  }
});
