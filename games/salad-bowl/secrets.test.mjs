// Secret isolation: the current card must never leave the active player's
// own view (room mode) / the shared screen (pass mode, which is the point).
// Pattern lifted from test/rooms.test.mjs's Imposter/Heads checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { RoomManager } from '../../lib/rooms.mjs';
import { loadGames } from '../../lib/registry.mjs';

const GAMES_DIR = fileURLToPath(new URL('../../games', import.meta.url));
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

function createRoom(rooms, variant = 'standard') {
  const host = client(rooms);
  const r = host.send({ t: 'create', name: 'Host', gameId: 'salad-bowl', variant });
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

function fillBowl(room, everyone) {
  const target = room.state.submitTarget;
  for (const c of everyone) {
    for (let i = 0; i < target; i++) {
      const r = c.send({ t: 'act', type: 'submitWords', payload: { text: `${c.creds ? c.creds.playerId : 'host'}-phrase-${i}` } });
      assert.equal(r.t, 'ack', JSON.stringify(r));
    }
  }
}

test('secret isolation, Salad Bowl: only the active player sees the current card, nobody else and never the TV', () => {
  const { rooms } = setup();
  const { host, code } = createRoom(rooms);
  const others = ['Sam', 'Alex', 'Jo'].map((n) => joinRoom(rooms, code, n));
  const tv = client(rooms);
  tv.send({ t: 'tv', code });
  host.send({ t: 'host', op: 'start' });
  const room = rooms.rooms.get(code);
  const everyone = [host, ...others];

  fillBowl(room, everyone);
  assert.equal(room.state.phase, 'ready', 'submissions should auto-advance once everyone hits target');

  const activeId = room.state.order[room.state.turnIndex];
  const active = everyone.find((c) => c.state().room.you === activeId);
  assert.ok(active, 'active player must be a real client');
  assert.equal(active.send({ t: 'act', type: 'start' }).t, 'ack');
  assert.equal(room.state.phase, 'turn');
  const card = room.state.turn.card;
  assert.ok(card, 'a card must be dealt');

  for (const c of everyone) {
    const s = c.state();
    const blob = JSON.stringify(s);
    if (s.room.you === activeId) {
      assert.equal(s.view.card, card, 'the active player must see the card');
    } else {
      assert.ok(!blob.includes(card), 'nobody else may see the card');
    }
  }
  const tvBlob = JSON.stringify(tv.last('tv'));
  assert.ok(!tvBlob.includes(card), 'the room TV must never see the card');

  // Also check nobody's view leaks another player's unsubmitted/submitted
  // phrases during the submit phase of a fresh room.
  const { host: host2, code: code2 } = createRoom(rooms);
  const others2 = ['Sam', 'Alex'].map((n) => joinRoom(rooms, code2, n));
  const everyone2 = [host2, ...others2];
  const secretPhrase = 'xyzzy-only-sam-wrote-this';
  others2[0].send({ t: 'act', type: 'submitWords', payload: { text: secretPhrase } });
  for (const c of everyone2) {
    if (c === others2[0]) continue;
    const blob = JSON.stringify(c.state());
    assert.ok(!blob.includes(secretPhrase), "another player's submitted phrase must stay private during submission");
  }
});
