// Secret isolation for Spyfall, driven through the real RoomManager the same
// way test/rooms.test.mjs covers Imposter and Heads (see docs/GAME-MODULES.md,
// "Testing"). Checks: the location never reaches the Spy's view, the Spy's
// identity never reaches anyone else's view before the table catches them,
// and the TV gets neither before the reveal. Also covers the Deadly moment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { RoomManager } from '../../lib/rooms.mjs';
import { loadGames } from '../../lib/registry.mjs';

const GAMES_DIR = fileURLToPath(new URL('../../games', import.meta.url));
// Non-strict: a sibling game folder mid-edit elsewhere in the repo should
// never break this file's coverage of spyfall's own secrecy contract.
const games = await loadGames(GAMES_DIR, { strict: false });

// Fake clock + scheduler so failover and timers run instantly (copied from
// test/rooms.test.mjs; kept local so this file can run on its own).
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
  const rooms = new RoomManager({ games, now: clock.now, timers: clock.timers, rng: Math.random, ...opts });
  return { rooms, clock };
}

let seq = 0;
function client(rooms) {
  const c = { inbox: [], closed: false };
  c.handle = rooms.connect({ send: (m) => c.inbox.push(structuredClone(m)), close: () => { c.closed = true; } });
  c.send = (m) => { const id = ++seq; c.handle.message({ ...m, id }); return c.inbox.findLast((x) => x.id === id); };
  c.last = (t) => c.inbox.findLast((m) => m.t === t);
  c.state = () => c.last('state');
  c.drop = () => c.handle.close();
  return c;
}

function createRoom(rooms, name = 'Host', gameId = 'spyfall', variant = 'standard') {
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

test('secret isolation, Spyfall: only crew get the location, nobody learns the spy early, TV gets neither', () => {
  const { rooms } = setup();
  const { host, code } = createRoom(rooms, 'Host', 'spyfall');
  const others = ['Sam', 'Alex', 'Jo', 'Kim'].map((n) => joinRoom(rooms, code, n));
  const tv = client(rooms);
  tv.send({ t: 'tv', code });
  host.send({ t: 'host', op: 'start' });
  const state = rooms.rooms.get(code).state;
  const location = state.location.key;
  const spyId = state.spyId;
  const everyone = [host, ...others];
  for (const c of everyone) {
    const s = c.state();
    const me = s.room.you;
    if (me === spyId) {
      // The spy's card carries no location at all, only its own role.
      assert.equal(s.view.card.role, 'spy');
      assert.equal(s.view.card.location, undefined, 'the spy must not receive the location');
    } else {
      assert.equal(s.view.card.role, 'crew');
      assert.equal(s.view.card.location.key, location);
    }
    // The board of possible locations is public (the deduction game itself),
    // but which one is live this round, and who the spy is, are not yet.
    assert.equal(s.view.spyId, null, 'spy identity not revealed before the reveal');
    assert.equal(s.view.accused, null);
    assert.equal(s.view.result, null, 'no result before the vote');
  }
  // The full board of locations is legitimately public (every view gets it,
  // spy included: that's the deduction game), so the one thing to check on
  // the TV is that it never gets a card or an early reveal of the round's
  // actual pick or the spy's identity.
  const tvView = tv.last('tv').view;
  assert.ok(!('card' in tvView), 'the TV never gets a card');
  assert.equal(tvView.spyId, null);
  assert.equal(tvView.accused, null);
  assert.equal(tvView.result, null);
});

// One Spyfall round where the table votes out the spy, then the host rules
// them stumped: the deterministic path to the game's Deadly moment.
function spyfallCatchSpy(rooms, code, clients) {
  const st = () => rooms.rooms.get(code).state;
  for (const c of clients) assert.equal(c.send({ t: 'act', type: 'seen' }).t, 'ack');
  assert.equal(clients[0].send({ t: 'act', type: 'startVote' }).t, 'ack');
  const spy = st().spyId;
  const ids = clients.map((c) => c.state().room.you);
  const crew = ids.filter((id) => id !== spy);
  for (const c of clients) {
    const me = c.state().room.you;
    const target = me === spy ? crew[0] : spy; // every crew member votes for the spy
    assert.equal(c.send({ t: 'act', type: 'vote', payload: target }).t, 'ack');
  }
  assert.equal(st().phase, 'spyLastChance', 'catching the spy goes to their last chance, not straight to a result');
  return spy;
}

test('Deadly in a room: a caught, stumped spy takes a shot, everyone and the TV get the takeover', () => {
  const { rooms } = setup();
  const { host, code } = createRoom(rooms, 'Host', 'spyfall', 'deadly');
  const others = ['Sam', 'Alex'].map((n) => joinRoom(rooms, code, n));
  const tv = client(rooms);
  tv.send({ t: 'tv', code });
  host.send({ t: 'host', op: 'start' });
  const spy = spyfallCatchSpy(rooms, code, [host, ...others]);
  // The host rules the spy stumped rather than waiting out the last-chance timer.
  assert.equal(host.send({ t: 'act', type: 'forceCaught' }).t, 'ack');
  assert.equal(rooms.rooms.get(code).state.phase, 'result');
  for (const c of [host, ...others]) {
    const d = c.state().drink;
    assert.equal(d.tier, 'deadly');
    assert.equal(d.tally[spy].shots, 1);
    assert.deepEqual(d.moment.targets, [spy]);
  }
  assert.deepEqual(tv.last('tv').drink.moment.targets, [spy]);
});
