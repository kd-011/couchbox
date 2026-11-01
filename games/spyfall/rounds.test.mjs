// Spyfall only remembered the last 10 locations, so a 12-round game on a
// 12-location deck dealt a location twice while others were still unseen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as engine from './engine.js';
import * as rt from '../_kit/runtime.js';

const content = JSON.parse(readFileSync(new URL('./content.json', import.meta.url), 'utf8'));
const PLAYERS = ['Ana', 'Ben', 'Cy', 'Dee'].map((name, i) => ({ id: `p${i + 1}`, name, color: '#ff6b6b' }));

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

test('spyfall: a 12-round game over 12 locations deals every location once', () => {
  const deck = { ...content, locations: content.locations.slice(0, 12) };
  for (let seed = 1; seed <= 5; seed++) {
    const rng = seeded(seed);
    let now = 1_000_000;
    const ctx = () => ({ players: PLAYERS, content: deck, rng, now });
    let state = rt.createGame(engine, { players: PLAYERS, variant: 'standard', mode: 'room', options: { rounds: 12 }, content: deck, rng, now }).state;
    const dealt = [state.location.key];
    for (let step = 0; step < 3000 && !state.$over; step++) {
      const moves = [null, ...PLAYERS.map((p) => p.id)].map((who) => ({ who, a: engine.bot(state, who, ctx()) })).filter((m) => m.a);
      const d = rt.deadlineOf(engine, state);
      if (!moves.length) { now = Math.max(now, d.at); state = rt.runDeadlines(engine, state, ctx()); continue; }
      const { who, a } = moves[Math.floor(rng() * moves.length)];
      const r = rt.applyAction(engine, state, { type: a.type, payload: a.payload ?? null, from: who || 'p1', host: who === null }, ctx());
      assert.ok(!r.error, r.error);
      if (r.state.round !== state.round) dealt.push(r.state.location.key);
      state = r.state;
      now += 500;
    }
    assert.ok(state.$over, 'game ends');
    assert.equal(dealt.length, 12, `12 rounds dealt (${dealt.length})`);
    assert.equal(new Set(dealt).size, 12, `seed ${seed}: a location repeated: ${dealt.join(', ')}`);
  }
});
