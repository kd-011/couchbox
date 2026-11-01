// Screenshot tour of every platform screen at a phone (390x844) and a
// desktop/TV (1440x900) size, for design review and PRs:
//   node e2e/screens.mjs [baseUrl] [outDir]
// Defaults: http://127.0.0.1:8979, /tmp/games-screens. Drives real
// Chromium: a host, two guests and a TV, plus a one-phone game.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:8979';
const OUT = process.argv[3] || '/tmp/games-screens';
mkdirSync(OUT, { recursive: true });

const SIZES = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  desktop: { viewport: { width: 1440, height: 900 } },
};
const browser = await chromium.launch();
const errors = [];

async function page(size, label, prefs = {}) {
  const ctx = await browser.newContext({ ...SIZES[size], reducedMotion: 'no-preference' });
  await ctx.addInitScript((p) => {
    // Seen-before flags so first-time sheets only show where we want them.
    for (const [k, v] of Object.entries(p)) if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
  }, prefs);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${size}/${label}: ${e.message}`));
  return p;
}

async function shot(p, size, name, { full = false, wait = 700 } = {}) {
  await p.waitForTimeout(wait);
  await p.screenshot({ path: `${OUT}/${size}-${name}.png`, fullPage: full });
  // Anything wider than the screen, or a sheet wider than itself, is a bug.
  const over = await p.evaluate(() => {
    const out = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) out.push(`page ${document.documentElement.scrollWidth}px`);
    for (const el of document.querySelectorAll('.sheet')) if (el.scrollWidth > el.clientWidth + 1) out.push(`sheet ${el.scrollWidth}/${el.clientWidth}px`);
    return out;
  });
  if (over.length) errors.push(`${size}/${name}: overflow ${over.join(', ')}`);
  console.log(`  ${size}-${name}${over.length ? `  OVERFLOW ${over.join(', ')}` : ''}`);
}

async function closeSheets(p) {
  for (let i = 0; i < 3; i++) {
    if (!(await p.locator('.sheet-wrap.open').count())) return;
    await p.keyboard.press('Escape');
    await p.waitForTimeout(350);
  }
}

const ADULT = { 'games.18ok': '1', 'games.deadlyok': '1' };

for (const size of Object.keys(SIZES)) {
  console.log(`\n${size}`);
  // Static and set-up screens.
  const a = await page(size, 'solo', { ...ADULT, 'games.howto.imposter': '1' });
  await a.goto(`${BASE}/`);
  await shot(a, size, '01-home', { full: true, wait: 1200 });
  await a.goto(`${BASE}/#/new/imposter`);
  await shot(a, size, '02-game-start', { full: true });
  await a.goto(`${BASE}/#/new/quiz-show`);
  await shot(a, size, '03-game-start-quiz');
  await a.goto(`${BASE}/#/new/imposter/pass/standard`);
  await a.locator('#pass-form').waitFor().catch(() => {});
  await shot(a, size, '04-pass-setup', { full: true });
  await a.goto(`${BASE}/join`);
  await a.keyboard.type('AB').catch(() => {});
  await shot(a, size, '05-join');
  await a.goto(`${BASE}/tv`);
  await shot(a, size, '06-tv-enter');
  await a.goto(`${BASE}/games/imposter`);
  await shot(a, size, '07-seo-game', { full: true });
  await a.goto(`${BASE}/privacy`);
  await shot(a, size, '08-privacy');
  await a.goto(`${BASE}/nope`);
  await shot(a, size, '09-404');

  // One phone: set up three players and deal.
  await a.goto(`${BASE}/#/new/imposter/pass/standard`);
  await a.locator('#pass-form').waitFor();
  const inputs = a.locator('#names input');
  for (const [i, n] of ['Ana', 'Ben', 'Cy'].entries()) await inputs.nth(i).fill(n);
  await a.locator('#start').click();
  await a.locator('.gate').waitFor();
  await shot(a, size, '10-pass-gate');
  await a.locator('#gate-go').click();
  await a.locator('.imp-card').waitFor();
  if (!(await a.locator('.imp-card.flipped').count())) await a.locator('.imp-card').click();
  await shot(a, size, '11-pass-card', { wait: 1000 });
  await a.context().close();

  // A room: host, two guests, a TV.
  const host = await page(size, 'host', { ...ADULT, 'games.name': 'Ana', 'games.howto.imposter': '1' });
  await host.goto(`${BASE}/#/host/imposter/drinking`);
  await host.waitForURL(/\/r\/[A-Z]{4}$/, { timeout: 15000 });
  const code = host.url().split('/r/')[1];
  await host.locator('.lobby').waitFor();
  await shot(host, size, '12-lobby-host-alone', { full: true });
  const ben = await page(size, 'ben', ADULT);
  await ben.goto(`${BASE}/r/${code}`);
  await ben.locator('#join-name').waitFor();
  await shot(ben, size, '13-join-room', { wait: 1200 });
  await ben.locator('#join-name').fill('Ben');
  await ben.locator('#join-go').click();
  await ben.locator('.lobby').waitFor();
  const cy = await page(size, 'cy', { ...ADULT, 'games.name': 'Cy' });
  await cy.goto(`${BASE}/r/${code}`);
  await cy.locator('#join-name').waitFor();
  await cy.locator('#join-name').fill('Cy');
  await cy.locator('#join-go').click();
  await cy.locator('.lobby').waitFor();
  const ready = cy.locator('#lb-ready');
  if (await ready.count()) await ready.click();
  await shot(ben, size, '14-lobby-guest', { full: true });
  await shot(host, size, '15-lobby-host-full', { full: true });
  const tv = await page(size, 'tv', ADULT);
  await tv.goto(`${BASE}/tv/${code}`);
  await tv.locator('.tv-lobby').waitFor();
  await shot(tv, size, '16-tv-lobby', { wait: 1500 });
  if (await host.locator('#lb-tv').count()) {
    await host.locator('#lb-tv').click();
    await shot(host, size, '17-show-on-tv', { wait: 900 });
    await closeSheets(host);
  }
  await host.locator('#lb-start').click();
  await host.locator('.imp-card').waitFor();
  await closeSheets(host);
  await shot(host, size, '18-room-card-before-flip');
  await host.locator('.imp-card').click();
  await shot(host, size, '19-room-card-flipped', { wait: 1000 });
  await ben.locator('.sheet-wrap.open.sheet-howto').waitFor({ timeout: 5000 }).catch(() => {});
  await shot(ben, size, '20-room-first-howto', { wait: 500 });
  await closeSheets(ben);
  await shot(tv, size, '21-tv-reveal', { wait: 1200 });
  // Everyone sees their card and says got it: discussion on the TV.
  for (const p of [host, ben, cy]) {
    await closeSheets(p);
    if (!(await p.locator('.imp-card.flipped').count())) await p.locator('.imp-card').click();
    await p.locator('[data-act="seen"]').click();
  }
  await tv.locator('.cd-ring').waitFor();
  await shot(tv, size, '22-tv-discuss', { wait: 1200 });
  await shot(host, size, '23-room-discuss');
  for (const p of [host, ben, cy, tv]) await p.context().close();
}

await browser.close();
if (errors.length) { console.log('\npage errors:'); for (const e of errors) console.log(`  ${e}`); }
console.log(`\nscreenshots: ${OUT}`);
