// Werewolf is the highest-stakes game for secret leakage: a wolf's identity
// must never reach a non-wolf (or the TV) before the normal reveal points
// (a death, or the game ending). Drives RoomManager directly, the same way
// test/rooms.test.mjs does, so it exercises the real wire protocol, not just
// the engine functions in isolation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { RoomManager } from '../../lib/rooms.mjs';
import { loadGame } from '../../lib/registry.mjs';

const GAMES_DIR = fileURLToPath(new URL('../', import.meta.url));
// Only this game: a sibling folder mid-edit must not fail werewolf's test.
const games = new Map([['werewolf', await loadGame(GAMES_DIR, 'werewolf')]]);

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
  const r = host.send({ t: 'create', name, gameId: 'werewolf', variant });
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

// No field holding the exact string value "werewolf" anywhere in a *view*
// means nobody's wolf-hood leaked through it (the only places that value
// can legitimately appear are a player's own myRole, a death/lynch reveal
// naming an actual wolf, or the end-of-game final reveal — callers exclude
// those cases before calling this). The quotes on both sides matter: they
// rule out false positives from field *names* like werewolfCount.
function clean(view) {
  return !JSON.stringify(view).includes('"werewolf"');
}

test('werewolf: nobody but the pack ever sees who the werewolves are, and the TV never does', () => {
  const { rooms } = setup();
  const { host, code } = createRoom(rooms, 'Host');
  const others = ['Sam', 'Alex', 'Jo', 'Kim'].map((n) => joinRoom(rooms, code, n));
  const tv = client(rooms);
  tv.send({ t: 'tv', code });
  // Disable seer/doctor so a single werewolf pick is the only thing the
  // night needs; keeps this test's timeline deterministic.
  host.send({ t: 'host', op: 'setOptions', options: { seer: false, doctor: false, werewolves: '1' } });
  host.send({ t: 'host', op: 'start' });

  const room = rooms.rooms.get(code);
  const everyone = [host, ...others];
  const roles = room.state.roles;
  const wolfId = Object.keys(roles).find((id) => roles[id] === 'werewolf');
  assert.ok(wolfId, 'exactly one werewolf should have been dealt');
  const nonWolves = everyone.filter((c) => c.state().room.you !== wolfId);
  const wolf = everyone.find((c) => c.state().room.you === wolfId);

  // Before anyone has acted: the wolf sees the pack (itself), nobody else
  // sees a pack at all, and no state blob names the werewolf.
  assert.deepEqual(wolf.state().view.pack.ids, [wolfId]);
  assert.equal(wolf.state().view.myRole, 'werewolf');
  for (const c of nonWolves) {
    assert.ok(!('pack' in c.state().view), 'a non-wolf must never receive pack info');
    assert.ok(clean(c.state().view), 'a non-wolf view must never name the werewolf');
  }
  assert.ok(!('pack' in tv.last('tv').view), 'the TV must never receive pack info');
  assert.ok(clean(tv.last('tv').view), 'the TV must never name the werewolf');

  // The wolf kills a villager. The night resolves immediately (seer/doctor
  // are off), the village learns who died and their role, but not who the
  // wolf is.
  const victim = nonWolves[0].state().room.you;
  assert.equal(wolf.send({ t: 'act', type: 'nightKill', payload: victim }).t, 'ack');
  assert.equal(room.state.phase, 'day');
  assert.equal(room.state.lastNightResult.diedId, victim);

  for (const c of everyone) {
    const blob = c.state();
    if (c === wolf) continue;
    assert.ok(!('pack' in blob.view), 'pack info must not leak after the night resolves');
    assert.ok(clean(blob.view), 'the dead villager reveal must not also reveal the werewolf');
  }
  assert.ok(clean(tv.last('tv').view), 'TV must not learn the werewolf from the death reveal');

  // The dead villager is now a ghost: still gets a real view, still knows
  // their own (now-revealed) role, but never anything about the wolf.
  const ghost = everyone.find((c) => c.state().room.you === victim);
  assert.equal(ghost.state().view.aliveMe, false);
  assert.ok(!('pack' in ghost.state().view));
});

test('werewolf: lynching the wolf reveals only that player, and the final screen is the only place every role appears', () => {
  const { rooms } = setup();
  const { host, code } = createRoom(rooms, 'Host');
  const others = ['Sam', 'Alex', 'Jo', 'Kim'].map((n) => joinRoom(rooms, code, n));
  host.send({ t: 'host', op: 'setOptions', options: { seer: false, doctor: false, werewolves: '1' } });
  host.send({ t: 'host', op: 'start' });

  const room = rooms.rooms.get(code);
  const everyone = [host, ...others];
  const wolfId = Object.keys(room.state.roles).find((id) => room.state.roles[id] === 'werewolf');
  const wolf = everyone.find((c) => c.state().room.you === wolfId);
  const villagers = everyone.filter((c) => c !== wolf);

  // Wolf kills nobody of consequence: pick any living villager so the night
  // resolves, we only care about the day/vote/result/final flow here.
  wolf.send({ t: 'act', type: 'nightKill', payload: villagers[0].state().room.you });
  assert.equal(room.state.phase, 'day');
  host.send({ t: 'act', type: 'startDiscuss' });
  host.send({ t: 'act', type: 'startVote' });

  // Everyone still alive (bar the wolf) votes for the wolf, then the host
  // closes the vote rather than waiting on the wolf's own ballot.
  for (const c of everyone) {
    const me = c.state().room.you;
    if (room.state.dead[me]) continue;
    if (me === wolfId) continue;
    c.send({ t: 'act', type: 'vote', payload: wolfId });
  }
  host.send({ t: 'act', type: 'closeVote' });
  assert.equal(room.state.phase, 'result');
  assert.equal(room.state.result.lynchedId, wolfId);
  assert.equal(room.state.result.lynchedRole, 'werewolf');
  assert.equal(room.state.winner, 'village');

  // The lynch reveal legitimately names the wolf now (that is the point of
  // the vote), but it must not be present before this moment, which the
  // previous test already covers; here we only check the ending.
  host.send({ t: 'act', type: 'finishGame' });
  assert.equal(room.state.phase, 'final');
  const tv = client(rooms);
  tv.send({ t: 'tv', code });
  for (const c of [...everyone, tv]) {
    const blob = c.state();
    const view = c === tv ? tv.last('tv').view : blob.view;
    assert.ok(view.final, 'the final reveal must be visible to everyone once the game is over');
    assert.equal(view.final.roles[wolfId], 'werewolf');
    assert.equal(view.final.winner, 'village');
  }
});

test('werewolf: removing the only werewolf mid-game ends it cleanly instead of getting stuck', () => {
  const { rooms } = setup();
  const { host, code } = createRoom(rooms, 'Host');
  const others = ['Sam', 'Alex', 'Jo', 'Kim'].map((n) => joinRoom(rooms, code, n));
  host.send({ t: 'host', op: 'setOptions', options: { seer: false, doctor: false, werewolves: '1' } });
  host.send({ t: 'host', op: 'start' });

  const room = rooms.rooms.get(code);
  const everyone = [host, ...others];
  const wolfId = Object.keys(room.state.roles).find((id) => room.state.roles[id] === 'werewolf');
  const wolf = everyone.find((c) => c.state().room.you === wolfId);
  const hostId = host.state().room.you;

  // The werewolf's phone dies for good mid-night, before picking a kill. A
  // host can't kick itself, so if the host happens to be the wolf, hand
  // host to someone else first — that's a room-level rule, not part of
  // what this test is checking.
  let kicker = host;
  if (wolfId === hostId) {
    kicker = everyone.find((c) => c !== wolf);
    host.send({ t: 'host', op: 'passHost', to: kicker.state().room.you });
  }
  kicker.send({ t: 'host', op: 'kick', playerId: wolfId });

  // With no werewolves left, the village has already won: there is no death
  // to narrate, so the engine resolves the (now action-less) night straight
  // into the day screen with the win already decided, rather than hanging.
  assert.equal(room.state.phase, 'day', 'the night must resolve once the only wolf is gone, not hang');
  assert.equal(room.state.winner, 'village');
  kicker.send({ t: 'act', type: 'finishGame' });
  assert.equal(room.state.phase, 'final');
  for (const c of everyone) {
    if (c === wolf) continue;
    const r = c.state();
    if (r) assert.ok(r.view.final, 'every remaining player sees the final reveal');
  }
});

test('werewolf deadly: the lynch shot and the award stats never point at a wolf before the roles are public', () => {
  const { rooms } = setup();
  const { host, code } = createRoom(rooms, 'Host', 'deadly');
  const others = ['Sam', 'Alex', 'Jo', 'Kim'].map((n) => joinRoom(rooms, code, n));
  const tv = client(rooms);
  tv.send({ t: 'tv', code });
  host.send({ t: 'host', op: 'setOptions', options: { seer: false, doctor: false, werewolves: '1' } });
  host.send({ t: 'host', op: 'start' });

  const room = rooms.rooms.get(code);
  const everyone = [host, ...others];
  const wolfId = Object.keys(room.state.roles).find((id) => room.state.roles[id] === 'werewolf');
  const wolf = everyone.find((c) => c.state().room.you === wolfId);
  const villagerIds = everyone.map((c) => c.state().room.you).filter((id) => id !== wolfId);
  const wire = () => [...everyone.map((c) => c.state()), tv.last('tv')];
  const tallyOf = (id) => (tv.last('tv').drink && tv.last('tv').drink.tally[id]) || null;

  // Night: the kill happens, nobody drinks (a drink would point at the wolf).
  wolf.send({ t: 'act', type: 'nightKill', payload: villagerIds[0] });
  assert.equal(room.state.phase, 'day');
  assert.equal(tallyOf(wolfId), null, 'the wolf must not drink at night');
  assert.ok(!room.state.$stats, 'no award stat may be recorded mid-game');

  // Day: everyone alive votes out a villager. That lynch is public, so the
  // shot lands on them, and only on them.
  host.send({ t: 'act', type: 'startDiscuss' });
  host.send({ t: 'act', type: 'startVote' });
  const target = villagerIds[1];
  for (const c of everyone) {
    const me = c.state().room.you;
    if (room.state.dead[me]) continue;
    c.send({ t: 'act', type: 'vote', payload: me === target ? villagerIds[2] : target });
  }
  assert.equal(room.state.phase, 'result');
  assert.equal(room.state.result.lynchedId, target);
  assert.equal(room.state.winner, null);
  const moment = tv.last('tv').drink.moment;
  assert.ok(moment, 'the lynch shot must fire a Deadly moment');
  assert.deepEqual(moment.targets, [target]);
  assert.equal(tallyOf(target).shots, 1);
  assert.equal(tallyOf(wolfId), null, 'the wolf must not appear in the drink tallies');
  assert.ok(!room.state.$stats, 'no award stat may be recorded mid-game');
  for (const blob of wire()) {
    const forWolf = blob.room.you === wolfId;
    // (The whole blob would match room.gameId, so check view and drinks.)
    if (!forWolf) assert.ok(clean(blob.view) && clean(blob.drink), 'no view or drink may name the werewolf before the end');
    assert.ok(!JSON.stringify(blob.drink).includes(wolfId), 'the drink ledger must not mention the wolf');
    assert.ok(!(blob.room.night && JSON.stringify(blob.room.night).includes('liar')), 'stats must not leave the server mid-game');
  }

  // Next night: the wolf wins it. Only now do the stats appear.
  host.send({ t: 'act', type: 'nextRound' });
  assert.equal(room.state.phase, 'night');
  const last = villagerIds.find((id) => !room.state.dead[id]);
  wolf.send({ t: 'act', type: 'nightKill', payload: last });
  assert.equal(room.state.winner, 'wolves');
  assert.ok(!room.state.$stats, 'no award stat may be recorded before the ending');
  host.send({ t: 'act', type: 'finishGame' });
  assert.equal(room.state.phase, 'final');
  assert.equal(room.state.$stats[wolfId].liar, 1);
  assert.ok(room.state.$over, 'the ending must call gameOver');
});
