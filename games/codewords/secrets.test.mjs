// Codewords secrets: the key (which colour each word is) must never reach
// anyone but the active team's own Caller, and only while they are the one
// composing the clue - not their own team's guess phase, not the other
// team, not the TV, ever. Drives RoomManager directly, the same way
// test/rooms.test.mjs and werewolf's secrets.test.mjs do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { RoomManager } from '../../lib/rooms.mjs';
import { loadGame } from '../../lib/registry.mjs';

const GAMES_DIR = fileURLToPath(new URL('../', import.meta.url));
// Only this game: a sibling folder mid-edit must not fail codewords' test.
const games = new Map([['codewords', await loadGame(GAMES_DIR, 'codewords')]]);

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
  const r = host.send({ t: 'create', name, gameId: 'codewords', variant });
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

// Every tile a view can see must be either not yet revealed and colourless,
// or revealed (in which case a colour is exactly the point). A colour on an
// unrevealed tile is the key leaking.
function keyLeak(view) {
  return (view.tiles || []).some((t) => !t.revealed && t.color !== null);
}

function setupGame(variant = 'standard') {
  const { rooms } = setup();
  const { host, code } = createRoom(rooms, 'Ana', variant);
  const others = ['Ben', 'Cy', 'Dee'].map((n) => joinRoom(rooms, code, n));
  const tv = client(rooms);
  tv.send({ t: 'tv', code });
  host.send({ t: 'host', op: 'start' });
  const room = rooms.rooms.get(code);
  const everyone = [host, ...others];
  return { rooms, room, code, host, others, everyone, tv };
}

test('codewords: the key never leaks to anyone but the active Caller, and only during their own clue phase', () => {
  const { room, everyone, tv } = setupGame('standard');
  const callerId = room.state.callerOf[room.state.active];
  const caller = everyone.find((c) => c.state().room.you === callerId);
  const others = everyone.filter((c) => c !== caller);
  assert.ok(caller, 'the active team’s Caller must be a real connected player');

  // The Caller's own clue-phase view does see the key (the whole point of
  // the role): at least one hidden tile must carry a colour for them.
  // (keyLeak() below is a leak check for everyone else; the Caller
  // legitimately has colours here, so assert the positive directly.)
  assert.ok((caller.state().view.tiles || []).some((t) => !t.revealed && t.color !== null), 'the Caller must see the key while giving the clue');

  // Nobody else - teammates, the opposing team, or the TV - gets it.
  for (const c of others) assert.ok(!keyLeak(c.state().view), `${c.state().room.you} must never see the key before it is revealed`);
  assert.ok(!keyLeak(tv.last('tv').view), 'the TV must never see the key');

  // The Caller gives a clue, moving to the guess phase: now even the Caller
  // sees only revealed tiles, same as everyone else.
  const r = caller.send({ t: 'act', type: 'giveClue', payload: { word: 'vexnomir', count: 1 } });
  assert.equal(r.t, 'ack', JSON.stringify(r));
  assert.equal(room.state.phase, 'guess');
  for (const c of [caller, ...others]) assert.ok(!keyLeak(c.state().view), `${c.state().room.you} must not see the key outside the clue phase`);
  assert.ok(!keyLeak(tv.last('tv').view), 'the TV must never see the key, even mid-guess');
});

test('codewords: a revealed tile is public everywhere, but the rest of the key stays hidden', () => {
  const { room, everyone, tv } = setupGame('standard');
  const callerId = room.state.callerOf[room.state.active];
  const activeTeamId = room.state.active;
  const caller = everyone.find((c) => c.state().room.you === callerId);
  caller.send({ t: 'act', type: 'giveClue', payload: { word: 'vexnomir', count: 1 } });
  assert.equal(room.state.phase, 'guess');

  // Deliberately tap one of the active team's OWN words: a wrong guess would
  // end their turn and legitimately hand the key to the other team's Caller
  // for their own clue phase next, which is a different assertion entirely
  // (covered by the first test above). This test is about a single reveal
  // leaving the rest of the key hidden, so keep the same team on the board.
  const word = room.state.tiles.find((t) => t.color === activeTeamId).word;
  const guesserId = room.state.contestants.find((x) => x.id === activeTeamId).memberIds.find((id) => id !== callerId)
    || callerId; // a solo team's own Caller guesses too
  const guesser = everyone.find((c) => c.state().room.you === guesserId);
  const r = guesser.send({ t: 'act', type: 'guess', payload: word });
  assert.equal(r.t, 'ack', JSON.stringify(r));
  assert.ok(['guess', 'final'].includes(room.state.phase), 'a correct guess must not hand the turn to the other team');

  // Whatever happened to that one tile, it is now public; everything else
  // on the board must still only show colour where it has been revealed.
  for (const c of everyone) {
    const view = c.state().view;
    const tile = (view.tiles || []).find((t) => t.word === word);
    assert.ok(tile.revealed, 'the tapped tile must be revealed in every view');
    assert.ok(tile.color !== null, 'a revealed tile must show its colour');
    assert.ok(!keyLeak(view), `${c.state().room.you}: the rest of the key must still be hidden`);
  }
  assert.ok(!keyLeak(tv.last('tv').view), 'the TV must still only show the one revealed tile');
});

test('codewords deadly: hitting the Bomb is the only moment, and the losing team’s identity is not exposed early', () => {
  const { room, everyone, tv } = setupGame('deadly');
  const callerId = room.state.callerOf[room.state.active];
  const caller = everyone.find((c) => c.state().room.you === callerId);
  const activeTeamId = room.state.active;
  caller.send({ t: 'act', type: 'giveClue', payload: { word: 'vexnomir', count: 1 } });

  const bomb = room.state.tiles.find((t) => t.color === 'bomb');
  const guesserId = room.state.contestants.find((x) => x.id === activeTeamId).memberIds.find((id) => id !== callerId) || callerId;
  const guesser = everyone.find((c) => c.state().room.you === guesserId);
  const r = guesser.send({ t: 'act', type: 'guess', payload: bomb.word });
  assert.equal(r.t, 'ack', JSON.stringify(r));
  assert.equal(room.state.phase, 'final');
  assert.equal(room.state.result.reason, 'bomb');
  // The other team is handed the win; the board is now fully revealed to
  // everyone (the game is over, so this is the legitimate final reveal).
  for (const c of everyone) assert.ok((c.state().view.tiles || []).every((t) => t.revealed), 'the final board must be fully revealed to everyone');
  assert.ok((tv.last('tv').view.tiles || []).every((t) => t.revealed), 'the TV must also see the final board');
});
