// Design-pass screenshots for the pass-the-phone games (Imposter, Celebrity
// Heads) plus home states, at a phone and desktop size:
//   node e2e/ui-pass.mjs [baseUrl] [outDir]
// Defaults: http://127.0.0.1:8979, /tmp/games-ui-pass. The app ships one
// (dark) theme, so there is no light set.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:8979';
const OUT = process.argv[3] || '/tmp/games-ui-pass';
mkdirSync(OUT, { recursive: true });
const SIZES = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  small: { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  desktop: { viewport: { width: 1440, height: 900 } },
};
const SEEN = { 'games.18ok': '1', 'games.deadlyok': '1', 'games.howto.imposter': '1', 'games.howto.heads': '1' };
const browser = await chromium.launch();
const errors = [];

async function open(size, prefs = SEEN) {
  const ctx = await browser.newContext({ ...SIZES[size], reducedMotion: 'no-preference' });
  await ctx.addInitScript((p) => {
    for (const [k, v] of Object.entries(p)) if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
  }, prefs);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${size}: ${e.message}`));
  return p;
}
async function shot(p, size, name, wait = 700) {
  await p.waitForTimeout(wait);
  await p.screenshot({ path: `${OUT}/${size}-${name}.png` });
  console.log(`  ${size}-${name}`);
}
const names = ['Ana', 'Ben', 'Cy'];
async function setup(p, id, tier = 'standard') {
  await p.goto(`${BASE}/#/new/${id}/pass/${tier}`);
  await p.locator('#pass-form').waitFor();
  const inputs = p.locator('#names input');
  for (const [i, n] of names.entries()) await inputs.nth(i).fill(n);
}

for (const size of Object.keys(SIZES)) {
  console.log(size);
  // Home states: loaded, empty search, loading, error.
  let p = await open(size);
  await p.goto(`${BASE}/`);
  await shot(p, size, '01-home', 1500);
  await p.locator('input[type=search], #search, .search input').first().fill('zzzz').catch(() => {});
  await shot(p, size, '02-home-empty', 600);
  await p.context().close();
  p = await open(size);
  await p.route('**/games/index.json', async (r) => { await new Promise((s) => setTimeout(s, 4000)); r.continue(); });
  await p.goto(`${BASE}/`);
  await shot(p, size, '03-home-loading', 900);
  await p.context().close();
  p = await open(size);
  await p.route('**/games/index.json', (r) => r.abort());
  await p.goto(`${BASE}/`);
  await shot(p, size, '04-home-error', 4000);
  await p.context().close();

  // Imposter, one phone.
  p = await open(size);
  await p.goto(`${BASE}/#/new/imposter`);
  await shot(p, size, '10-imp-start');
  await setup(p, 'imposter');
  await shot(p, size, '11-imp-setup');
  await p.locator('#start').click();
  await p.locator('.gate').waitFor();
  await shot(p, size, '12-imp-gate');
  await p.locator('#gate-go').click();
  await p.locator('.imp-card').waitFor();
  await shot(p, size, '13-imp-card-front', 900);
  await p.locator('.imp-card').click();
  await shot(p, size, '14-imp-card-flipped', 1200);
  for (let i = 0; i < 3; i++) {
    if (i) { await p.locator('#gate-go').click(); await p.locator('.imp-card').waitFor(); if (!(await p.locator('.imp-card.flipped').count())) await p.locator('.imp-card').click(); await p.waitForTimeout(700); }
    await p.locator('[data-act="seen"]').click();
    await p.waitForTimeout(500);
  }
  await shot(p, size, '15-imp-discuss', 1000);
  // Whatever the host bar offers to move on: take the first button.
  const hb = p.locator('#pp-host button');
  if (await hb.count()) { await shot(p, size, '16-imp-hostbar', 100); await hb.first().click(); await p.waitForTimeout(700); }
  await shot(p, size, '17-imp-after-discuss', 600);
  for (let i = 0; i < 6 && !(await p.locator('.imp-result').count()); i++) {
    const pick = p.locator('.pick[data-act="accuse"]');
    if (await pick.count()) { await shot(p, size, '18-imp-vote', 300); await pick.first().click(); await p.locator('.dialog button, .sheet button').last().click().catch(() => {}); await p.waitForTimeout(800); continue; }
    const go = p.locator('#gate-go');
    if (await go.count()) { await go.click(); await p.waitForTimeout(600); }
    const pk = p.locator('.pick[data-act="vote"]');
    if (await pk.count()) { await pk.first().click(); await p.waitForTimeout(500); }
    const nxt = p.locator('#pp-host button, .btn-primary').last();
    if (await nxt.count()) await nxt.click().catch(() => {});
    await p.waitForTimeout(600);
  }
  await shot(p, size, '19-imp-result', 1200);
  await p.context().close();

  // Celebrity Heads, one phone.
  p = await open(size);
  await p.goto(`${BASE}/#/new/heads`);
  await shot(p, size, '20-heads-start');
  await setup(p, 'heads');
  await shot(p, size, '21-heads-setup');
  await p.locator('#start').click();
  await p.waitForTimeout(800);
  await shot(p, size, '22-heads-first');
  for (let i = 0; i < 4 && !(await p.locator('.hd-word').count()); i++) {
    const go = p.locator('#gate-go, [data-act="start"], .btn-primary').first();
    if (await go.count()) await go.click().catch(() => {});
    await p.waitForTimeout(700);
    if (i === 0) await shot(p, size, '23-heads-ready', 100);
  }
  await shot(p, size, '24-heads-play', 900);
  const got = p.locator('.hd-got');
  if (await got.count()) { await got.click(); await p.waitForTimeout(900); await shot(p, size, '25-heads-play-2', 300); }
  await p.context().close();
}
await browser.close();
if (errors.length) { console.log('page errors:'); for (const e of errors) console.log(`  ${e}`); }
console.log(`screenshots: ${OUT}`);
