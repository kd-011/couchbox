import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as voice from '../lib/voice.mjs';

const nameOf = (id) => ({ p1: 'Sam', p2: 'Alex' }[id] || '');

test('roundStart names the game, and mentions Deadly only in that tier', () => {
  assert.match(voice.roundStart({ name: 'Imposter', variant: 'standard' }), /Imposter/);
  assert.doesNotMatch(voice.roundStart({ name: 'Imposter', variant: 'standard' }), /Deadly/);
  assert.match(voice.roundStart({ name: 'Imposter', variant: 'deadly' }), /Deadly/);
});

test('deadlyMoment names the target for a shot, roulette and last place', () => {
  assert.match(voice.deadlyMoment({ kind: 'shot', targets: ['p1'] }, nameOf), /Sam/);
  assert.match(voice.deadlyMoment({ kind: 'roulette', targets: ['p2'] }, nameOf), /Alex/);
  assert.match(voice.deadlyMoment({ kind: 'last', targets: ['p1'] }, nameOf), /Sam/);
});

test('deadlyMoment never crashes with no resolvable name', () => {
  assert.equal(typeof voice.deadlyMoment({ kind: 'shot', targets: [] }, nameOf), 'string');
  assert.equal(typeof voice.deadlyMoment({ kind: 'card', title: 'Tall Poppy', targets: [] }, nameOf), 'string');
});

test('gameOver names the top scorer, and copes with no board', () => {
  assert.match(voice.gameOver([{ id: 'p1', score: 10 }, { id: 'p2', score: 3 }], nameOf), /Sam/);
  assert.equal(typeof voice.gameOver([], nameOf), 'string');
  assert.equal(typeof voice.gameOver(null, nameOf), 'string');
});

test('gameOver joins two or more tied winners with "and"', () => {
  const line = voice.gameOver([{ id: 'p1', score: 5 }, { id: 'p2', score: 5 }], nameOf);
  assert.match(line, /Sam and Alex/);
});

test('recap names whoever leads the night on points', () => {
  assert.match(voice.recap({ points: { p1: 4, p2: 1 } }, nameOf), /Sam/);
  assert.equal(typeof voice.recap({ points: {} }, nameOf), 'string');
});
