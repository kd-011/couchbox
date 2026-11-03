// The curated library bar: how many themed packs a game with a deck must ship
// and how big each one is. test/curated.test.mjs proves every pack is valid
// and plays; this proves there are enough of them, and big enough, to be a
// library worth browsing. The first block covers the seven smaller-deck games,
// the second imposter, heads, wyr, nhie, tod and paranoia, which also get
// variety and gating checks. Salad Bowl and Werewolf have no deck
// (content.json is empty), so they have no packs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadGames } from '../lib/registry.mjs';
import { countItems } from '../lib/curated.mjs';

const games = await loadGames(fileURLToPath(new URL('../games', import.meta.url)), { strict: true });

// game id -> { min packs, min deck entries per pack, optional per-key minimum }
const BAR = {
  mlt: { packs: 10, items: 40 },
  'tune-in': { packs: 10, items: 40 },
  codewords: { packs: 10, items: 80 },
  spyfall: { packs: 10, items: 10 },
  sketchy: { packs: 10, items: 40, perKey: 12 },
  'fake-out': { packs: 10, items: 40 },
  'quiz-show': { packs: 10, items: 20 },
};

for (const [id, bar] of Object.entries(BAR)) {
  test(`${id}: ships a library of at least ${bar.packs} curated packs, each of real size`, () => {
    const g = games.get(id);
    assert.ok(g, `${id} not found`);
    const packs = [...g.curated.values()];
    assert.ok(packs.length >= bar.packs, `${id}: ${packs.length} curated packs, want ${bar.packs}+`);
    for (const p of packs) {
      assert.ok(countItems(p.content) >= bar.items, `${id}/${p.id}: ${countItems(p.content)} items, want ${bar.items}+`);
      if (bar.perKey) {
        for (const [k, v] of Object.entries(p.content)) {
          assert.ok(v.length >= bar.perKey, `${id}/${p.id}: ${k} has ${v.length}, want ${bar.perKey}+`);
        }
      }
    }
    const titles = packs.map((p) => p.title.toLowerCase());
    assert.equal(new Set(titles).size, titles.length, `${id}: duplicate pack titles`);
    const emojis = packs.map((p) => p.emoji);
    assert.equal(new Set(emojis).size, emojis.length, `${id}: two packs share an emoji`);
  });
}

test('salad-bowl and werewolf stay deckless (no packs, nothing to curate)', () => {
  for (const id of ['salad-bowl', 'werewolf']) {
    const g = games.get(id);
    assert.deepEqual(g.content, {}, `${id}: content.json is no longer empty, so it needs packs`);
    assert.equal(g.curated.size, 0);
  }
});

/* imposter, heads, wyr, nhie, tod, paranoia */

const MIN_PACKS = 10;
const MIN_ITEMS = 40;
const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Every playable string of a pack, as the text a player would recognise it by.
function texts(game, content) {
  const out = [];
  const add = (s) => { if (typeof s === 'string' && s.trim()) out.push(norm(s)); };
  for (const [k, v] of Object.entries(content)) {
    if (k === 'categories') for (const c of Object.values(v)) c.items.forEach(add);
    else if (k === 'pairs') v.forEach((p) => add(`${p.a} | ${p.b}`));
    else if (k === 'questions') v.forEach((q) => add(q.text));
    else if (Array.isArray(v)) v.forEach(add);
    else for (const lvl of Object.values(v)) (Array.isArray(lvl) ? lvl : []).forEach(add);
  }
  return out;
}

for (const id of ['imposter', 'heads', 'wyr', 'nhie', 'tod', 'paranoia']) {
  const g = games.get(id);
  const packs = [...g.curated.values()];

  test(`${id}: at least ${MIN_PACKS} curated packs, each ${MIN_ITEMS}+ items with a blurb and tags`, () => {
    assert.ok(packs.length >= MIN_PACKS, `${id}: ${packs.length} packs, want ${MIN_PACKS}+`);
    for (const p of packs) {
      assert.ok(p.count >= MIN_ITEMS, `${id}/${p.id}: ${p.count} items, want ${MIN_ITEMS}+`);
      assert.ok(p.tags.length >= 1, `${id}/${p.id}: needs at least one tag for the filter chips`);
    }
    assert.equal(new Set(packs.map((p) => p.title)).size, packs.length, `${id}: two packs share a title`);
    assert.equal(new Set(packs.map((p) => p.emoji)).size, packs.length, `${id}: two packs share an emoji`);
  });

  test(`${id}: no two packs repeat the same item, and none repeats the built-in deck`, () => {
    const seen = new Map();
    const dupes = [];
    for (const p of packs) {
      for (const t of texts(g, p.content)) {
        if (seen.has(t) && seen.get(t) !== p.id) dupes.push(`"${t.slice(0, 50)}" in ${seen.get(t)} and ${p.id}`);
        else seen.set(t, p.id);
      }
    }
    // Words and names (imposter, heads) legitimately live in the built-in
    // categories too; sentences must not.
    if (!['imposter', 'heads'].includes(id)) {
      const builtin = new Set(texts(g, g.content));
      for (const [t, pid] of seen) if (builtin.has(t)) dupes.push(`"${t.slice(0, 50)}" in ${pid} is already in the built-in deck`);
    }
    assert.deepEqual(dupes.slice(0, 20), [], `${dupes.length} repeats`);
  });
}

test('imposter and heads: every pack brings 2 to 4 categories of 8+ items', () => {
  for (const id of ['imposter', 'heads']) {
    for (const p of games.get(id).curated.values()) {
      const cats = Object.values(p.content.categories);
      assert.ok(cats.length >= 2 && cats.length <= 4, `${id}/${p.id}: ${cats.length} categories`);
      for (const c of cats) assert.ok(c.items.length >= 8, `${id}/${p.id}/${c.label}: ${c.items.length} items`);
    }
  }
});

test('tod: every pack brings 20+ mild truths and 20+ mild dares, and spicy material stays under spicy/wild', () => {
  for (const p of games.get('tod').curated.values()) {
    assert.ok(p.content.mild && p.content.mild.truth.length >= 20 && p.content.mild.dare.length >= 20, `tod/${p.id}: mild needs 20 truths and 20 dares`);
    for (const lvl of ['spicy', 'wild']) {
      if (p.content[lvl]) assert.ok(p.content[lvl].truth.length >= 8 && p.content[lvl].dare.length >= 8, `tod/${p.id}: ${lvl} needs 8+ of each`);
    }
  }
});

test('paranoia: every pack has 30+ clean questions and spicy ones are a minority', () => {
  for (const p of games.get('paranoia').curated.values()) {
    const qs = p.content.questions;
    const spicy = qs.filter((q) => q.spicy).length;
    assert.ok(qs.length - spicy >= 30, `paranoia/${p.id}: ${qs.length - spicy} clean questions`);
    assert.ok(spicy <= qs.length * 0.3, `paranoia/${p.id}: ${spicy} spicy of ${qs.length}`);
  }
});

test('nhie: spicy prompts are an extra, never the bulk, and wyr/imposter/heads carry no spicy material', () => {
  for (const p of games.get('nhie').curated.values()) {
    assert.ok(p.content.prompts.length >= 40, `nhie/${p.id}: ${p.content.prompts.length} clean prompts`);
    assert.ok(!p.content.spicy || p.content.spicy.length <= 20, `nhie/${p.id}: too much spicy`);
  }
  for (const id of ['wyr', 'imposter', 'heads']) for (const p of games.get(id).curated.values()) assert.equal(p.spicy, false, `${id}/${p.id}`);
});

test('countItems agrees with the pack catalogue', () => {
  for (const id of ['wyr', 'paranoia']) for (const p of games.get(id).curated.values()) assert.equal(p.count, countItems(p.content, { spicyKeys: [] }));
});
