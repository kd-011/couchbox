// The phone status strip (client.now) must never hint at a role: at night
// everyone with nothing (left) to do gets the very same line, and by day
// every living non-host player gets the same line whatever their role.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as engine from './engine.js';
import { now } from './client.js';
import { createGame, applyAction, playerViewOf } from '../_kit/runtime.js';

const PLAYERS = ['Ana', 'Ben', 'Cy', 'Dee', 'Eve', 'Fin'].map((name, i) => ({ id: `p${i + 1}`, name, color: '#ff6b6b' }));
const ctx = { players: PLAYERS, content: {}, rng: Math.random, now: 1_000 };
const ui = (p) => ({ surface: 'player', mode: 'room', isHost: false, me: p, name: (id) => PLAYERS.find((x) => x.id === id)?.name || 'Someone' });
const line = (state, p) => JSON.stringify(now(playerViewOf(engine, state, p.id, ctx), ui(p)));

test('werewolf now(): idle night lines and day lines are the same for every role', () => {
  let { state } = createGame(engine, { players: PLAYERS, variant: 'standard', mode: 'room', options: { seer: true, doctor: true }, content: {}, now: 1_000 });
  const roles = state.roles;
  const villagers = PLAYERS.filter((p) => roles[p.id] === 'villager');
  assert.ok(villagers.length >= 1);
  const idle = line(state, villagers[0]);
  // Every actor moves except one wolf, so the night stays open.
  const wolves = PLAYERS.filter((p) => roles[p.id] === 'werewolf');
  const target = villagers[0].id;
  const seer = PLAYERS.find((p) => roles[p.id] === 'seer');
  const doctor = PLAYERS.find((p) => roles[p.id] === 'doctor');
  for (const [p, type, payload] of [[seer, 'seerCheck', target], [doctor, 'doctorSave', target]]) {
    const r = applyAction(engine, state, { type, payload, from: p.id, host: false }, ctx);
    assert.ok(r.state, r.error);
    state = r.state;
  }
  if (wolves.length > 1) state = applyAction(engine, state, { type: 'nightKill', payload: target, from: wolves[1].id, host: false }, ctx).state;
  assert.equal(state.phase, 'night');
  for (const p of [seer, doctor, ...villagers, ...wolves.slice(1)]) assert.equal(line(state, p), idle, `${roles[p.id]} night line differs`);
  // Day: every living player who is not the host sees one line.
  state = applyAction(engine, state, { type: 'resolveNightNow', payload: null, from: null, host: true }, ctx).state;
  state = applyAction(engine, state, { type: 'startDiscuss', payload: null, from: null, host: true }, ctx).state;
  const living = PLAYERS.filter((p) => !state.dead[p.id]);
  const day = new Set(living.map((p) => line(state, p)));
  assert.equal(day.size, 1, [...day].join(' | '));
});
