// Play telemetry: greppable `[rooms]` journal lines (no names, no PII) so
// "audit what we played" has evidence. The lines are parsed by lib/plays.mjs,
// see test/plays.test.mjs.
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

let seq = 0;
function client(rooms) {
  const c = { inbox: [] };
  c.handle = rooms.connect({ send: (m) => c.inbox.push(structuredClone(m)), close: () => {} });
  c.send = (m) => { const id = ++seq; c.handle.message({ ...m, id }); return c.inbox.findLast((x) => x.id === id); };
  c.last = (t) => c.inbox.findLast((m) => m.t === t);
  c.state = () => c.last('state');
  return c;
}

function harness({ gameId = 'mlt', variant = 'deadly', players = 3 } = {}) {
  const clock = fakeTime();
  const lines = [];
  const rooms = new RoomManager({ games, now: clock.now, timers: clock.timers, rng: Math.random, log: (m) => lines.push(m) });
  const names = ['Ana', 'Ben', 'Cy', 'Dee', 'Eli'];
  const host = client(rooms);
  assert.equal(host.send({ t: 'create', name: names[0], gameId, variant }).t, 'ack');
  const code = host.last('joined').code;
  const people = [host];
  for (const name of names.slice(1, players)) {
    const c = client(rooms);
    assert.equal(c.send({ t: 'join', code, name }).t, 'ack');
    people.push(c);
  }
  const ids = people.map((p) => p.last('joined').playerId);
  const grep = (re) => lines.filter((l) => re.test(l));
  return { rooms, clock, lines, host, people, ids, code, grep };
}

const kv = (line) => Object.fromEntries([...line.matchAll(/(\w+)=(\S+)/g)].map((m) => [m[1], m[2]]));

test('creating a room keeps the existing created line', () => {
  const h = harness();
  assert.ok(h.lines.includes(`room ${h.code} created (mlt, deadly)`));
});

test('starting a game logs game, tier, players, audience and screens', () => {
  const h = harness({ players: 3 });
  h.clock.advance(5_000);
  assert.equal(h.host.send({ t: 'host', op: 'start' }).t, 'ack');
  const [line] = h.grep(/game start/);
  assert.ok(line, h.lines.join('\n'));
  assert.ok(line.startsWith(`room ${h.code} game start `));
  const f = kv(line);
  assert.equal(f.game, 'mlt');
  assert.equal(f.tier, 'deadly');
  assert.equal(f.players, '3');
  assert.equal(f.audience, '0');
  assert.equal(f.tvs, '0');
  assert.equal(f.phase, 'vote');
  assert.equal(f.lobby_ms, '5000', 'time spent in the lobby before this start');
});

test('a phase change logs the phase it entered, the one it left, and how long that lasted', () => {
  const h = harness();
  h.host.send({ t: 'host', op: 'start' });
  h.clock.advance(12_000);
  const vote = (c, id) => c.send({ t: 'act', type: 'vote', payload: id });
  vote(h.people[0], h.ids[1]);
  vote(h.people[1], h.ids[0]);
  vote(h.people[2], h.ids[0]);
  const [line] = h.grep(/ phase /);
  assert.ok(line, h.lines.join('\n'));
  const f = kv(line);
  assert.equal(f.game, 'mlt');
  assert.equal(f.phase, 'reveal');
  assert.equal(f.prev, 'vote');
  assert.equal(f.prev_ms, '12000');
  assert.equal(f.round, '1');
  h.clock.advance(7_000);
  h.host.send({ t: 'act', type: 'next' });
  const second = kv(h.grep(/ phase /)[1]);
  assert.equal(second.phase, 'vote');
  assert.equal(second.prev, 'reveal');
  assert.equal(second.prev_ms, '7000');
  assert.equal(second.round, '2');
});

test('no phase line when an action does not change the phase', () => {
  const h = harness();
  h.host.send({ t: 'host', op: 'start' });
  h.people[0].send({ t: 'act', type: 'vote', payload: h.ids[1] });
  assert.equal(h.grep(/ phase /).length, 0);
});

test('a tier drop logs where the game was: tier, round, and time since the game and the room began', () => {
  const h = harness();
  h.clock.advance(30_000);
  h.host.send({ t: 'host', op: 'start' });
  h.clock.advance(92_000);
  assert.equal(h.host.send({ t: 'host', op: 'setVariant', variant: 'drinking' }).t, 'ack');
  const [line] = h.grep(/tier -> drinking/);
  assert.ok(line.startsWith(`room ${h.code}: tier -> drinking`), 'the original prefix is kept for old greps');
  const f = kv(line);
  assert.equal(f.from, 'deadly');
  assert.equal(f.game, 'mlt');
  assert.equal(f.round, '1');
  assert.equal(f.game_ms, '92000');
  assert.equal(f.room_ms, '122000');
});

test('a tier change in the lobby is logged without a game', () => {
  const h = harness();
  h.host.send({ t: 'host', op: 'setVariant', variant: 'standard' });
  const f = kv(h.grep(/tier -> standard/)[0]);
  assert.equal(f.from, 'deadly');
  assert.equal(f.game, 'none');
  assert.equal(f.round, '0');
});

test('ending a game logs why, how long, how many rounds, and whether it was played to the end', () => {
  const h = harness();
  h.host.send({ t: 'host', op: 'start' });
  h.clock.advance(60_000);
  h.host.send({ t: 'host', op: 'end' });
  const [line] = h.grep(/game end/);
  const f = kv(line);
  assert.equal(f.game, 'mlt');
  assert.equal(f.reason, 'host-end');
  assert.equal(f.ms, '60000');
  assert.equal(f.rounds, '1');
  assert.equal(f.finished, '0');
});

test('a finished game says so, once', () => {
  const h = harness();
  h.host.send({ t: 'host', op: 'setOptions', options: { rounds: 5 } });
  h.host.send({ t: 'host', op: 'start' });
  for (let r = 1; r <= 5; r++) {
    h.clock.advance(20_000);
    h.host.send({ t: 'act', type: 'closeVote' });
    h.clock.advance(5_000);
    h.host.send({ t: 'act', type: 'next' });
  }
  const over = h.grep(/game over/);
  assert.equal(over.length, 1, h.lines.join('\n'));
  assert.equal(kv(over[0]).rounds, '5');
  h.host.send({ t: 'host', op: 'standings' });
  const end = kv(h.grep(/game end/)[0]);
  assert.equal(end.finished, '1');
  assert.equal(end.reason, 'standings');
});

test('closing logs one summary before the closed line: reason, lengths, games, rounds, tier drops', () => {
  const h = harness();
  h.clock.advance(10_000);
  h.host.send({ t: 'host', op: 'start' });
  h.clock.advance(60_000);
  h.host.send({ t: 'host', op: 'setVariant', variant: 'drinking' });
  h.clock.advance(60_000);
  h.host.send({ t: 'act', type: 'closeVote' });
  h.clock.advance(4 * 60_000); // last real activity was here
  for (const c of h.people) c.handle.close();
  h.clock.advance(16 * 60_000);
  h.rooms.sweep();
  const sum = h.grep(/ summary /);
  assert.equal(sum.length, 1, h.lines.join('\n'));
  const f = kv(sum[0]);
  assert.equal(f.reason, 'empty');
  assert.equal(f.games, '1');
  assert.equal(f.rounds, '1');
  assert.equal(f.tier_drops, '1');
  assert.equal(f.peak_players, '3');
  assert.equal(f.ms, String(10_000 + 60_000 + 60_000 + 4 * 60_000 + 16 * 60_000));
  assert.equal(f.active_ms, String(10_000 + 60_000 + 60_000), 'active_ms is up to the last human action, not the empty wait');
  const i = h.lines.findIndex((l) => / summary /.test(l));
  assert.match(h.lines[i + 1], /closed: /, 'the closed line follows and is unchanged');
  assert.ok(h.grep(/game end/).some((l) => kv(l).reason === 'closed'), 'the running game is ended with reason=closed');
});

test('everyone leaving explicitly has its own reason', () => {
  const h = harness({ players: 2 });
  h.host.send({ t: 'host', op: 'start' }).t;
  for (const c of h.people) c.send({ t: 'leave' });
  assert.equal(kv(h.grep(/ summary /)[0]).reason, 'all-left');
});

test('an idle room says so', () => {
  const h = harness({ players: 3 });
  h.clock.advance(4 * 60 * 60_000);
  h.rooms.sweep();
  assert.equal(kv(h.grep(/ summary /)[0]).reason, 'idle');
});

test('a second game in the same night counts: games, rounds and reasons add up', () => {
  const h = harness();
  h.host.send({ t: 'host', op: 'start' });
  h.clock.advance(30_000);
  h.host.send({ t: 'host', op: 'standings' });
  h.host.send({ t: 'host', op: 'next', gameId: 'wyr' });
  h.clock.advance(30_000);
  h.host.send({ t: 'host', op: 'end' });
  for (const c of h.people) c.send({ t: 'leave' });
  const f = kv(h.grep(/ summary /)[0]);
  assert.equal(f.games, '2');
  const starts = h.grep(/game start/).map((l) => kv(l).game);
  assert.deepEqual(starts, ['mlt', 'wyr']);
});

test('restarting a game ends the old run first', () => {
  const h = harness();
  h.host.send({ t: 'host', op: 'start' });
  h.clock.advance(10_000);
  h.host.send({ t: 'host', op: 'restart' });
  assert.equal(kv(h.grep(/game end/)[0]).reason, 'restart');
  assert.equal(h.grep(/game start/).length, 2);
});

test('no line carries a player name', () => {
  const h = harness();
  h.host.send({ t: 'host', op: 'start' });
  h.host.send({ t: 'host', op: 'setVariant', variant: 'drinking' });
  h.host.send({ t: 'host', op: 'end' });
  for (const c of h.people) c.send({ t: 'leave' });
  for (const name of ['Ana', 'Ben', 'Cy']) {
    assert.ok(!h.lines.some((l) => new RegExp(`\\b${name}\\b`).test(l)), `${name} leaked into the log`);
  }
});

test('a game with no numeric round (codewords) counts rounds as passes through its first phase', () => {
  const h = harness({ gameId: 'codewords', variant: 'standard', players: 4 });
  h.host.send({ t: 'host', op: 'start' });
  assert.equal(kv(h.grep(/game start/)[0]).phase, 'clue');
  h.host.send({ t: 'host', op: 'end' });
  assert.equal(kv(h.grep(/game end/)[0]).rounds, '1');
});
