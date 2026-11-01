// The "Categories" picker and the deck it deals from both used to read two
// different lists: a hardcoded array in engine.js for the picker, and
// content.json for the actual words. A category added only to content.json
// was therefore unreachable. Guards that regression: every content.json
// category must appear in the picker, and every one of them, old or new,
// must actually deal cards drawn from its own items.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as engine from './engine.js';
import { createGame } from '../_kit/runtime.js';

const content = JSON.parse(readFileSync(new URL('./content.json', import.meta.url), 'utf8'));
const PLAYERS = ['Ana', 'Ben', 'Cy'].map((name, i) => ({ id: `p${i + 1}`, name, color: '#ff6b6b' }));

test('heads: every content.json category is offered by the Categories picker', () => {
  const choices = engine.meta.options.find((o) => o.key === 'categories').choices.map((c) => c.value);
  assert.deepEqual(new Set(choices), new Set(Object.keys(content.categories)), 'picker choices must match content.json exactly');
  const def = engine.meta.options.find((o) => o.key === 'categories').default;
  assert.deepEqual(new Set(def), new Set(Object.keys(content.categories)), 'default must include every category');
});

test('heads: every category deals real cards drawn only from its own items', () => {
  for (const key of Object.keys(content.categories)) {
    const { state } = createGame(engine, {
      players: PLAYERS, variant: 'standard', mode: 'room',
      options: { categories: [key] }, content, now: 1_000,
    });
    assert.ok(state.deck.length > 0, `${key}: deck must not be empty`);
    for (const word of state.deck) {
      assert.ok(content.categories[key].items.includes(word), `${key}: dealt "${word}" is not one of that category's items`);
    }
  }
});

// A name listed in two categories (Harry Potter is a movie and a character)
// used to go into the deck twice, so one game could deal it twice.
test('heads: the deck never holds the same card twice, even across categories', () => {
  const all = Object.values(content.categories).flatMap((c) => c.items);
  assert.ok(all.length > new Set(all).size, 'precondition: some name is in two categories');
  const { state } = createGame(engine, { players: PLAYERS, variant: 'standard', mode: 'room', options: {}, content, now: 1_000 });
  assert.equal(state.deck.length, new Set(state.deck).size, `deck repeats: ${state.deck.filter((w, i) => state.deck.indexOf(w) !== i).join(', ')}`);
});
