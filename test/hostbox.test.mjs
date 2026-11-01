import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sceneFor, buttonModeFor, cleanSlots, slotOf, sameDescriptor } from '../lib/hostbox.mjs';

function room(over) {
  return { state: over ? { $over: { board: over } } : null, teams: null, box: { slots: ['p1', 'p2', null, null, null, null] } };
}

test('slotOf finds a player\'s glass, or null with no glass or no box', () => {
  const slots = ['p1', null, 'p3'];
  assert.equal(slotOf(slots, 'p1'), 0);
  assert.equal(slotOf(slots, 'p3'), 2);
  assert.equal(slotOf(slots, 'p9'), null);
  assert.equal(slotOf(null, 'p1'), null);
  assert.equal(slotOf(slots, null), null);
});

test('cleanSlots drops unknown players, dupes and anything past 6 glasses', () => {
  const ids = ['a', 'b', 'c'];
  assert.deepEqual(cleanSlots(['a', 'zzz', 'b', 'a'], ids), ['a', null, 'b', null, null, null]);
  assert.deepEqual(cleanSlots(null, ids), [null, null, null, null, null, null]);
  assert.deepEqual(cleanSlots(['a', 'b', 'c', 'a', 'b', 'c', 'a'], ids).filter(Boolean).length, 3);
});

test('sceneFor: winner takes precedence and maps to glasses', () => {
  const s = sceneFor(room([{ id: 'p2', score: 10 }, { id: 'p1', score: 3 }]), {});
  assert.equal(s.name, 'winner');
  assert.deepEqual(s.params.slots, [1]);
});

test('sceneFor: a Deadly roulette moment reports the candidates and the landed slot', () => {
  const r = room(null);
  const drink = { moment: { kind: 'roulette', targets: ['p2'], candidates: ['p1', 'p2'] } };
  const s = sceneFor(r, { drink });
  assert.equal(s.name, 'roulette');
  assert.deepEqual(s.params.candidateSlots, [0, 1]);
  assert.equal(s.params.landedSlot, 1);
});

test('sceneFor: a plain shot is a deadly takeover on the target\'s glass', () => {
  const s = sceneFor(room(null), { drink: { moment: { kind: 'shot', targets: ['p1'] } } });
  assert.equal(s.name, 'deadlyTakeover');
  assert.deepEqual(s.params.slots, [0]);
});

test('sceneFor: a Mercy (water) moment is not a spotlight - it is idle', () => {
  const s = sceneFor(room(null), { drink: { moment: { kind: 'water', targets: [] } } });
  assert.equal(s.name, 'idle');
});

test('sceneFor: a short deadline is a countdown, a long one is not', () => {
  const r = room(null);
  assert.equal(sceneFor(r, { deadline: { at: 1_020_000 }, now: 1_000_000 }).name, 'idle'); // 20s out
  assert.equal(sceneFor(r, { deadline: { at: 1_010_000 }, now: 1_000_000 }).name, 'countdown'); // 10s out
  assert.equal(sceneFor(r, { deadline: { at: 999_000 }, now: 1_000_000 }).name, 'idle'); // already past
});

test('sceneFor: team colours only show once nothing more urgent is happening', () => {
  const r = { state: null, box: { slots: ['p1', 'p2', null, null, null, null] }, teams: [{ color: '#f00', memberIds: ['p1'] }, { color: '#0f0', memberIds: ['p2'] }] };
  const s = sceneFor(r, {});
  assert.equal(s.name, 'teamColours');
  assert.deepEqual(s.params.teams, [{ color: '#f00', slots: [0] }, { color: '#0f0', slots: [1] }]);
});

test('sceneFor: idle is the fallback', () => {
  assert.equal(sceneFor({ state: null, box: null, teams: null }, {}).name, 'idle');
});

const okEngine = { hostActions: () => [{ type: 'nextRound', label: 'Next round', tone: 'primary' }] };

test('buttonModeFor: lobby is start, between-games is next, recap is idle', () => {
  assert.deepEqual(buttonModeFor({ state: null, stage: 'lobby' }, {}).mode, 'start');
  assert.deepEqual(buttonModeFor({ state: null, stage: 'between' }, {}).mode, 'next');
  assert.deepEqual(buttonModeFor({ state: null, stage: 'recap' }, {}).mode, 'idle');
});

test('buttonModeFor: the game ending is standings, before any per-game button', () => {
  const r = { state: { $over: {} } };
  assert.equal(buttonModeFor(r, { engine: okEngine }, {}).mode, 'standings');
});

test('buttonModeFor: falls back to the one tone:primary host action with no confirm', () => {
  const r = { state: {} };
  const m = buttonModeFor(r, { engine: okEngine }, {});
  assert.equal(m.mode, 'next');
  assert.equal(m.type, 'nextRound');
});

test('buttonModeFor: a primary action with a confirm is never auto-fired', () => {
  const engine = { hostActions: () => [{ type: 'danger', label: 'Reset', tone: 'primary', confirm: 'Sure?' }] };
  assert.equal(buttonModeFor({ state: {} }, { engine }, {}).mode, 'idle');
});

test('buttonModeFor: an engine-defined boxButton wins over the default', () => {
  const engine = {
    hostActions: () => [{ type: 'revealNow', label: 'Reveal', tone: 'secondary' }],
    boxButton: (state) => (state.phase === 'buzzer' ? { mode: 'buzzer', label: 'Buzz in', action: { type: 'buzz' }, asHost: false } : null),
  };
  const m = buttonModeFor({ state: { phase: 'buzzer' } }, { engine }, {});
  assert.equal(m.mode, 'buzzer');
  assert.equal(m.type, 'buzz');
  assert.equal(m.asAssigned, true);
});

test('buttonModeFor: a throwing boxButton falls back cleanly', () => {
  const engine = { hostActions: () => [{ type: 'ok', label: 'Ok', tone: 'primary' }], boxButton: () => { throw new Error('boom'); } };
  assert.equal(buttonModeFor({ state: {} }, { engine }, {}).type, 'ok');
});

test('sameDescriptor compares by value, not identity', () => {
  assert.ok(sameDescriptor({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] }));
  assert.ok(!sameDescriptor({ a: 1 }, { a: 2 }));
});
