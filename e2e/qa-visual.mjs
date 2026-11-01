// Visual QA tour: for every game, the start screen with the pack browser
// open, the lobby, a mid-game phone (host and a guest) and the TV at
// 1440x900 and 1920x1080, all at a 390x844 phone; plus home at three sizes.
// Flags anything wider than the screen, a TV page that has to scroll
// (the TV cannot), and text clipped inside its box. Open the PNGs too.
//
//   node e2e/qa-visual.mjs [baseUrl] [--games=a,b] [--tier=deadly]
//   (server needs GAMES_TEST_HOOKS=1 to fast-forward into the game)
// Screenshots: $E2E_OUT (default /tmp/games-e2e)/visual-*.png
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { newPage, startScreen, openRoom, hook, lcg, layoutProblems } from './matrix-browser.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const flag = (k, d = '') => (argv.find((a) => a.startsWith(`--${k}=`)) || `--${k}=${d}`).split('=').slice(1).join('=');
const BASE = (argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8979').replace(/\/+$/, '');
const OUT = process.env.E2E_OUT || '/tmp/games-e2e';
const TIER = flag('tier', 'deadly');
mkdirSync(OUT, { recursive: true });
const { loadGames } = await import(pathToFileURL(join(ROOT, 'lib/registry.mjs')).href);
const rt = await import(pathToFileURL(join(ROOT, 'games/_kit/runtime.js')).href);
const games = await loadGames(join(ROOT, 'games'), { strict: true });
const ONLY = flag('games').split(',').filter(Boolean);
const IDS = [...games.keys()].filter((id) => !ONLY.length || ONLY.includes(id));
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true };
const TV1 = { viewport: { width: 1440, height: 900 } };
const TV2 = { viewport: { width: 1920, height: 1080 } };
const issues = [];
const log = (...a) => console.log(...a);

async function shot(page, name, opts) {
  await page.waitForTimeout(500);
  // The first-time how-to sheet: read past it so the game shows.
  const howto = page.locator('.sheet-wrap.open.sheet-howto .sheet-actions [data-i="0"]');
  if (await howto.count()) { await howto.click().catch(() => {}); await page.locator('.sheet-howto').waitFor({ state: 'detached', timeout: 3000 }).catch(() => {}); }
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/visual-${name}.png` });
  for (const p of await layoutProblems(page, opts)) issues.push(`${name}: ${p}`);
}

// A few bot moves through the hook to get into the meat of a game.
async function advance(code, g, n) {
  const rand = lcg(11);
  for (let i = 0; i < n; i++) {
    const snap = await hook(BASE, code);
    if (!snap.state || snap.state.$over) return;
    const players = snap.players.map((p) => ({ ...p, color: '#fff' }));
    const ctx = { players, content: g.content, rng: rand, now: Date.now() };
    const seats = [...snap.inGame, null];
    const moves = seats.map((who) => ({ who, a: g.engine.bot(snap.state, who, ctx) })).filter((m) => m.a);
    // Players first: their moves show the most on screen.
    const pick = moves.find((m) => m.who !== null) || moves[0];
    if (!pick) { if (rt.deadlineOf(g.engine, snap.state)) await hook(BASE, code, '/deadline', {}); continue; }
    await hook(BASE, code, '/act', { playerId: pick.who, type: pick.a.type, payload: pick.a.payload ?? null });
  }
}

const browser = await chromium.launch();
const errors = [];

// Home at three sizes.
for (const [name, opts] of [['home-390', PHONE], ['home-1440', TV1], ['home-1920', TV2]]) {
  const p = await newPage(browser, opts, name, errors);
  await p.goto(`${BASE}/`);
  await p.locator('a.deck').first().waitFor();
  await shot(p, name);
  await p.screenshot({ path: `${OUT}/visual-${name}-full.png`, fullPage: true });
  await p.context().close();
}

for (const id of IDS) {
  const g = games.get(id);
  const packs = [...(g.curated ? g.curated.values() : [])].sort((a, b) => b.count - a.count);
  const pack = packs[0] || null;
  log(`${id}${pack ? ` (${pack.id})` : ''}`);
  // Start screen with the pack browser open.
  {
    const p = await newPage(browser, PHONE, 'start', errors);
    await startScreen(p, BASE, g, TIER, null);
    await shot(p, `${id}-start`);
    if (pack) {
      await p.locator('#pack-btn').click();
      await p.locator('.sheet-wrap.open.sheet-pack .pk-card:not(.pk-skel)').first().waitFor();
      await shot(p, `${id}-packs`);
    }
    await p.context().close();
  }
  if (!(g.engine.meta.modes || ['pass', 'room']).includes('room')) continue;
  const m = g.engine.meta;
  const n = Math.min(m.maxPlayers, Math.max(m.minPlayers, 4));
  const room = await openRoom(browser, { BASE }, g, TIER, pack, n, errors);
  try {
    await shot(room.host, `${id}-lobby`);
    const tv2 = await newPage(browser, TV2, 'tv1920', errors);
    await tv2.goto(`${BASE}/tv/${room.code}`);
    await tv2.locator('.tv-lobby').waitFor();
    await shot(room.tv, `${id}-tv1440-lobby`, { tv: true });
    await shot(tv2, `${id}-tv1920-lobby`, { tv: true });
    await room.host.locator('#lb-start').click();
    let snap = await hook(BASE, room.code);
    for (let i = 0; i < 100 && !snap.state; i++) { await room.host.waitForTimeout(80); snap = await hook(BASE, room.code); }
    await advance(room.code, { ...g, content: pack ? pack.merged : g.content }, 3);
    const guest = [...room.pages.values()][1];
    await shot(room.host, `${id}-mid-host`);
    await shot(guest, `${id}-mid-guest`);
    await shot(room.tv, `${id}-tv1440-mid`, { tv: true });
    await shot(tv2, `${id}-tv1920-mid`, { tv: true });
    await tv2.context().close();
  } finally {
    for (const p of [...room.pages.values(), room.tv]) await p.context().close().catch(() => {});
  }
}
await browser.close();
log('\n==== layout issues ====');
for (const i of issues) log(`  ${i}`);
log('\n==== console errors ====');
for (const e of errors) log(`  ${e}`);
log(`\nscreenshots: ${OUT}/visual-*.png`);
