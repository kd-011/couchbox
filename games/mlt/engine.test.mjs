// Most Likely To in a room: the Deadly crown must be rare (a 3 minute gap
// like every other optional moment), and a vote can never stall the room.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadGame } from '../../lib/registry.mjs';
import * as rt from '../_kit/runtime.js';

const GAMES_DIR = fileURLToPath(new URL('../', import.meta.url));
const g = await loadGame(GAMES_DIR, 'mlt');
const engine = g.engine;
const MIN = 60_000;

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function game({ n = 3, variant = 'deadly', mode = 'room' } = {}) {
  const players = ['Ana', 'Ben', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal'].slice(0, n).map((name, i) => ({ id: `p${i}`, name, color: '#fff' }));
  const clock = { now: 1_700_000_000_000 };
  const seededRng = seeded(7);
  // Deadly cards are a coin flip between rounds; tests that care about the
  // 3 minute gap pin the draw to "no card" (h.rng = () => 0.99).
  const h = { clock, rng: seededRng };
  const rng = () => h.rng();
  const ctx = () => ({ players, content: g.content, rng, now: clock.now });
  const created = rt.createGame(engine, { players, variant, mode, options: { rounds: 12 }, content: g.content, rng, now: clock.now });
  assert.ok(!created.error, created.error);
  Object.assign(h, { state: created.state, players, ctx });
  h.act = (type, payload, from, host = false, system = false) => {
    const r = rt.applyAction(engine, h.state, { type, payload, from, host, system }, ctx());
    if (r.state) h.state = r.state;
    return r;
  };
  h.view = (id) => rt.playerViewOf(engine, h.state, id, ctx());
  h.tv = () => rt.tvViewOf(engine, h.state, ctx());
  // Everyone but `target` votes for them (the target votes for someone else).
  h.crown = (target) => {
    for (const p of players) {
      const pick = p.id === target ? players.find((x) => x.id !== target).id : target;
      const r = h.act('vote', pick, p.id);
      assert.ok(!r.error, r.error);
    }
  };
  h.next = () => { const r = h.act('next', null, 'p0', true); assert.ok(!r.error, r.error); };
  return h;
}

test('room Deadly: the first unanimous crown is a shot and is telegraphed', () => {
  const h = game();
  assert.equal(h.tv().shotLive, true);
  h.crown('p0');
  assert.equal(h.state.result.unanimous, true);
  assert.ok(h.state.result.drinks.some((d) => d.unit === 'shot'));
});

test('room Deadly: a second unanimous crown inside 3 minutes is sips, and is not telegraphed', () => {
  const h = game();
  h.rng = () => 0.99;
  h.crown('p0');
  h.clock.now += 40_000;
  h.next();
  assert.equal(h.tv().shotLive, false, 'the Deadly note must not promise a shot during the cooldown');
  h.crown('p1');
  assert.equal(h.state.result.unanimous, false);
  assert.ok(!h.state.result.drinks.some((d) => d.unit === 'shot'));
  assert.ok(h.state.result.drinks.some((d) => d.unit === 'sip' && d.n === 2), 'a plain crown still costs 2 sips');
  assert.equal(h.state.result.winners[0], 'p1', 'the crown itself still counts');
});

test('room Deadly: the shot is back once the 3 minute gap has passed', () => {
  const h = game();
  h.rng = () => 0.99;
  h.crown('p0');
  h.clock.now += 4 * MIN;
  h.next();
  assert.equal(h.tv().shotLive, true);
  h.crown('p2');
  assert.equal(h.state.result.unanimous, true);
});

test('Drinking never pours a shot', () => {
  const h = game({ variant: 'drinking' });
  h.crown('p0');
  assert.equal(h.state.result.unanimous, false);
  assert.ok(!h.state.result.drinks.some((d) => d.unit === 'shot'));
});

test('dropping Deadly to Drinking mid-vote resolves as sips', () => {
  const h = game();
  h.state = rt.withDrinkPatch(h.state, { tier: 'drinking' });
  h.crown('p0');
  assert.equal(h.state.result.unanimous, false);
  assert.ok(h.state.result.drinks.every((d) => d.unit === 'sip'));
});

/* ---------- a vote never stalls ---------- */

test('no timer while few have voted; it starts once half the table is in', () => {
  const h = game({ n: 4, variant: 'standard' });
  assert.equal(h.view('p0').timer ?? null, null);
  h.act('vote', 'p1', 'p0');
  assert.equal(h.view('p0').timer ?? null, null, 'one of four is not half');
  h.act('vote', 'p0', 'p1');
  const t = h.view('p2').timer;
  assert.ok(t && t.endsAt > h.clock.now, 'two of four starts the countdown');
  assert.equal(h.tv().timer.endsAt, t.endsAt, 'the TV shows the same clock');
  const d = rt.deadlineOf(engine, h.state);
  assert.ok(d, 'the room schedules the deadline');
  assert.equal(d.at, t.endsAt);
});

test('when the clock runs out the votes cast decide the round', () => {
  const h = game({ n: 4, variant: 'standard' });
  h.act('vote', 'p1', 'p0');
  h.act('vote', 'p1', 'p2');
  assert.equal(h.state.phase, 'vote');
  h.clock.now = rt.deadlineOf(engine, h.state).at;
  h.state = rt.runDeadlines(engine, h.state, h.ctx());
  assert.equal(h.state.phase, 'reveal');
  assert.deepEqual(h.state.result.winners, ['p1']);
  assert.equal(h.view('p0').timer ?? null, null, 'the clock is gone after the reveal');
});

test('nobody voted at all: the host can still skip, and the timer never starts', () => {
  const h = game({ n: 4, variant: 'standard' });
  assert.equal(rt.deadlineOf(engine, h.state), null);
  const r = h.act('closeVote', null, 'p0', true);
  assert.ok(!r.error);
  assert.deepEqual(h.state.result.winners, []);
});

test('a clock that fires late on a new round is ignored (no double resolve)', () => {
  const h = game({ n: 4, variant: 'standard' });
  h.act('vote', 'p1', 'p0');
  h.act('vote', 'p0', 'p1');
  h.act('vote', 'p0', 'p2');
  h.act('vote', 'p0', 'p3');
  assert.equal(h.state.phase, 'reveal');
  const r = h.act('voteTimeUp', null, null, false, true);
  assert.ok(r.error || h.state.phase === 'reveal', 'a stale time-up changes nothing');
  assert.equal(h.state.phase, 'reveal');
});

test('only the engine clock can call time: a player cannot fire voteTimeUp', () => {
  const h = game({ n: 4, variant: 'standard' });
  h.act('vote', 'p1', 'p0');
  h.act('vote', 'p0', 'p1');
  const r = h.act('voteTimeUp', null, 'p2');
  assert.ok(r.error);
  assert.equal(h.state.phase, 'vote');
});

test('one phone never gets a timer', () => {
  const h = game({ mode: 'pass', variant: 'standard' });
  assert.equal(rt.deadlineOf(engine, h.state), null);
  h.act('accuse', 'p1', null, true);
  assert.equal(h.state.phase, 'reveal');
});

test('a leaver completing the half-way mark starts the clock, and removing the laggard resolves', () => {
  const h = game({ n: 3, variant: 'standard' });
  h.act('vote', 'p1', 'p0');
  h.act('vote', 'p0', 'p1');
  assert.ok(h.view('p0').timer, 'two of three is the half-way mark');
  const r = rt.removePlayerFrom(engine, h.state, 'p2', h.ctx());
  assert.equal(r.phase, 'reveal');
});
