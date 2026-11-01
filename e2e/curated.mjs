// Curated packs in a real browser: the pack browser on the start screen,
// a curated pack played on one phone, in a room (host, a second phone, the
// TV), offline from the service worker cache, the search and filter chips
// on a long catalogue, and screenshots at 390x844 and 1440x900.
//
//   node e2e/curated.mjs [baseUrl] [gameId]      default http://127.0.0.1:8979 wyr
//
// Screenshots: /tmp/games-e2e/curated-*.png. Throws on anything wrong.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const BASE = args[0] && args[0].startsWith('http') ? args.shift() : 'http://127.0.0.1:8979';
const GAME = args[0] || 'wyr';
const OUT = process.env.E2E_OUT || '/tmp/games-e2e';
mkdirSync(OUT, { recursive: true });
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
const DESK = { viewport: { width: 1440, height: 900 } };
// page.route() cannot see requests a service worker answers, so the stubbed
// catalogue runs (long list, broken server) keep the worker out.
const NO_SW = { serviceWorkers: 'block' };
const log = (...a) => console.log(...a);
const errors = [];
// Games whose first screen already shows something dealt from the deck.
const SHOWS_FIRST = new Set(['wyr', 'mlt', 'spyfall']);

const browser = await chromium.launch();
async function newPage(opts, label) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${label}: ${m.text()}`); });
  // The first-time how-to sheet and the install offer: dismiss.
  await page.addLocatorHandler(page.locator('.sheet-wrap.open.sheet-howto'), async (w) => { await w.locator('.sheet-actions [data-i="0"]').click().catch(() => {}); }, { noWaitAfter: true });
  await page.addLocatorHandler(page.locator('.sheet-wrap.open.sheet-install'), async (w) => { await w.locator('.sheet-actions [data-i="1"]').click().catch(() => {}); }, { noWaitAfter: true });
  return page;
}
const shot = async (page, name) => { await page.waitForTimeout(700); await page.screenshot({ path: `${OUT}/curated-${name}.png` }); };

const bundle = await (await fetch(`${BASE}/games/${GAME}/packs.json`)).json();
if (!bundle.packs || bundle.packs.length < 3) throw new Error(`${GAME}: expected 3+ curated packs, got ${bundle.packs && bundle.packs.length}`);
const pack = bundle.packs[1];
// Strings from the pack that should show up once a game is dealt from it.
// Decks of single words (Codewords) have nothing that long: fall back to every word.
const strings = (min) => (JSON.stringify(pack.content).match(new RegExp(`"(?:[^"\\\\]|\\\\.){${min},}"`, 'g')) || []).map((s) => JSON.parse(s).slice(0, 30));
const markers = strings(12).length ? strings(12) : strings(4);
const anyMarker = async (page) => {
  const text = await page.locator('body').innerText();
  return markers.some((m) => text.includes(m));
};

async function openSheet(page) {
  await page.locator('#pack-btn').click();
  await page.locator('.sheet-wrap.open.sheet-pack').waitFor();
  await page.locator('.pk-card:not(.pk-skel)').first().waitFor();
}

/* ---------- one phone ---------- */
{
  const page = await newPage(PHONE, 'phone');
  await page.goto(`${BASE}/#/new/${GAME}`);
  await page.locator('#pack-btn').waitFor();
  const before = await page.locator('#pack-btn').innerText();
  if (!/Built-in deck/.test(before) || !/themed packs/.test(before)) throw new Error(`start screen pack row: ${before}`);
  await shot(page, 'start-phone');
  await openSheet(page);
  const cards = await page.locator('.pk-card').count();
  if (cards !== bundle.packs.length + 1) throw new Error(`expected ${bundle.packs.length + 1} cards, got ${cards}`);
  if ((await page.locator('.pk-card').first().innerText()).indexOf('Built-in deck') < 0) throw new Error('Built-in deck must be the first card');
  if ((await page.locator('.pk-card.on').count()) !== 1) throw new Error('exactly one card selected');
  await shot(page, 'sheet-phone');
  await page.locator(`.pk-card[data-pick="${pack.code}"]`).click();
  await page.locator('.sheet-wrap').waitFor({ state: 'detached' });
  const after = await page.locator('#pack-btn').innerText();
  if (!after.includes(pack.title)) throw new Error(`start screen should show ${pack.title}, shows ${after}`);
  await shot(page, 'start-picked-phone');
  // Reopen: the pack is the selected card.
  await openSheet(page);
  if ((await page.locator(`.pk-card.on[data-pick="${pack.code}"]`).count()) !== 1) throw new Error('picked pack not shown as selected');
  await page.keyboard.press('Escape');
  await page.locator('.sheet-wrap').waitFor({ state: 'detached' });
  // The choice survives a refresh for this tab.
  await page.reload();
  await page.locator('#pack-btn').waitFor();
  if (!(await page.locator('#pack-btn').innerText()).includes(pack.title)) throw new Error('pack choice lost on refresh');

  await page.locator('#go-pass').click();
  await page.locator('#pass-form').waitFor();
  if (!(await page.locator('#pack-btn').innerText()).includes(pack.title)) throw new Error('set-up should show the pack');
  await shot(page, 'pass-setup-phone');
  await page.locator('#start').click();
  await page.locator('#pp-main').waitFor();
  // The saved game is exactly what the one-phone runner plays: the pack's
  // decks merged over the built-in content.
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('games.pass') || 'null'));
  if (!saved || saved.packCode !== pack.code) throw new Error(`pass and play saved pack ${saved && saved.packCode}, expected ${pack.code}`);
  for (const k of Object.keys(pack.content)) {
    if (JSON.stringify(saved.content[k]) !== JSON.stringify(pack.content[k])) throw new Error(`pass and play content.${k} is not ${pack.id}'s`);
  }
  // Games whose first screen shows a dealt item: it must be from the pack.
  if (SHOWS_FIRST.has(GAME)) {
    for (let i = 0; i < 8 && !(await anyMarker(page)); i++) {
      const gate = page.locator('#gate-go');
      if (await gate.isVisible().catch(() => false)) await gate.click();
      await page.waitForTimeout(300);
    }
    if (!(await anyMarker(page))) throw new Error(`pass and play did not show ${pack.id} on screen`);
  }
  await shot(page, 'pass-game-phone');
  log(`pass and play: dealt from ${pack.id}`);
  await page.context().close();
}

/* ---------- a room ---------- */
{
  const host = await newPage(PHONE, 'host');
  await host.goto(`${BASE}/#/new/${GAME}`);
  await host.locator('#pack-btn').waitFor();
  await openSheet(host);
  await host.locator(`.pk-card[data-pick="${pack.code}"]`).click();
  await host.locator('.sheet-wrap').waitFor({ state: 'detached' });
  const nameInput = host.locator('#host-name');
  if (await nameInput.isVisible().catch(() => false)) await nameInput.fill('Ana');
  await host.locator('#go-room').click();
  await host.locator('.lobby').waitFor();
  await host.waitForURL(/\/r\/[A-Z]{4}$/);
  const code = host.url().split('/r/')[1];
  if (!(await host.locator('.lobby').innerText()).includes(pack.title)) throw new Error('lobby summary should name the pack');
  const tv = await newPage(DESK, 'tv');
  await tv.goto(`${BASE}/tv/${code}`);
  await tv.locator('.tv-lobby').waitFor();
  const ben = await newPage(PHONE, 'ben');
  await ben.goto(`${BASE}/r/${code}`);
  await ben.locator('#join-name').fill('Ben');
  await ben.locator('#join-go').click();
  await ben.locator('.lobby').waitFor();
  const cy = await newPage(PHONE, 'cy');
  await cy.goto(`${BASE}/r/${code}`);
  await cy.locator('#join-name').fill('Cy');
  await cy.locator('#join-go').click();
  await cy.locator('.lobby').waitFor();
  // The lobby settings sheet: change pack there too.
  await host.locator('#lb-settings').click();
  await host.locator('.sheet-wrap.open.sheet-settings').waitFor();
  if (!(await host.locator('#st-pack').innerText()).includes(pack.title)) throw new Error('settings row should name the pack');
  await shot(host, 'lobby-settings-phone');
  await host.locator('#st-pack').click();
  await host.locator('.sheet-wrap.open.sheet-pack .pk-card:not(.pk-skel)').first().waitFor();
  if ((await host.locator(`.pk-card.on[data-pick="${pack.code}"]`).count()) !== 1) throw new Error('lobby sheet should select the room pack');
  await host.locator(`.pk-card[data-pick="${pack.code}"]`).click();
  await host.locator('.sheet-wrap').first().waitFor({ state: 'detached' });
  await host.locator('#lb-start').click();
  await host.locator('#rm-main > *').first().waitFor();
  await host.waitForTimeout(600);
  const seen = [host, ben, cy, tv];
  if (SHOWS_FIRST.has(GAME)) {
    let ok = false;
    for (const p of seen) if (await anyMarker(p)) ok = true;
    if (!ok) throw new Error(`room did not deal from ${pack.id}`);
  }
  await shot(host, 'room-game-phone');
  await shot(tv, 'room-game-tv');
  log(`room ${code}: started with ${pack.id}${SHOWS_FIRST.has(GAME) ? ', dealt from it on screen' : ''}`);
  for (const p of seen) await p.context().close();
}

/* ---------- offline: the pack browser and a curated game from the cache ---------- */
{
  const page = await newPage(PHONE, 'offline');
  await page.goto(`${BASE}/`);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  // Wait until the install step has precached this game's bundle.
  await page.waitForFunction(async (g) => !!(await caches.match(`/games/${g}/packs.json`)), GAME, { timeout: 30_000 });
  await page.context().setOffline(true);
  await page.goto(`${BASE}/#/new/${GAME}`);
  await page.locator('#pack-btn').waitFor();
  await openSheet(page);
  await page.locator(`.pk-card[data-pick="${bundle.packs[2].code}"]`).click();
  await page.locator('.sheet-wrap').waitFor({ state: 'detached' });
  await page.locator('#go-pass').click();
  await page.locator('#pass-form').waitFor();
  await page.locator('#start').click();
  await page.locator('#pp-main').waitFor();
  await shot(page, 'offline-game-phone');
  log('offline: pack browser and a curated game from the cache');
  await page.context().close();
}

/* ---------- a long catalogue: search, filter chips, empty state, desktop ---------- */
{
  const page = await newPage({ ...DESK, ...NO_SW }, 'desk');
  const big = { ...bundle, packs: Array.from({ length: 4 }, (_, k) => bundle.packs.map((p, i) => ({ ...p, id: `${p.id}-${k}`, code: `${p.code}-${k}`, tags: [['work', 'food', 'aussie', 'travel'][(i + k) % 4]], spicy: (i + k) % 5 === 0 }))).flat() };
  await page.route(`**/games/${GAME}/packs.json`, (r) => r.fulfill({ json: big }));
  await page.goto(`${BASE}/#/new/${GAME}`);
  await page.locator('#pack-btn').waitFor();
  await openSheet(page);
  await page.locator('#pk-q').waitFor();
  await shot(page, 'sheet-long-desk');
  await page.locator('#pk-q').fill('zzzz no such pack');
  await page.locator('.pk-empty').waitFor();
  await shot(page, 'sheet-empty-desk');
  await page.locator('[data-clear]').click();
  await page.locator('.chip[data-tag="food"]').click();
  const n = await page.locator('.pk-card').count();
  const want = big.packs.filter((p) => p.tags.includes('food')).length;
  if (n !== want) throw new Error(`food filter: ${n} cards, expected ${want}`);
  await shot(page, 'sheet-filter-desk');
  await page.context().close();
  const phone = await newPage({ ...PHONE, ...NO_SW }, 'phone-long');
  await phone.route(`**/games/${GAME}/packs.json`, (r) => r.fulfill({ json: big }));
  await phone.goto(`${BASE}/#/new/${GAME}`);
  await phone.locator('#pack-btn').waitFor();
  await openSheet(phone);
  await shot(phone, 'sheet-long-phone');
  await phone.locator('.sheet').evaluate((el) => { el.scrollTop = 600; });
  await phone.waitForTimeout(300);
  await shot(phone, 'sheet-long-scrolled-phone');
  // A failing catalogue: inline error with the real text and a retry.
  await phone.keyboard.press('Escape');
  await phone.locator('.sheet-wrap').waitFor({ state: 'detached' });
  await phone.context().close();
  const broken = await newPage({ ...PHONE, ...NO_SW }, 'broken');
  await broken.route(`**/games/${GAME}/packs.json`, (r) => r.fulfill({ status: 503, body: 'down' }));
  await broken.goto(`${BASE}/#/new/${GAME}`);
  await broken.locator('#pack-btn').click();
  await broken.locator('.pk-error').waitFor({ timeout: 15_000 });
  await shot(broken, 'sheet-error-phone');
  await broken.context().close();
  log('long catalogue: search, chips, empty and error states');
}

await browser.close();
const real = errors.filter((e) => !/503|net::ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(e));
if (real.length) { console.error(real.join('\n')); process.exit(1); }
log('curated e2e: all good');
