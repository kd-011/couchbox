// A module the app imports but the service worker does not precache breaks
// offline starts: the shell loads, then the import 404s with no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pub = (p) => fileURLToPath(new URL(`../public/${p}`, import.meta.url));

test('every public/js module another module imports is in the service worker shell', () => {
  const sw = readFileSync(pub('sw.js'), 'utf8');
  const imported = new Set();
  for (const f of readdirSync(pub('js')).filter((n) => n.endsWith('.js'))) {
    for (const m of readFileSync(pub(`js/${f}`), 'utf8').matchAll(/from '\.\/([\w-]+\.js)'/g)) imported.add(m[1]);
  }
  const missing = [...imported].filter((f) => !sw.includes(`'/js/${f}'`));
  assert.deepEqual(missing, [], `precache these in public/sw.js: ${missing.join(', ')}`);
});
