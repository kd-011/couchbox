// The home page draws each game as a card: a one-line pitch, a typical
// length and a few kind tags come from the game's own meta (optional fields,
// see docs/GAME-MODULES.md), served in /games/index.json. A new game that
// fills them in gets a proper card for free.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadGames, publicIndex } from '../lib/registry.mjs';

const GAMES_DIR = fileURLToPath(new URL('../games', import.meta.url));
const games = await loadGames(GAMES_DIR, { strict: true });
const index = publicIndex(games);
const VIBES = ['bluff', 'brain', 'silly'];

test('every game card has a pitch, a length and valid tags', () => {
  assert.ok(index.length >= 15);
  for (const g of index) {
    assert.equal(typeof g.pitch, 'string', `${g.id}: pitch`);
    assert.ok(g.pitch.length >= 15 && g.pitch.length <= 60, `${g.id}: pitch is ${g.pitch.length} chars, wants 15-60`);
    assert.ok(!/[\u2014\u2013]/.test(g.pitch), `${g.id}: no dashes in the pitch`);
    assert.ok(Array.isArray(g.minutes) && g.minutes.length === 2, `${g.id}: minutes [lo, hi]`);
    const [lo, hi] = g.minutes;
    assert.ok(Number.isInteger(lo) && Number.isInteger(hi) && lo >= 3 && lo <= hi && hi <= 120, `${g.id}: minutes ${g.minutes}`);
    assert.ok(Array.isArray(g.vibes) && g.vibes.every((v) => VIBES.includes(v)), `${g.id}: vibes ${g.vibes}`);
  }
});

test('the card fields are optional: a game without them still lists', () => {
  const bare = new Map([['x', {
    id: 'x', files: [], style: false, curated: new Map(),
    engine: { meta: { id: 'x', name: 'X', emoji: 'x', tagline: 't', minPlayers: 2, maxPlayers: 4, variants: {} } },
  }]]);
  const [g] = publicIndex(bare);
  assert.equal(g.pitch, 't');
  assert.equal(g.minutes, null);
  assert.deepEqual(g.vibes, []);
});

test('every filter chip has at least one game, and Quick is not everything', () => {
  for (const v of VIBES) assert.ok(index.some((g) => g.vibes.includes(v)), `no game tagged ${v}`);
  const quick = index.filter((g) => g.minutes && g.minutes[1] <= 20);
  assert.ok(quick.length >= 3 && quick.length < index.length, `${quick.length} quick games`);
});
