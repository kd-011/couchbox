// The home page paints its header straight from index.html (the "boot"
// header) before the app's modules arrive, which is what keeps the first
// and largest paint early. It has to stay identical to the header app.js
// renders, and stay hidden on every other route.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(`../public/${p}`, import.meta.url)), 'utf8');

test('the boot header in index.html matches the one the home screen renders', () => {
  const html = read('index.html');
  const boot = /<div class="screen home" id="boot"><header class="home-top"><div>(.*?)<\/div><\/header><\/div>/.exec(html);
  assert.ok(boot, 'index.html has the boot header');
  const app = read('js/app.js');
  const live = /<header class="home-top">\s*<div>\s*(<h1 class="wordmark">.*?<\/h1>)\s*(<p class="home-pitch">.*?<\/p>)/s.exec(app);
  assert.ok(live, 'app.js renders the home header');
  assert.equal(boot[1], live[1] + live[2], 'boot header and live header must match, or the home page jumps on load');
});

test('the boot header hides itself on every route but the home page', () => {
  const html = read('index.html');
  assert.match(html, /<script>if \(location\.pathname !== '\/' \|\| location\.hash\.length > 2\) document\.getElementById\('boot'\)\.hidden = true;<\/script>/);
  // And the first screen the app renders does not fade in over it again.
  assert.match(read('js/app.js'), /boot && !boot\.hidden/);
});

test('the game list is fetched from the HTML, not after the modules', () => {
  assert.match(read('index.html'), /<link rel="preload" href="\/games\/index\.json" as="fetch" crossorigin>/);
});
