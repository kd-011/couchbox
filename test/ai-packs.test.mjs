// The AI pack maker: daily cap, per-IP limit, profanity gate on the theme,
// and turning a mocked OpenRouter reply into a saved pack. No real network
// calls: fetchImpl is a fake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makePacks } from '../lib/packs.mjs';
import { makeAiPackMaker } from '../lib/ai-packs.mjs';
import { loadGames } from '../lib/registry.mjs';

const GAMES_DIR = fileURLToPath(new URL('../games', import.meta.url));
const games = await loadGames(GAMES_DIR, { strict: true });

function setup({ apiKey = 'test-key', dailyCapUsd = 0.5, now = () => 1_700_000_000_000, cost = 0.001 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'games-ai-packs-'));
  const packs = makePacks({ dir, games, log: () => {} });
  const items = Array.from({ length: 8 }, (_, i) => ({ category: '', word: `thing${i}` }));
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({ title: 'AI pack', items }) } }],
      usage: { cost },
    }),
  });
  const ai = makeAiPackMaker({
    spendFile: join(dir, 'ai-pack-spend.json'), apiKey, model: 'test/model', dailyCapUsd,
    games, packs, fetchImpl, log: () => {}, now,
  });
  return { ai, packs, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('generates and saves a pack from a themed reply', async () => {
  const { ai, cleanup } = setup();
  try {
    const r = await ai.generate({ ip: '1.1.1.1', gameId: 'imposter', theme: '90s AFL' });
    assert.equal(r.error, undefined);
    assert.equal(r.pack.source, 'ai');
    assert.equal(r.pack.title, 'AI pack');
    assert.ok(r.pack.items.length >= 6);
  } finally { cleanup(); }
});

test('no key configured: a friendly unavailable error, no request made', async () => {
  const { ai, cleanup } = setup({ apiKey: '' });
  try {
    const r = await ai.generate({ ip: '1.1.1.1', gameId: 'imposter', theme: 'space' });
    assert.equal(r.error, 'unavailable');
    assert.match(r.message, /taking a break/);
  } finally { cleanup(); }
});

test('rejects a game with no pack schema before spending anything', async () => {
  const { ai, cleanup } = setup();
  try {
    const r = await ai.generate({ ip: '1.1.1.1', gameId: 'quiz-show', theme: 'space' });
    assert.equal(r.error, 'bad');
  } finally { cleanup(); }
});

test('rejects a profane theme without calling the model', async () => {
  const { ai, cleanup } = setup();
  try {
    const r = await ai.generate({ ip: '1.1.1.1', gameId: 'imposter', theme: 'fuck off' });
    assert.equal(r.error, 'bad');
  } finally { cleanup(); }
});

test('an empty theme is rejected', async () => {
  const { ai, cleanup } = setup();
  try {
    const r = await ai.generate({ ip: '1.1.1.1', gameId: 'imposter', theme: '   ' });
    assert.equal(r.error, 'bad');
  } finally { cleanup(); }
});

test('the daily spend cap blocks further generations once reached', async () => {
  // Worst case for one call is ~US$0.0025 (628-ish char prompt, 3000 max
  // tokens, the deliberately pessimistic fallback price): a cap that leaves
  // less than that after the first real (smaller) cost blocks the second.
  const { ai, cleanup } = setup({ dailyCapUsd: 0.004, cost: 0.003 });
  try {
    const first = await ai.generate({ ip: '1.1.1.1', gameId: 'imposter', theme: 'one' });
    assert.equal(first.error, undefined);
    const second = await ai.generate({ ip: '1.1.1.1', gameId: 'imposter', theme: 'two' });
    assert.equal(second.error, 'unavailable');
    assert.match(second.message, /taking a break/);
  } finally { cleanup(); }
});

test('spend persists across a restart (same spend file, same day)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'games-ai-packs-'));
  try {
    const packsA = makePacks({ dir, games, log: () => {} });
    const now = () => 1_700_000_000_000;
    const items = Array.from({ length: 8 }, (_, i) => ({ category: '', word: `thing${i}` }));
    const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ title: 't', items }) } }], usage: { cost: 0.2 } }) });
    const aiA = makeAiPackMaker({ spendFile: join(dir, 'spend.json'), apiKey: 'k', model: 'm', dailyCapUsd: 0.201, games, packs: packsA, fetchImpl, now });
    const r1 = await aiA.generate({ ip: '1.1.1.1', gameId: 'imposter', theme: 'one' });
    assert.equal(r1.error, undefined);
    // A fresh instance (as a restart would make) reads the same file; its
    // remaining headroom (0.001) is less than one call's worst case (~0.0025).
    const packsB = makePacks({ dir, games, log: () => {} });
    const aiB = makeAiPackMaker({ spendFile: join(dir, 'spend.json'), apiKey: 'k', model: 'm', dailyCapUsd: 0.201, games, packs: packsB, fetchImpl, now });
    const r2 = await aiB.generate({ ip: '1.1.1.1', gameId: 'imposter', theme: 'two' });
    assert.equal(r2.error, 'unavailable');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rate-limits generations per IP separately from the spend cap', async () => {
  const { ai, cleanup } = setup({ dailyCapUsd: 100 });
  try {
    for (let i = 0; i < 8; i++) {
      const r = await ai.generate({ ip: '5.5.5.5', gameId: 'imposter', theme: `theme${i}` });
      assert.equal(r.error, undefined, `gen ${i} should succeed`);
    }
    const over = await ai.generate({ ip: '5.5.5.5', gameId: 'imposter', theme: 'one more' });
    assert.equal(over.error, 'unavailable');
    assert.match(over.message, /Too many AI packs/);
  } finally { cleanup(); }
});

test('an OpenRouter error degrades to a friendly message and gives the booked spend back', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'games-ai-packs-'));
  try {
    const packs = makePacks({ dir, games, log: () => {} });
    const fetchImpl = async () => ({ ok: false, status: 401, json: async () => ({}) });
    const ai = makeAiPackMaker({ spendFile: join(dir, 'spend.json'), apiKey: 'k', model: 'm', dailyCapUsd: 0.5, games, packs, fetchImpl, now: () => 1_700_000_000_000 });
    const r = await ai.generate({ ip: '1.1.1.1', gameId: 'imposter', theme: 'space' });
    assert.equal(r.error, 'unavailable');
    assert.equal(ai.status().usd, 0); // the pre-booked worst case was given back
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
