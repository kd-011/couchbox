// Nightly success test, not a dev e2e run: plays short against the LIVE
// site (`npm run canary`), under 3
// minutes, and leaves no room behind.
//
//   node e2e/canary.mjs [baseUrl]   default $GAMES_CANARY_URL, else a server on 127.0.0.1:8969
//
// Two own-device rooms (3 phones + a TV), one round each of Imposter and
// Quiz Show, reusing each game's own e2e driver (games/<id>/e2e.mjs) so the
// canary never drifts from what e2e/play.mjs already proves plays right.
// Every player leaves their room through the real "Leave room" menu action
// before its context closes, so the room empties out immediately rather
// than riding out the 15-minute empty-room TTL (lib/rooms.mjs).
//
// Separately: the home (cards, Surprise me, Party Night, join, TV link) and every shipped game's `/games/<id>`
// rules page are loaded and checked for a real render.
import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const GAMES_DIR = fileURLToPath(new URL('../games', import.meta.url));
const BASE = (process.argv[2]?.startsWith('http') ? process.argv[2] : process.env.GAMES_CANARY_URL || 'http://127.0.0.1:8969').replace(/\/+$/, ''); // prettier-ignore
const GAME_IDS = readdirSync(GAMES_DIR).filter((d) => !d.startsWith('_'));
const ROOM_GAMES = ['imposter', 'quiz-show'];

const log = (...a) => console.log(...a);
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
const TV = { viewport: { width: 1440, height: 900 } };
const t0 = Date.now();
const results = [];
const browser = await chromium.launch();

async function newPage(opts, label, errors) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label}: ${m.text()}`); });
  // The first-time how-to-play sheet: read past it, same as e2e/play.mjs.
  await page.addLocatorHandler(page.locator('.sheet-wrap.open.sheet-howto'), async (w) => {
    await w.locator('.sheet-actions [data-i="0"]').click().catch(() => {});
    await w.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
  }, { noWaitAfter: true });
  return page;
}

function helpers() {
  const h = {
    log,
    async shot() {}, // no screenshots against production
    async confirmSheet(page) {
      const btn = page.locator('.sheet-wrap.open .sheet-actions [data-i="0"]');
      await btn.waitFor({ timeout: 5000 });
      await btn.click();
      await page.locator('.sheet-wrap').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    },
    async hostClick(page, label) {
      const b = page.locator('.hostbar .btn', { hasText: label }).first();
      await b.waitFor({ timeout: 8000 });
      await b.click();
      await page.waitForTimeout(120);
      if (await page.locator('.sheet-wrap.open').count()) await h.confirmSheet(page);
    },
  };
  return h;
}

// The real "Leave room" path (public/js/room.js openMenu/leave): open the
// ••• menu, pick Leave, confirm. Empties the room server-side right away.
async function leaveRoom(page) {
  await page.locator('#rm-menu').click();
  await page.locator('.menu-item[data-value="leave"]').waitFor({ timeout: 5000 });
  await page.locator('.menu-item[data-value="leave"]').click();
  await page.locator('.sheet-wrap.open .sheet-actions [data-i="0"]').click();
  await page.waitForURL(`${BASE}/`, { timeout: 5000 });
}

async function playRoom(gameId) {
  const errors = [];
  const h = helpers();
  let host = null;
  let tv = null;
  const joiners = [];
  try {
    host = await newPage(PHONE, 'host', errors);
    await host.goto(`${BASE}/`);
    await host.locator(`a.deck[href="/#/new/${gameId}"]`).click();
    await host.locator('#tier-standard').waitFor();
    if ((await host.locator('#tier-standard').getAttribute('aria-checked')) !== 'true') {
      await host.locator('#tier-standard').click();
    }
    await host.locator('#host-name').fill('Ana');
    await host.locator('#go-room').click();
    await host.locator('.lobby').waitFor();
    await host.waitForURL(/\/r\/[A-Z]{4}$/);
    const code = host.url().split('/r/')[1];
    log(`  [${gameId}] room ${code}`);

    tv = await newPage(TV, 'tv', errors);
    await tv.goto(`${BASE}/tv/${code}`);
    await tv.locator('.tv-lobby').waitFor();

    for (const name of ['Ben', 'Cy']) {
      const p = await newPage(PHONE, name, errors);
      await p.goto(`${BASE}/r/${code}`);
      await p.locator('#join-name').fill(name);
      await p.locator('#join-go').click();
      await p.locator('.lobby').waitFor();
      joiners.push(p);
    }
    const players = [host, ...joiners];
    await host.locator('.seat:not(.seat-empty) .seat-btn').nth(2).waitFor();
    await tv.waitForFunction(() => document.querySelectorAll('.tv-players li:not(.empty)').length === 3);

    await host.locator('#lb-start').click();
    for (const p of players) await p.locator('#rm-main > *').first().waitFor();

    const driver = await import(pathToFileURL(join(GAMES_DIR, gameId, 'e2e.mjs')).href);
    await driver.room({ players, host, tv, variant: 'standard', h });

    for (const p of players) await leaveRoom(p);
    if (errors.length) throw new Error(`console errors:\n    ${errors.join('\n    ')}`);
  } finally {
    for (const p of [host, ...joiners, tv]) {
      if (p && !p.isClosed()) await p.context().close().catch(() => {});
    }
  }
}

async function pageSweep() {
  const errors = [];
  const page = await newPage(PHONE, 'sweep', errors);
  try {
    await page.goto(`${BASE}/`);
    await page.locator('a.deck').first().waitFor({ timeout: 10000 }).catch(() => {}); // home renders decks client-side; count only once they are in
    const deckCount = await page.locator('a.deck').count();
    if (deckCount < GAME_IDS.length) throw new Error(`home shows ${deckCount} decks, expected at least ${GAME_IDS.length}`); // prettier-ignore
    log(`  home: ${deckCount} decks`);
    // The cards say what each game is, and the ways in are all there.
    const bare = await page.locator('a.deck').evaluateAll((els) => els.filter((e) => !e.querySelector('.deck-pitch')?.textContent.trim() || !e.querySelector('.deck-meta')?.textContent.trim()).map((e) => e.dataset.game)); // prettier-ignore
    if (bare.length) throw new Error(`home cards missing a pitch or facts: ${bare.join(', ')}`);
    for (const sel of ['#surprise', '#night', '#join-code', '#home-search', 'a[href="/tv"]']) {
      if (!(await page.locator(sel).count())) throw new Error(`home is missing ${sel}`);
    }

    for (const id of GAME_IDS) {
      const resp = await page.goto(`${BASE}/games/${id}`);
      if (!resp || resp.status() !== 200) throw new Error(`/games/${id}: HTTP ${resp ? resp.status() : 'no response'}`); // prettier-ignore
      await page.locator('h1').first().waitFor({ timeout: 5000 });
    }
    log(`  rules pages: ${GAME_IDS.length} ok`);
    if (errors.length) throw new Error(`console errors:\n    ${errors.join('\n    ')}`);
  } finally {
    await page.context().close().catch(() => {});
  }
}

for (const gameId of ROOM_GAMES) {
  log(`\n▶ room ${gameId}`);
  try {
    await playRoom(gameId);
    results.push({ name: `room ${gameId}`, ok: true });
    log('  PASS');
  } catch (err) {
    results.push({ name: `room ${gameId}`, ok: false, err: err.message.split('\n').slice(0, 4).join('\n') });
    log(`  FAIL: ${err.message}`);
  }
}

log('\n▶ page sweep');
try {
  await pageSweep();
  results.push({ name: 'page sweep', ok: true });
  log('  PASS');
} catch (err) {
  results.push({ name: 'page sweep', ok: false, err: err.message.split('\n').slice(0, 4).join('\n') });
  log(`  FAIL: ${err.message}`);
}

await browser.close();
log(`\n==== summary (${((Date.now() - t0) / 1000).toFixed(1)}s) ====`);
for (const r of results) log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `: ${r.err}`}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
