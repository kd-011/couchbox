// Guards for the phone-first kit pass (ee2ae39): every page pins the dark
// theme so a light-mode phone does not flip color-scheme under the kit's
// light media query, and the status strip hide only applies to the two games
// that drop it (Imposter and Celebrity Heads), not every pass-the-phone game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (rel) => readFileSync(`${ROOT}${rel}`, 'utf8');

test('every page pins data-theme="dark" on <html>', () => {
  const pages = readdirSync(`${ROOT}public`).filter((f) => f.endsWith('.html'));
  assert.ok(pages.length >= 5, `found ${pages.length} pages`);
  for (const f of pages) {
    const open = read(`public/${f}`).match(/<html\b[^>]*>/);
    assert.ok(open, `${f}: no <html> tag`);
    assert.match(open[0], /data-theme="dark"/, `${f}: <html> needs data-theme="dark"`);
  }
  assert.match(read('server.mjs'), /<html lang="en" data-theme="dark">/, 'the game share page template too');
});

test('the status strip is hidden only for Imposter and Celebrity Heads', () => {
  const rule = read('public/style.css').split('\n').find((l) => l.includes('.pass-screen') && l.includes(' .now'));
  assert.ok(rule, 'the strip hide rule exists');
  const scopes = [...rule.matchAll(/\.pass-screen\[data-game='([^']+)'\] \.now/g)].map((m) => m[1]);
  assert.deepEqual(scopes.sort(), ['heads', 'imposter']);
  assert.doesNotMatch(rule, /(^|,)\s*\.pass-screen \.now/, 'no unscoped hide for every pass game');
  // The scope is keyed on the attribute pass.js sets on the same element.
  assert.match(read('public/js/pass.js'), /class="screen play-screen pass-screen" data-game="\$\{saved\.gameId\}"/);
});
