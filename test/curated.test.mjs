// Curated packs: the built-in, hand-written themed decks in games/<id>/packs/.
// This file is the safety net for every pack of every game: each one is
// validated (shape against the game's content.json, item minimums, length
// caps, duplicates, em dashes, profanity outside spicy material) and then
// actually played by the bots in both modes, so a pack that would crash or
// stall a game fails here, not at a party. Adding a pack needs no edit here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadGames, publicIndex } from '../lib/registry.mjs';
import {
  validateCuratedPack, curatedBundle, curatedCode, curatedIdOf, countItems, DEFAULT_MIN_ITEMS,
} from '../lib/curated.mjs';
import * as rt from '../games/_kit/runtime.js';

const GAMES_DIR = fileURLToPath(new URL('../games', import.meta.url));
const games = await loadGames(GAMES_DIR, { strict: true });

// Games with no deck at all (players write their own clues; roles only).
const NO_DECK = new Set(['salad-bowl', 'werewolf']);

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

test('every curated pack of every game validates', () => {
  const all = [];
  for (const g of games.values()) for (const p of g.curatedProblems || []) all.push(`${g.id}: ${p}`);
  assert.deepEqual(all, [], `curated pack problems:\n${all.join('\n')}`);
});

test('every game with a deck ships at least 3 curated packs', () => {
  for (const g of games.values()) {
    if (NO_DECK.has(g.id)) continue;
    assert.ok(g.curated instanceof Map, `${g.id}: game.curated must be a Map`);
    assert.ok(g.curated.size >= 3, `${g.id}: only ${g.curated.size} curated packs`);
  }
});

test('curated codes round-trip and never collide with custom pack codes', () => {
  assert.equal(curatedCode('office'), 'c:office');
  assert.equal(curatedIdOf('c:office'), 'office');
  assert.equal(curatedIdOf('7k2n9dqf'), null);
  assert.equal(curatedIdOf(null), null);
  assert.equal(curatedIdOf(42), null);
  assert.equal(curatedIdOf('c:../x'), null);
});

test('withCurated: keys the pack provides replace the built-in, the rest stay', () => {
  const engine = {};
  const builtin = { mild: { truth: ['a'], dare: ['b'] }, spicy: { truth: ['c'], dare: ['d'] } };
  const merged = rt.withCurated(engine, builtin, { mild: { truth: ['x'], dare: ['y'] } });
  assert.deepEqual(merged.mild, { truth: ['x'], dare: ['y'] });
  assert.equal(merged.spicy, builtin.spicy);
  // A game can override the merge with curated.apply.
  const custom = { curated: { apply: (c, p) => ({ only: p.words }) } };
  assert.deepEqual(rt.withCurated(custom, builtin, { words: ['z'] }), { only: ['z'] });
});

/* ---------- the validator itself ---------- */

const wyr = () => games.get('wyr');
const goodPairs = (n, tag = '') => Array.from({ length: n }, (_, i) => ({ a: `Option ${tag}${i} left`, b: `Option ${tag}${i} right` }));
const goodPack = (over = {}) => ({ id: 'test-pack', title: 'Test pack', emoji: '🧪', blurb: 'A pack for the tests.', content: { pairs: goodPairs(30) }, ...over });
const problems = (raw, id = 'test-pack', game = wyr()) => validateCuratedPack(game.engine, game.content, id, raw);

test('validator accepts a well-formed pack', () => {
  assert.deepEqual(problems(goodPack()), []);
});

test('validator rejects the common mistakes', () => {
  const has = (raw, re, id) => {
    const p = problems(raw, id);
    assert.ok(p.some((x) => re.test(x)), `expected ${re} in ${JSON.stringify(p)}`);
  };
  has(goodPack({ id: 'other' }), /id/);
  has(goodPack(), /id/, 'Bad Id');
  has(goodPack({ title: '' }), /title/);
  has(goodPack({ title: 'x'.repeat(80) }), /title/);
  has(goodPack({ emoji: '' }), /emoji/);
  has(goodPack({ blurb: 'y'.repeat(200) }), /blurb/);
  has(goodPack({ content: { pairs: goodPairs(DEFAULT_MIN_ITEMS - 1) } }), /at least/);
  has(goodPack({ content: {} }), /content/);
  has(goodPack({ content: { nope: ['a'] } }), /nope/);
  has(goodPack({ content: { pairs: ['just a string', ...goodPairs(30).slice(1)] } }), /pairs/);
  has(goodPack({ content: { pairs: [{ a: 'only a' }, ...goodPairs(30).slice(1)] } }), /pairs/);
  has(goodPack({ content: { pairs: [{ a: 'x'.repeat(400), b: 'y' }, ...goodPairs(30).slice(1)] } }), /long/);
  has(goodPack({ content: { pairs: [{ a: '   ', b: 'y' }, ...goodPairs(30).slice(1)] } }), /empty/);
  has(goodPack({ content: { pairs: [...goodPairs(30), goodPairs(1)[0]] } }), /duplicate/i);
  has(goodPack({ content: { pairs: [{ a: 'Sing — badly', b: 'Dance' }, ...goodPairs(30).slice(1)] } }), /em dash/);
  has(goodPack({ blurb: 'Fun — for all' }), /em dash/);
  has(goodPack({ content: { pairs: [{ a: 'Eat shit', b: 'Dance' }, ...goodPairs(30).slice(1)] } }), /profan/i);
  has(goodPack({ extra: 1 }), /extra/);
});

test('validator lets spicy material through the profanity gate, but only where the game has spicy keys', () => {
  const tod = games.get('tod');
  const level = (tag, n = 15) => ({
    truth: Array.from({ length: n }, (_, i) => `Truth ${tag} ${i}?`),
    dare: Array.from({ length: n }, (_, i) => `Dare ${tag} ${i}.`),
  });
  const wild = level('wild');
  wild.truth[0] = 'Tell us about a shit date you went on.';
  const ok = validateCuratedPack(tod.engine, tod.content, 'test-pack', { id: 'test-pack', title: 'T', emoji: '🔥', blurb: 'b', content: { mild: level('mild'), wild } });
  assert.deepEqual(ok, []);
  const mild = level('mild');
  mild.truth[0] = 'Tell us about a shit date you went on.';
  const bad = validateCuratedPack(tod.engine, tod.content, 'test-pack', { id: 'test-pack', title: 'T', emoji: '🔥', blurb: 'b', content: { mild } });
  assert.ok(bad.some((x) => /profan/i.test(x)), JSON.stringify(bad));
  // tod levels are records: a level with no dares would leave the game with nothing to draw.
  const half = validateCuratedPack(tod.engine, tod.content, 'test-pack', { id: 'test-pack', title: 'T', emoji: '🔥', blurb: 'b', content: { mild: { truth: level('m', 30).truth } } });
  assert.ok(half.some((x) => /dare/.test(x)), JSON.stringify(half));
});

test('countItems counts deck entries, not the fields inside them', () => {
  assert.equal(countItems({ pairs: goodPairs(7) }), 7);
  assert.equal(countItems({ locations: [{ key: 'a', label: 'A', roles: ['x', 'y', 'z'] }] }), 1);
  assert.equal(countItems({ categories: { a: { label: 'A', items: ['1', '2'] }, b: { label: 'B', items: ['3'] } } }), 3);
});

/* ---------- served and precached for offline play ---------- */

test('curated packs ship as one precached bundle per game, listed in the index', () => {
  const idx = publicIndex(games);
  for (const entry of idx) {
    const g = games.get(entry.id);
    const n = g.curated ? g.curated.size : 0;
    assert.equal(entry.curated, n, `${entry.id}: index curated count`);
    const bundleUrl = `/games/${entry.id}/packs.json`;
    if (n) assert.ok(entry.files.includes(bundleUrl), `${entry.id}: ${bundleUrl} must be in files (the service worker precaches files)`);
    else assert.ok(!entry.files.includes(bundleUrl), `${entry.id}: no packs, no bundle`);
    // The single pack files are folded into the bundle, not precached one by one.
    assert.ok(!entry.files.some((f) => f.includes('/packs/')), `${entry.id}: individual pack files must not be in files`);
  }
  const sw = readFileSync(fileURLToPath(new URL('../public/sw.js', import.meta.url)), 'utf8');
  assert.match(sw, /g\.files/, 'sw.js must precache every game file listed in /games/index.json');
});

test('the bundle carries the catalogue and each pack\'s content, JSON-safe and lean', () => {
  for (const g of games.values()) {
    if (!g.curated || !g.curated.size) continue;
    const bundle = JSON.parse(JSON.stringify(curatedBundle(g)));
    assert.ok(Number.isInteger(bundle.builtinCount) && bundle.builtinCount > 0, `${g.id}: builtinCount`);
    assert.equal(bundle.packs.length, g.curated.size);
    for (const p of bundle.packs) {
      for (const k of ['id', 'title', 'emoji', 'blurb']) assert.equal(typeof p[k], 'string', `${g.id}/${p.id}: ${k}`);
      assert.equal(p.code, curatedCode(p.id));
      assert.ok(p.count >= 1);
      assert.equal(typeof p.spicy, 'boolean');
      assert.ok(Array.isArray(p.tags));
      assert.ok(p.content && typeof p.content === 'object');
    }
  }
});

/* ---------- every pack actually plays ---------- */

const NAMES = ['Ava', 'Ben', 'Cat', 'Dev', 'Eli', 'Fin', 'Gus', 'Hana'];

function botRun(g, content, mode, variant, options, seed, steps = 120) {
  const m = g.engine.meta;
  const rng = seeded(seed);
  const n = Math.min(m.maxPlayers, Math.max(m.minPlayers, 4));
  const players = NAMES.slice(0, n).map((name, i) => ({ id: `p${i}`, name, color: '#ff6b6b' }));
  let now = 1_700_000_000_000;
  const ctx = () => ({ players, content, rng, now });
  const created = rt.createGame(g.engine, { players, variant, mode, options, content, rng, now });
  assert.ok(!created.error, created.error);
  let state = created.state;
  for (let step = 0; step < steps; step++) {
    rt.tvViewOf(g.engine, state, ctx());
    for (const p of players) rt.playerViewOf(g.engine, state, p.id, ctx());
    const candidates = mode === 'pass' ? [rt.passTurnOf(g.engine, state, ctx())] : [null, ...players.map((p) => p.id)];
    const moves = [];
    for (const who of candidates) {
      const a = g.engine.bot(state, who, ctx());
      if (a) moves.push({ who, a });
    }
    const d = rt.deadlineOf(g.engine, state);
    if (!moves.length || (d && rng() < 0.15)) {
      assert.ok(d, `stuck in phase ${state.phase}`);
      now = Math.max(now, d.at);
      state = rt.runDeadlines(g.engine, state, ctx());
    } else {
      const { who, a } = moves[Math.floor(rng() * moves.length)];
      const r = rt.applyAction(g.engine, state, { type: a.type, payload: a.payload ?? null, from: who === null ? (mode === 'room' ? 'p0' : null) : who, host: who === null || who === 'p0' }, ctx());
      assert.ok(!r.error, `bot move ${JSON.stringify(a)} rejected in ${state.phase}: ${r.error} ${r.detail || ''}`);
      state = r.state;
      now += 500;
    }
  }
  return state;
}

// Every option a game exposes that gates spicy material is turned on for one
// of the runs, so spicy-only content gets played too.
function spicyOptions(g) {
  const o = {};
  for (const opt of g.engine.meta.options || []) {
    if (opt.type === 'toggle' && /spic/i.test(opt.key)) o[opt.key] = true;
    if (opt.type === 'choice' && opt.key === 'spice') o[opt.key] = 'wild';
  }
  return o;
}

for (const g of games.values()) {
  if (!g.curated || !g.curated.size) continue;
  test(`${g.id}: every curated pack survives bot play in pass and room`, () => {
    let seed = 1;
    for (const p of g.curated.values()) {
      for (const mode of g.engine.meta.modes || ['pass', 'room']) {
        try {
          botRun(g, p.merged, mode, 'drinking', {}, seed++);
          botRun(g, p.merged, mode, 'standard', spicyOptions(g), seed++, 60);
        } catch (err) {
          err.message = `${g.id}/${p.id} (${mode}): ${err.message}`;
          throw err;
        }
      }
    }
  });
}
