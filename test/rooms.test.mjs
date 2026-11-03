import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { RoomManager } from '../lib/rooms.mjs';
import { loadGames } from '../lib/registry.mjs';

const GAMES_DIR = fileURLToPath(new URL('../games', import.meta.url));
const games = await loadGames(GAMES_DIR, { strict: true });

// Fake clock + scheduler so failover and expiry run instantly.
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
// A fake socket: records everything sent to it.
function client(rooms) {
  const c = { inbox: [], closed: false };
  c.handle = rooms.connect({ send: (m) => c.inbox.push(structuredClone(m)), close: () => { c.closed = true; } });
  c.send = (m) => { const id = ++seq; c.handle.message({ ...m, id }); return c.inbox.findLast((x) => x.id === id); };
  c.last = (t) => c.inbox.findLast((m) => m.t === t);
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

test('create gives a 4-letter code and makes the creator host', () => {
  const { rooms } = setup();
  const { host, code, hostCreds } = createRoom(rooms);
  assert.match(code, /^[A-Z]{4}$/);
  assert.doesNotMatch(code, /[IO]/);
  const s = host.state();
  assert.equal(s.room.hostId, hostCreds.playerId);
  assert.equal(s.room.phase, 'lobby');
  assert.equal(s.room.players.length, 1);
});

test('join by code (any case), names must be unique, bad code is a clear error', () => {
  const { rooms } = setup();
  const { host, code } = createRoom(rooms);
  const sam = joinRoom(rooms, code.toLowerCase(), 'Sam');
  assert.equal(host.state().room.players.length, 2);
  assert.equal(sam.state().room.you, sam.creds.playerId);
  const dupe = client(rooms).send({ t: 'join', code, name: ' sam ' });
  assert.equal(dupe.t, 'error');
  assert.equal(dupe.code, 'name');
  const nope = client(rooms).send({ t: 'join', code: 'ZZZZ', name: 'X' });
  assert.equal(nope.code, 'noroom');
  const blank = client(rooms).send({ t: 'join', code, name: '   ' });
  assert.equal(blank.code, 'name');
});

test('tokens are only ever sent to their owner', () => {
  const { rooms } = setup();
  const { host, code, hostCreds } = createRoom(rooms);
  const sam = joinRoom(rooms, code, 'Sam');
  const tv = client(rooms);
  tv.send({ t: 'tv', code });
  for (const m of [...sam.inbox, ...tv.inbox]) assert.ok(!JSON.stringify(m).includes(hostCreds.token));
  for (const m of [...host.inbox, ...tv.inbox]) assert.ok(!JSON.stringify(m).includes(sam.creds.token));
});

test('rejoin with token after a drop restores the same player with no lost state', () => {
  const { rooms } = setup();
  const { host, code } = createRoom(rooms);
  const sam = joinRoom(rooms, code, 'Sam');
  joinRoom(rooms, code, 'Alex');
  host.send({ t: 'host', op: 'start' });
  const before = sam.state().view;
  sam.drop();
  assert.equal(host.state().room.players.find((p) => p.id === sam.creds.playerId).connected, false);
  const again = client(rooms);
  const r = again.send({ t: 'join', code, token: sam.creds.token });
  assert.equal(r.t, 'ack');
  assert.equal(again.last('joined').playerId, sam.creds.playerId);
  const after = again.state();
  assert.equal(after.room.you, sam.creds.playerId);
  assert.deepEqual(after.view.card, before.card);
  assert.equal(host.state().room.players.length, 3);
  assert.equal(host.state().room.players.find((p) => p.id === sam.creds.playerId).connected, true);
});

test('a stale token without a name is refused, not silently re-added', () => {
  const { rooms } = setup();
  const { code } = createRoom(rooms);
  const r = client(rooms).send({ t: 'join', code, token: 'not-a-real-token' });
  assert.equal(r.code, 'gone');
});

test('host can pass host to another player, from the lobby and mid-game', () => {
  const { rooms } = setup();
  const { host, code } = createRoom(rooms);
  const sam = joinRoom(rooms, code, 'Sam');
  const alex = joinRoom(rooms, code, 'Alex');
  assert.equal(sam.send({ t: 'host', op: 'passHost', to: alex.creds.playerId }).code, 'nothost');
  assert.equal(host.send({ t: 'host', op: 'passHost', to: sam.creds.playerId }).t, 'ack');
  assert.equal(alex.state().room.hostId, sam.creds.playerId);
  // old host lost powers, new host has them
  assert.equal(host.send({ t: 'host', op: 'start' }).code, 'nothost');
  assert.equal(sam.send({ t: 'host', op: 'start' }).t, 'ack');
  assert.ok(sam.state().actions.length > 0, 'new host gets host actions');
  assert.equal(host.state().actions.length, 0, 'old host gets none');
  // mid-game pass
  assert.equal(sam.send({ t: 'host', op: 'passHost', to: alex.creds.playerId }).t, 'ack');
  assert.equal(host.state().room.hostId, alex.creds.playerId);
  assert.equal(alex.send({ t: 'act', type: 'startDiscuss' }).t, 'ack');
});

test('host failover: after 30s offline host goes to the longest-connected player', () => {
  const { rooms, clock } = setup();
  const { host, code, hostCreds } = createRoom(rooms);
  clock.advance(1000);
  const sam = joinRoom(rooms, code, 'Sam'); // connected since t+1s
  clock.advance(1000);
  const alex = joinRoom(rooms, code, 'Alex'); // connected since t+2s
  // Sam blips and comes back: now Alex has the longer unbroken connection.
  sam.drop();
  clock.advance(500);
  const sam2 = client(rooms);
  sam2.send({ t: 'join', code, token: sam.creds.token });
  host.drop();
  clock.advance(29_000);
  assert.equal(alex.state().room.hostId, hostCreds.playerId, 'still host inside the grace period');
  clock.advance(1_500);
  assert.equal(alex.state().room.hostId, alex.creds.playerId);
  assert.equal(sam2.state().room.hostId, alex.creds.playerId);
});

test('host failover is cancelled if the host comes back in time', () => {
  const { rooms, clock } = setup();
  const { host, code, hostCreds } = createRoom(rooms);
  const sam = joinRoom(rooms, code, 'Sam');
  host.drop();
  clock.advance(20_000);
  client(rooms).send({ t: 'join', code, token: hostCreds.token });
  clock.advance(20_000);
  assert.equal(sam.state().room.hostId, hostCreds.playerId);
});

test('when the host leaves for good, host passes immediately', () => {
  const { rooms } = setup();
  const { host, code } = createRoom(rooms);
  const sam = joinRoom(rooms, code, 'Sam');
  host.send({ t: 'leave' });
  assert.equal(sam.state().room.hostId, sam.creds.playerId);
  assert.equal(sam.state().room.players.length, 1);
});

test('kick removes the player and kills their token', () => {
  const { rooms } = setup();
  const { host, code } = createRoom(rooms);
  const sam = joinRoom(rooms, code, 'Sam');
  host.send({ t: 'host', op: 'kick', playerId: sam.creds.playerId });
  assert.ok(sam.last('kicked'));
  assert.equal(host.state().room.players.length, 1);
  assert.equal(client(rooms).send({ t: 'join', code, token: sam.creds.token }).code, 'gone');
});

test('rooms expire: empty for 15 min, or idle for 3 h even with a socket open', () => {
  const { rooms, clock } = setup();
  const a = createRoom(rooms);
  a.host.drop();
  clock.advance(14 * 60_000);
  rooms.sweep();
  assert.ok(rooms.rooms.has(a.code));
  clock.advance(2 * 60_000);
  rooms.sweep();
  assert.ok(!rooms.rooms.has(a.code));
  assert.equal(client(rooms).send({ t: 'join', code: a.code, token: a.hostCreds.token }).code, 'noroom');

  const b = createRoom(rooms);
  clock.advance(3 * 60 * 60_000 + 1000);
  rooms.sweep();
  assert.ok(!rooms.rooms.has(b.code));
  assert.ok(b.host.last('closed'));
});

test('a rejoin inside the empty window keeps the room alive', () => {
  const { rooms, clock } = setup();
  const a = createRoom(rooms);
  a.host.drop();
  clock.advance(10 * 60_000);
  client(rooms).send({ t: 'join', code: a.code, token: a.hostCreds.token });
  clock.advance(10 * 60_000);
  rooms.sweep();
  assert.ok(rooms.rooms.has(a.code));
});

test('secret isolation, Imposter: only crew get the word, nobody learns the imposter early, TV gets neither', () => {
  const { rooms } = setup();
  const { host, code } = createRoom(rooms, 'Host', 'imposter');
  const others = ['Sam', 'Alex', 'Jo', 'Kim'].map((n) => joinRoom(rooms, code, n));
  const tv = client(rooms);
  tv.send({ t: 'tv', code });
  host.send({ t: 'host', op: 'start' });
  const state = rooms.rooms.get(code).state;
  const word = state.word;
  const imposterIds = state.imposters;
  const everyone = [host, ...others];
  for (const c of everyone) {
    const s = c.state();
    const me = s.room.you;
    const blob = JSON.stringify(s);
    if (imposterIds.includes(me)) {
      assert.ok(!blob.includes(word), 'imposter must not receive the word');
      assert.equal(s.view.card.role, 'imposter');
    } else {
      assert.equal(s.view.card.word, word);
    }
    assert.ok(!('imposters' in s.view), 'imposter list not in a player view mid-round');
    assert.equal(s.view.result, null, 'no result (and so no imposter list) before the vote');
  }
  const tvBlob = JSON.stringify(tv.last('tv'));
  assert.ok(!tvBlob.includes(word), 'TV must not receive the word');
  const tvView = tv.last('tv').view;
  assert.ok(!('imposters' in tvView));
  assert.equal(tvView.result, null);
});

test('secret isolation, Celebrity Heads: the guesser and the TV never get the live word', () => {
  const { rooms } = setup();
  const { host, code } = createRoom(rooms, 'Host', 'heads');
  const others = ['Sam', 'Alex'].map((n) => joinRoom(rooms, code, n));
  const tv = client(rooms);
  tv.send({ t: 'tv', code });
  host.send({ t: 'host', op: 'start' });
  const room = rooms.rooms.get(code);
  const guesserId = room.state.order[0];
  const everyone = [host, ...others];
  const guesser = everyone.find((c) => c.state().room.you === guesserId);
  assert.equal(guesser.send({ t: 'act', type: 'start' }).t, 'ack');
  for (let i = 0; i < 4; i++) {
    const word = room.state.word;
    for (const c of everyone) {
      const s = c.state();
      if (s.room.you === guesserId) assert.ok(!JSON.stringify(s).includes(word), 'guesser must not see the word');
      else assert.equal(s.view.word, word);
    }
    assert.ok(!JSON.stringify(tv.last('tv')).includes(word), 'TV must not see the word');
    // the guesser cannot mark their own guesses
    assert.equal(guesser.send({ t: 'act', type: 'got', payload: room.state.wordId }).t, 'error');
    const clue = everyone.find((c) => c !== guesser);
    assert.equal(clue.send({ t: 'act', type: 'got', payload: room.state.wordId }).t, 'ack');
  }
});

test('double taps on the same word only count once', () => {
  const { rooms } = setup();
  const { host, code } = createRoom(rooms, 'Host', 'heads');
  const sam = joinRoom(rooms, code, 'Sam');
  const alex = joinRoom(rooms, code, 'Alex');
  host.send({ t: 'host', op: 'start' });
  const room = rooms.rooms.get(code);
  host.send({ t: 'act', type: 'start' });
  const g = room.state.order[0];
  const markers = [host, sam, alex].filter((c) => c.state().room.you !== g);
  const wid = room.state.wordId;
  markers[0].send({ t: 'act', type: 'got', payload: wid });
  markers[1].send({ t: 'act', type: 'got', payload: wid });
  assert.equal(room.state.scores[g], 1);
});

test('engine timers fire on the server: Imposter discussion runs out into the vote', () => {
  const { rooms, clock } = setup();
  const { host, code } = createRoom(rooms);
  joinRoom(rooms, code, 'Sam');
  joinRoom(rooms, code, 'Alex');
  host.send({ t: 'host', op: 'setOptions', options: { minutes: 1 } });
  host.send({ t: 'host', op: 'start' });
  host.send({ t: 'act', type: 'startDiscuss' });
  assert.equal(host.state().view.phase, 'discuss');
  clock.advance(61_000);
  assert.equal(host.state().view.phase, 'vote');
});

test('only the host can run host ops; lobby settings lock once the game starts', () => {
  const { rooms } = setup();
  const { host, code } = createRoom(rooms);
  const sam = joinRoom(rooms, code, 'Sam');
  joinRoom(rooms, code, 'Alex');
  assert.equal(sam.send({ t: 'host', op: 'setVariant', variant: 'drinking' }).code, 'nothost');
  assert.equal(host.send({ t: 'host', op: 'setVariant', variant: 'drinking' }).t, 'ack');
  assert.equal(host.send({ t: 'host', op: 'setGame', gameId: 'heads' }).t, 'ack');
  assert.equal(sam.state().room.gameId, 'heads');
  assert.equal(sam.state().room.variant, 'drinking');
  host.send({ t: 'host', op: 'start' });
  assert.equal(host.send({ t: 'host', op: 'setGame', gameId: 'imposter' }).code, 'ingame');
  assert.equal(host.send({ t: 'host', op: 'end' }).t, 'ack');
  assert.equal(sam.state().room.phase, 'lobby');
});

test('too few players to start is a clear error', () => {
  const { rooms } = setup();
  const { host } = createRoom(rooms, 'Host', 'imposter');
  const r = host.send({ t: 'host', op: 'start' });
  assert.equal(r.code, 'players');
  assert.match(r.message, /at least 3/);
});

test('late joiners mid-game get a view and are dealt in next round', () => {
  const { rooms } = setup();
  const { host, code } = createRoom(rooms);
  joinRoom(rooms, code, 'Sam');
  joinRoom(rooms, code, 'Alex');
  host.send({ t: 'host', op: 'start' });
  const late = joinRoom(rooms, code, 'Late');
  assert.equal(late.state().view.me, null);
  assert.ok(!JSON.stringify(late.state()).includes(rooms.rooms.get(code).state.word));
  const room = rooms.rooms.get(code);
  host.send({ t: 'act', type: 'startDiscuss' });
  host.send({ t: 'act', type: 'startVote' });
  host.send({ t: 'act', type: 'closeVote' });
  host.send({ t: 'act', type: 'nextRound' });
  assert.ok(room.state.players.some((p) => p.id === late.creds.playerId));
  assert.ok(late.state().view.card);
});

test('rate limit stops a flood', () => {
  const { rooms } = setup();
  const { host } = createRoom(rooms);
  let slow = 0;
  for (let i = 0; i < 100; i++) if (host.send({ t: 'profile', name: `Host${i % 3}` })?.code === 'slow') slow++;
  assert.ok(slow > 0);
});

/* drink engine and Party Night in rooms */

// One Imposter round: everyone looks, host opens the vote, the crew vote out
// the imposter (catch) or each other (escape).
function imposterRound(rooms, code, clients, catchIt = true) {
  const st = () => rooms.rooms.get(code).state;
  for (const c of clients) assert.equal(c.send({ t: 'act', type: 'seen' }).t, 'ack');
  assert.equal(clients[0].send({ t: 'act', type: 'startVote' }).t, 'ack');
  const imp = st().imposters[0];
  const ids = clients.map((c) => c.state().room.you);
  const crew = ids.filter((id) => id !== imp);
  for (const c of clients) {
    const me = c.state().room.you;
    const target = me === imp ? crew[0] : catchIt ? imp : crew.find((x) => x !== me);
    assert.equal(c.send({ t: 'act', type: 'vote', payload: target }).t, 'ack');
  }
  assert.equal(st().phase, 'result');
  return imp;
}

test('Deadly in a room: a caught imposter takes a shot, everyone and the TV get the takeover', () => {
  const { rooms } = setup();
  const { host, code } = createRoom(rooms, 'Host', 'imposter', 'deadly');
  const others = ['Sam', 'Alex'].map((n) => joinRoom(rooms, code, n));
  const tv = client(rooms);
  tv.send({ t: 'tv', code });
  host.send({ t: 'host', op: 'start' });
  const imp = imposterRound(rooms, code, [host, ...others], true);
  for (const c of [host, ...others]) {
    const d = c.state().drink;
    assert.equal(d.tier, 'deadly');
    assert.equal(d.tally[imp].shots, 1);
    assert.deepEqual(d.moment.targets, [imp]);
  }
  assert.deepEqual(tv.last('tv').drink.moment.targets, [imp]);
});

test("I'm out and the host's tier drop: forfeits for the out player, tier only goes down mid-game", () => {
  const { rooms } = setup();
  const { host, code } = createRoom(rooms, 'Host', 'imposter', 'deadly');
  const sam = joinRoom(rooms, code, 'Sam');
  const alex = joinRoom(rooms, code, 'Alex');
  host.send({ t: 'host', op: 'start' });
  assert.equal(sam.send({ t: 'drink', out: true }).t, 'ack');
  const samId = sam.state().room.you;
  assert.deepEqual(host.state().drink.out, [samId]);
  assert.equal(sam.send({ t: 'host', op: 'setVariant', variant: 'drinking' }).code, 'nothost');
  assert.equal(host.send({ t: 'host', op: 'setVariant', variant: 'deadly' }).code, 'ingame', 'no going up mid-game');
  assert.equal(host.send({ t: 'host', op: 'setVariant', variant: 'drinking' }).t, 'ack');
  assert.equal(rooms.rooms.get(code).state.variant, 'drinking');
  assert.equal(alex.state().drink.tier, 'drinking');
  // Make sure Sam drinks: caught if Sam is the imposter, else the imposter escapes.
  const samImp = rooms.rooms.get(code).state.imposters.includes(samId);
  imposterRound(rooms, code, [host, sam, alex], samImp);
  const t = host.state().drink.tally;
  assert.equal((t[samId] || { sips: 0 }).sips, 0);
  assert.ok((t[samId] || { forfeits: 0 }).forfeits >= 1);
  assert.equal(host.send({ t: 'host', op: 'setShotCap', shotCap: 4 }).t, 'ack');
  assert.equal(sam.state().drink.shotCap, 4);
});

test('Party Night: queue, standings, next game with tallies carried, awards, new night', () => {
  const { rooms } = setup();
  const { host, code } = createRoom(rooms, 'Host', 'imposter', 'drinking');
  const others = ['Sam', 'Alex'].map((n) => joinRoom(rooms, code, n));
  const tv = client(rooms);
  tv.send({ t: 'tv', code });
  const all = [host, ...others];
  host.send({ t: 'host', op: 'setOptions', options: { rounds: 1 } });
  assert.equal(others[0].send({ t: 'host', op: 'queueAdd', gameId: 'imposter' }).code, 'nothost');
  assert.equal(host.send({ t: 'host', op: 'queueAdd', gameId: 'imposter' }).t, 'ack');
  assert.equal(host.send({ t: 'host', op: 'queueAdd', gameId: 'nope' }).code, 'nogame');
  assert.deepEqual(others[1].state().room.night.queue, ['imposter']);
  host.send({ t: 'host', op: 'start' });
  imposterRound(rooms, code, all, false); // imposter escapes: crew sip 2 each
  const s1 = host.state();
  assert.ok(s1.room.over, 'last round ends the game');
  assert.equal(s1.platform[0].op, 'standings');
  assert.deepEqual(others[0].state().platform, [], 'only the host gets platform buttons');
  assert.deepEqual(s1.room.night.stats, {}, 'stats of a running game never leave the server');
  const sipsAfter1 = Object.values(s1.drink.tally).reduce((a, t) => a + t.sips, 0);
  assert.ok(sipsAfter1 >= 4);

  assert.equal(host.send({ t: 'host', op: 'standings' }).t, 'ack');
  const b = others[0].state().room;
  assert.equal(b.phase, 'between');
  assert.equal(b.night.played.length, 1);
  assert.ok(Object.values(b.night.points).some((p) => p > 0), 'placement points handed out');
  assert.ok(Object.values(b.night.stats).some((s) => s.liar), 'the imposter got a Best Liar stat');
  assert.equal(tv.last('tv').room.phase, 'between');

  assert.equal(host.send({ t: 'host', op: 'next' }).t, 'ack');
  const g2 = host.state();
  assert.equal(g2.room.phase, 'game');
  assert.deepEqual(g2.room.night.queue, []);
  assert.equal(Object.values(g2.drink.tally).reduce((a, t) => a + t.sips, 0), sipsAfter1, 'tallies carry into the next game');

  assert.equal(host.send({ t: 'host', op: 'recap' }).t, 'ack', 'awards straight from a running game archive it first');
  const r = others[1].state().room;
  assert.equal(r.phase, 'recap');
  assert.equal(r.night.played.length, 2);
  assert.equal(tv.last('tv').room.phase, 'recap');

  assert.equal(host.send({ t: 'host', op: 'newNight' }).t, 'ack');
  const n = host.state();
  assert.equal(n.room.phase, 'lobby');
  assert.equal(n.room.night.played.length, 0);
  assert.deepEqual(n.drink.tally, {});
  assert.equal(n.drink.tier, 'drinking', 'a new night keeps the tier');
});

test('teams: host sets up teams, rejected for unsupported games, carried through to the engine', () => {
  const { rooms } = setup();
  const { host: impHost, code: impCode, hostCreds: impHostCreds } = createRoom(rooms, 'Host', 'imposter', 'standard');
  joinRoom(rooms, impCode, 'Sam');
  // Imposter does not declare meta.teams.
  assert.equal(impHost.send({ t: 'host', op: 'setTeams', teams: [{ memberIds: [impHostCreds.playerId] }, { memberIds: [] }] }).code, 'noteams');

  const { host, code, hostCreds } = createRoom(rooms, 'Host', 'quiz-show', 'standard');
  const p1 = joinRoom(rooms, code, 'P1');
  const p2 = joinRoom(rooms, code, 'P2');
  const p3 = joinRoom(rooms, code, 'P3');
  const hostId = hostCreds.playerId;
  assert.equal(host.send({ t: 'host', op: 'setTeams', teams: [{ memberIds: [hostId] }] }).code, 'bad', 'only one team named');

  const ok = host.send({
    t: 'host', op: 'setTeams',
    teams: [{ name: 'Reds', memberIds: [hostId, p1.creds.playerId] }, { name: 'Blues', memberIds: [p2.creds.playerId, p3.creds.playerId] }],
  });
  assert.equal(ok.t, 'ack');
  const lobby = host.state().room;
  assert.equal(lobby.teams.length, 2);
  assert.equal(lobby.teams[0].name, 'Reds');
  assert.deepEqual(lobby.teams[1].memberIds, [p2.creds.playerId, p3.creds.playerId]);

  // Starting the game carries the teams through to the engine (quiz-show's
  // contestants become the two teams instead of one per player).
  assert.equal(host.send({ t: 'host', op: 'start' }).t, 'ack');
  assert.deepEqual(host.state().view.contestants.map((c) => c.id).sort(), ['t1', 't2']);

  // Mid-game, teams lock like setGame/setOptions.
  assert.equal(host.send({ t: 'host', op: 'setTeams', teams: null }).code, 'ingame');
});

test('audience: joiners past a game\'s player cap watch instead of a hard refusal, and the host can force anyone to the crowd', () => {
  const { rooms } = setup();
  const { host, code } = createRoom(rooms, 'Host', 'fake-out', 'standard'); // maxPlayers 12, declares meta.audience
  const joiners = [];
  for (let i = 0; i < 12; i++) joiners.push(joinRoom(rooms, code, `P${i}`));
  assert.equal(joiners.length + 1, 13, 'one player over the cap of 12');

  assert.equal(host.send({ t: 'host', op: 'start' }).t, 'ack');
  const info = host.state().room;
  assert.equal(info.audienceIds.length, 1, 'exactly the overflow player watches');
  const overflowId = info.audienceIds[0];
  const overflowClient = joiners.find((p) => p.creds.playerId === overflowId);
  assert.ok(overflowClient, 'the overflow player is a real, connected player');
  const theirView = overflowClient.state().view;
  assert.equal(theirView.me, null);
  assert.ok(!theirView.players.includes(overflowId), 'the audience member is never an active player in the engine view');

  // Force someone else to the crowd for the next game too.
  assert.equal(host.send({ t: 'host', op: 'end' }).t, 'ack');
  const targetId = joiners[0].creds.playerId;
  assert.equal(host.send({ t: 'host', op: 'setAudience', playerId: targetId, audience: true }).t, 'ack');
  assert.equal(host.send({ t: 'host', op: 'start' }).t, 'ack');
  assert.ok(host.state().room.audienceIds.includes(targetId), 'forced audience watches even though there is room under the cap');
});

test('react: a quick emoji fans out to every player and the TV, nobody else', () => {
  const { rooms } = setup();
  const { host, code } = createRoom(rooms);
  const sam = joinRoom(rooms, code, 'Sam');
  const tv = client(rooms);
  assert.equal(tv.send({ t: 'tv', code }).t, 'ack');

  assert.equal(sam.send({ t: 'react', emoji: '🔥' }).t, 'ack');
  assert.equal(host.last('reaction').emoji, '🔥');
  assert.equal(host.last('reaction').from, sam.creds.playerId);
  assert.equal(sam.last('reaction').emoji, '🔥');
  assert.equal(tv.last('reaction').emoji, '🔥');

  assert.equal(sam.send({ t: 'react', emoji: '🙂' }).code, 'bad', 'only the fixed reaction set is allowed');
});

test('players get a distinct face on join, can pick one, and bad faces are refused', () => {
  const { rooms } = setup();
  const { host, code } = createRoom(rooms, 'Ana');
  const ben = client(rooms);
  assert.equal(ben.send({ t: 'join', code, name: 'Ben', avatar: '🐙' }).t, 'ack');
  const ps = ben.state().room.players;
  assert.ok(ps.every((p) => typeof p.avatar === 'string' && p.avatar));
  assert.notEqual(ps[0].avatar, ps[1].avatar);
  assert.equal(ps.find((p) => p.name === 'Ben').avatar, '🐙');
  // Someone else asking for a face already taken gets a free one instead.
  const cy = client(rooms);
  cy.send({ t: 'join', code, name: 'Cy', avatar: '🐙' });
  assert.notEqual(cy.state().room.players.find((p) => p.name === 'Cy').avatar, '🐙');
  assert.equal(host.send({ t: 'profile', avatar: '🦖' }).t, 'ack');
  assert.equal(host.state().room.players.find((p) => p.name === 'Ana').avatar, '🦖');
  assert.equal(host.send({ t: 'profile', avatar: '<b>' }).t, 'error');
});

test('ready is a lobby-only signal and resets when a game starts', () => {
  const { rooms } = setup();
  const { host, code } = createRoom(rooms, 'Ana');
  const ben = client(rooms);
  ben.send({ t: 'join', code, name: 'Ben' });
  const cy = client(rooms);
  cy.send({ t: 'join', code, name: 'Cy' });
  assert.equal(ben.send({ t: 'ready', on: true }).t, 'ack');
  const ready = (c) => c.state().room.players.filter((p) => p.ready).map((p) => p.name);
  assert.deepEqual(ready(host), ['Ben']);
  ben.send({ t: 'ready', on: false });
  assert.deepEqual(ready(host), []);
  cy.send({ t: 'ready', on: true });
  // Starting never waits on ready.
  assert.equal(host.send({ t: 'host', op: 'start' }).t, 'ack');
  assert.deepEqual(ready(host), []);
  assert.equal(cy.send({ t: 'ready', on: true }).t, 'error');
  host.send({ t: 'host', op: 'end' });
  assert.equal(cy.send({ t: 'ready', on: true }).t, 'ack');
  assert.deepEqual(ready(host), ['Cy']);
});

test('peek tells a join link what it leads to without joining', () => {
  const { rooms } = setup();
  const { code } = createRoom(rooms, 'Ana', 'imposter', 'drinking');
  const c = client(rooms);
  assert.equal(c.send({ t: 'peek', code: code.toLowerCase() }).t, 'ack');
  const p = c.last('peeked');
  assert.deepEqual({ ...p, code: undefined }, { t: 'peeked', code: undefined, gameId: 'imposter', variant: 'drinking', players: 1, host: 'Ana' });
  assert.equal(c.last('state'), undefined);
  assert.equal(c.send({ t: 'peek', code: 'ZZZZ' }).code, 'noroom');
});
