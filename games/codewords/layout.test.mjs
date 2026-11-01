// Long words (SCREENSAVER, CLAPPERBOARD) used to break mid-word on a phone's
// five-column board. Tiles now shrink a step for words over 10 letters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const noop = () => {};
// The client kit ticks countdowns on an interval; never let it hold the test open.
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (...a) => { const t = realSetInterval(...a); t.unref?.(); return t; };
const el = () => ({ dataset: {}, style: {}, classList: { add: noop, remove: noop, toggle: noop }, appendChild: noop, setAttribute: noop, addEventListener: noop, querySelector: () => null, querySelectorAll: () => [] });
globalThis.document ??= { ...el(), body: el(), documentElement: el(), createElement: el, getElementById: () => null };
globalThis.localStorage ??= { getItem: () => null, setItem: noop, removeItem: noop };
const { makeApi } = await import('../../public/js/surface.js');
const engine = await import('./engine.js');
const client = await import('./client.js');
const rt = await import('../_kit/runtime.js');

test('codewords: words over 10 letters get the extra-small tile class, shorter ones do not', () => {
  const words = ['Screensaver', 'Clapperboard', 'Fax', 'Lego', 'Blackberry', ...Array.from({ length: 30 }, (_, i) => `Word${String.fromCharCode(65 + (i % 26))}${i}`)];
  const content = { words };
  const players = ['Ana', 'Ben', 'Cy', 'Dee'].map((name, i) => ({ id: `p${i}`, name, color: '#fff' }));
  const { state } = rt.createGame(engine, { players, variant: 'standard', mode: 'room', options: {}, content, rng: Math.random, now: 1 });
  const html = String(client.tv(engine.tvView(state, { players, content }), makeApi({ surface: 'tv', players, mode: 'room', variant: 'standard' })));
  for (const t of state.tiles) {
    const m = new RegExp(`class="cw-tile[^"]*"[^>]*data-arg="${t.word}"`).exec(html);
    assert.ok(m, `tile for ${t.word}`);
    assert.equal(/cw-xlong/.test(m[0]), t.word.length > 10, `${t.word}: ${m[0]}`);
  }
  assert.match(readFileSync(new URL('./style.css', import.meta.url), 'utf8'), /\.cw-tile\.cw-xlong\s*\{/);
});
