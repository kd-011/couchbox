// Custom content packs: storage, validation, profanity gate, rate limit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makePacks } from '../lib/packs.mjs';
import { loadGames } from '../lib/registry.mjs';

const GAMES_DIR = fileURLToPath(new URL('../games', import.meta.url));
const games = await loadGames(GAMES_DIR, { strict: true });

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'games-packs-'));
  const packs = makePacks({ dir, games, log: () => {} });
  return { packs, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const WORDS = (n) => Array.from({ length: n }, (_, i) => ({ category: '', word: `word${i}` }));

test('creates a pack and gives back a loadable code', () => {
  const { packs, cleanup } = setup();
  try {
    const r = packs.create({ ip: '1.1.1.1', gameId: 'imposter', title: 'My pack', items: WORDS(8) });
    assert.equal(r.error, undefined);
    assert.match(r.pack.code, /^[a-z0-9]{8}$/);
    const fetched = packs.get(r.pack.code);
    assert.equal(fetched.title, 'My pack');
    assert.equal(fetched.items.length, 8);
    assert.equal(fetched.gameId, 'imposter');
    assert.equal(fetched.source, 'custom');
  } finally { cleanup(); }
});

test('rejects a game with no pack schema', () => {
  const { packs, cleanup } = setup();
  try {
    const r = packs.create({ ip: '1.1.1.1', gameId: 'quiz-show', title: 'x', items: WORDS(8) });
    assert.match(r.error, /does not take custom packs/);
  } finally { cleanup(); }
});

test('enforces minItems and maxItems', () => {
  const { packs, cleanup } = setup();
  try {
    const short = packs.create({ ip: '1.1.1.1', gameId: 'imposter', title: 'x', items: WORDS(2) });
    assert.match(short.error, /at least/);
    const long = packs.create({ ip: '1.1.1.1', gameId: 'imposter', title: 'x', items: WORDS(500) });
    assert.match(long.error, /capped/);
  } finally { cleanup(); }
});

test('rejects an item missing a required field', () => {
  const { packs, cleanup } = setup();
  try {
    const items = [...WORDS(7), { category: '', word: '   ' }];
    const r = packs.create({ ip: '1.1.1.1', gameId: 'imposter', title: 'x', items });
    assert.match(r.error, /needs word/);
  } finally { cleanup(); }
});

test('an optional field can be blank', () => {
  const { packs, cleanup } = setup();
  try {
    const r = packs.create({ ip: '1.1.1.1', gameId: 'imposter', title: 'x', items: WORDS(8) });
    assert.equal(r.error, undefined);
  } finally { cleanup(); }
});

test('rejects profanity in the title or an item', () => {
  const { packs, cleanup } = setup();
  try {
    const r1 = packs.create({ ip: '1.1.1.1', gameId: 'imposter', title: 'fuck pack', items: WORDS(8) });
    assert.match(r1.error, /can't host/);
    const items = [...WORDS(7), { category: '', word: 'shit' }];
    const r2 = packs.create({ ip: '1.1.1.1', gameId: 'imposter', title: 'clean', items });
    assert.match(r2.error, /can't host/);
  } finally { cleanup(); }
});

test('rate-limits custom pack creation per IP', () => {
  const { packs, cleanup } = setup();
  try {
    for (let i = 0; i < 20; i++) {
      const r = packs.create({ ip: '2.2.2.2', gameId: 'imposter', title: `p${i}`, items: WORDS(8) });
      assert.equal(r.error, undefined, `pack ${i} should succeed`);
    }
    const over = packs.create({ ip: '2.2.2.2', gameId: 'imposter', title: 'one too many', items: WORDS(8) });
    assert.match(over.error, /Too many packs/);
    // A different IP is unaffected.
    const other = packs.create({ ip: '3.3.3.3', gameId: 'imposter', title: 'fine', items: WORDS(8) });
    assert.equal(other.error, undefined);
  } finally { cleanup(); }
});

test('an AI-sourced pack is exempt from the custom-create rate limit', () => {
  const { packs, cleanup } = setup();
  try {
    for (let i = 0; i < 20; i++) packs.create({ ip: '4.4.4.4', gameId: 'imposter', title: `p${i}`, items: WORDS(8) });
    const ai = packs.create({ ip: '4.4.4.4', gameId: 'imposter', title: 'ai pack', items: WORDS(8), source: 'ai' });
    assert.equal(ai.error, undefined);
    assert.equal(ai.pack.source, 'ai');
  } finally { cleanup(); }
});

test('get() rejects a malformed or unknown code', () => {
  const { packs, cleanup } = setup();
  try {
    assert.equal(packs.get('not a code!'), null);
    assert.equal(packs.get('zzzzzzzz'), null);
  } finally { cleanup(); }
});

test('contentFor applies the pack through the game\'s own apply(), falls back when the pack is dead or foreign', () => {
  const { packs, cleanup } = setup();
  try {
    const r = packs.create({ ip: '1.1.1.1', gameId: 'imposter', title: 'Space', items: [{ category: 'Space', word: 'Nebula' }, { category: 'Space', word: 'Comet' }, ...WORDS(6)] });
    const content = packs.contentFor('imposter', r.pack.code);
    assert.ok(content.categories.space.items.includes('Nebula'));
    // Foreign game id: falls back to the built-in content instead of throwing.
    const fallback = packs.contentFor('wyr', r.pack.code);
    assert.ok(Array.isArray(fallback.pairs));
    // Unknown code: also falls back.
    const dead = packs.contentFor('imposter', 'nosuchcode');
    assert.ok(dead.categories && !dead.categories.space);
    // No code at all: built-in content, untouched.
    assert.deepEqual(packs.contentFor('imposter', null), games.get('imposter').content);
  } finally { cleanup(); }
});
