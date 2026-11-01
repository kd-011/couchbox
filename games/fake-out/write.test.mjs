// Two players writing the same fake used to put two identical answers on the
// vote screen, both marked "Yours" for each author. The second one is now
// asked to write something else, like a fake that matches the truth.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as engine from './engine.js';
import * as rt from '../_kit/runtime.js';

const content = JSON.parse(readFileSync(new URL('./content.json', import.meta.url), 'utf8'));
const PLAYERS = ['Ana', 'Ben', 'Cy'].map((name, i) => ({ id: `p${i + 1}`, name, color: '#ff6b6b' }));

test('fake-out: a fake someone else already wrote is refused, case and spacing aside', () => {
  const ctx = { players: PLAYERS, content, rng: () => 0.3, now: 1_000 };
  let { state } = rt.createGame(engine, { players: PLAYERS, variant: 'standard', mode: 'room', options: {}, content, rng: ctx.rng, now: 1_000 });
  assert.equal(state.phase, 'write');
  const write = (from, text) => rt.applyAction(engine, state, { type: 'write', payload: { text }, from, host: from === 'p1' }, ctx);
  let r = write('p1', 'Pickled onions');
  assert.ok(!r.error, r.error);
  state = r.state;
  r = write('p2', '  pickled   ONIONS ');
  assert.ok(r.error, 'a duplicate fake must be refused');
  assert.match(r.error, /already/i);
  // Rewriting your own fake to the same text is fine.
  r = write('p1', 'Pickled onions');
  assert.ok(!r.error, r.error);
  r = write('p2', 'Beetroot');
  assert.ok(!r.error, r.error);
});
