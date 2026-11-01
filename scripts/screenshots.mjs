// README screenshots from a local run: a phone (390x844, 2x) and a desktop
// (1440x900) of the home screen and a game's set-up screen.
//   node server.mjs &            (or any running instance)
//   node scripts/screenshots.mjs [baseUrl] [outDir]
// Defaults: http://127.0.0.1:8969, docs/screenshots.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:8969';
const OUT = process.argv[3] || join(fileURLToPath(new URL('..', import.meta.url)), 'docs', 'screenshots');
mkdirSync(OUT, { recursive: true });
const SIZES = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  desktop: { viewport: { width: 1440, height: 900 } },
};
// Skip the first-run age gate and how-to overlays so the shots show the app itself.
const SEEN = { 'games.18ok': '1', 'games.deadlyok': '1', 'games.howto.imposter': '1' };
const browser = await chromium.launch();
for (const [size, opts] of Object.entries(SIZES)) {
  const ctx = await browser.newContext({ ...opts, reducedMotion: 'reduce' });
  await ctx.addInitScript((p) => { for (const [k, v] of Object.entries(p)) localStorage.setItem(k, v); }, SEEN);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await page.locator('.game-card, .game-row, [data-game]').first().waitFor({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(OUT, `${size}-home.png`) });
  await page.goto(`${BASE}/#/new/imposter/pass/standard`);
  await page.locator('#pass-form').waitFor();
  const inputs = page.locator('#names input');
  for (const [i, n] of ['Ana', 'Ben', 'Cy'].entries()) await inputs.nth(i).fill(n);
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, `${size}-setup.png`) });
  await ctx.close();
  console.log(`${size}: ok`);
}
await browser.close();
