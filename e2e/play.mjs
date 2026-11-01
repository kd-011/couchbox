// End-to-end harness: plays a full round of each game in BOTH modes and BOTH
// variants in real headless Chromium. Own-device runs use 3 players on
// separate browser contexts at 390x844 plus a /tv screen at 1440x900.
//
//   node e2e/play.mjs [baseUrl] [gameId ...] [--tiers=standard,deadly] [--modes=room]
//   default base http://127.0.0.1:8979, default: every game with an e2e.mjs,
//   all three tiers (standard, drinking, deadly) and both modes.
//
// The harness drives everything the platform owns (home, wizard, 18+ gate,
// set-up, room create/join, lobby, TV) and then hands over to the game's own
// driver, games/<id>/e2e.mjs:
//   export async function setup({ page, mode, h })        optional, tweak options
//   export async function pass({ page, variant, h })       play a round, one phone
//   export async function room({ players, host, tv, variant, h })  own phones
// The first game's standard room run also checks host hand-over, refresh
// mid-game and 30s host failover. Screenshots: /tmp/games-e2e/.
import { chromium } from 'playwright-core';
import { mkdirSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const GAMES_DIR = fileURLToPath(new URL('../games', import.meta.url));
const argv = process.argv.slice(2);
const flag = (k) => (argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1];
const args = argv.filter((a) => !a.startsWith('--'));
const BASE = args[0] && args[0].startsWith('http') ? args.shift() : 'http://127.0.0.1:8979';
const TIERS = (flag('tiers') || 'standard,drinking,deadly').split(',');
const MODES = (flag('modes') || 'pass,room').split(',');
const GAMES = args.length ? args : readdirSync(GAMES_DIR).filter((d) => !d.startsWith('_') && existsSync(join(GAMES_DIR, d, 'e2e.mjs')));
const OUT = process.env.E2E_OUT || '/tmp/games-e2e';
mkdirSync(OUT, { recursive: true });

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
const TV = { viewport: { width: 1440, height: 900 } };
const log = (...a) => console.log(...a);
const results = [];
let browser = await chromium.launch();
browser.on('disconnected', () => log('  (browser disconnected)'));
// A crashed Chromium must not fail every run after it: relaunch.
async function ensureBrowser() {
  if (!browser.isConnected()) browser = await chromium.launch();
}

// Every Deadly takeover seen, by run, as evidence: "title: line, line".
export const moments = [];
let runName = '';

async function newPage(opts, label, errors) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label}: ${m.text()}`); });
  // A Deadly takeover covers the screen: record it, then tap it away on
  // phones so it never blocks the driver (the TV has no button; it fades).
  await page.addLocatorHandler(page.locator('.moment .mo-done'), async (btn) => {
    const m = page.locator('.moment').first();
    const title = await m.locator('.mo-title').textContent().catch(() => '');
    await page.waitForTimeout(400);
    const text = (await m.locator('.mo-reveal').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    const rec = `${runName} [${label}] ${title}: ${text}`;
    if (!moments.includes(rec)) moments.push(rec);
    await btn.click({ force: true }).catch(() => {});
    await m.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
  }, { noWaitAfter: true });
  // The first-time how-to-play sheet: read it, tap Let's play.
  await page.addLocatorHandler(page.locator('.sheet-wrap.open.sheet-howto'), async (w) => {
    await w.locator('.sheet-actions [data-i="0"]').click().catch(() => {});
    await w.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
  }, { noWaitAfter: true });
  // The install offer after a finished game: not now.
  await page.addLocatorHandler(page.locator('.sheet-wrap.open.sheet-install'), async (w) => {
    await w.locator('.sheet-actions [data-i="1"]').click().catch(() => {});
    await w.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
  }, { noWaitAfter: true });
  return page;
}

function helpers(tag) {
  const h = {
    log,
    async shot(page, name) {
      await page.waitForTimeout(450);
      await page.screenshot({ path: `${OUT}/${tag}-${name}.png` });
    },
    async confirmSheet(page) {
      const btn = page.locator('.sheet-wrap.open .sheet-actions [data-i="0"]');
      await btn.waitFor({ timeout: 5000 });
      await btn.click();
      await page.locator('.sheet-wrap').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    },
    // Click a host-bar button by its label (works on one phone and in rooms).
    async hostClick(page, label) {
      const b = page.locator('.hostbar .btn', { hasText: label }).first();
      await b.waitFor({ timeout: 8000 });
      await b.click();
      await page.waitForTimeout(120);
      if (await page.locator('.sheet-wrap.open').count()) await h.confirmSheet(page);
    },
    // A Deadly takeover matching `re` shows on this page (or was already
    // seen and tapped away by the handler). Screenshots it if still up.
    async expectMoment(page, re, shotName = 'takeover', timeout = 8000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        const m = page.locator('.moment.revealed');
        if (await m.count()) {
          const t = (await m.first().innerText().catch(() => '')).replace(/\s+/g, ' ');
          if (re.test(t)) {
            if (shotName) await page.screenshot({ path: `${OUT}/${tag}-${shotName}.png` });
            const rec = `${runName} [driver] ${t}`;
            if (!moments.includes(rec)) moments.push(rec);
            return t;
          }
        }
        const seen = moments.find((x) => x.startsWith(runName) && re.test(x));
        if (seen) return seen;
        await page.waitForTimeout(150);
      }
      throw new Error(`no Deadly takeover matching ${re} on this screen`);
    },
    async tap(page, selector) {
      await page.locator(selector).first().click();
      await page.waitForTimeout(150);
    },
  };
  return h;
}

async function acceptAgeGate(page) {
  if (await page.locator('.sheet-age').count()) {
    await page.locator('.sheet-age .sheet-actions [data-i="0"]').click();
    await page.locator('.sheet-wrap').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  }
}

// Home: tap the game's deck, pick the tier (18+ gate for drinking tiers),
// then one tap: everyone's phones, or pass one phone.
async function pickModeVariant(page, gameId, mode, variant) {
  await page.goto(`${BASE}/`);
  await page.locator(`a.deck[href="/#/new/${gameId}"]`).click();
  await page.locator('#tier-standard').waitFor();
  if (variant !== 'standard') {
    await page.locator(`#tier-${variant}`).click();
    await page.locator('.sheet-age').waitFor();
    await acceptAgeGate(page);
    await page.locator(`#tier-${variant}[aria-checked="true"]`).waitFor();
  } else if ((await page.locator('#tier-standard').getAttribute('aria-checked')) !== 'true') {
    await page.locator('#tier-standard').click();
  }
}

async function passRun(gameId, variant, driver) {
  const h = helpers(`${gameId}-pass-${variant}`);
  const errors = [];
  const page = await newPage(PHONE, 'phone', errors);
  await pickModeVariant(page, gameId, 'pass', variant);
  await page.locator('#go-pass').click();
  await page.locator('#pass-form').waitFor();
  const inputs = page.locator('#names input');
  const names = ['Ana', 'Ben', 'Cy'];
  for (let i = 0; i < 3; i++) await inputs.nth(i).fill(names[i]);
  if (driver.setup) await driver.setup({ page, mode: 'pass', h });
  await h.shot(page, 'setup');
  await page.locator('#start').click();
  await page.locator('#pp-main').waitFor();
  await driver.pass({ page, variant, h });
  await page.context().close();
  return errors;
}

async function roomRun(gameId, variant, driver, extras) {
  const h = helpers(`${gameId}-room-${variant}`);
  const errors = [];
  const host = await newPage(PHONE, 'host', errors);
  await pickModeVariant(host, gameId, 'room', variant);
  await host.locator('#host-name').fill('Ana');
  await host.locator('#go-room').click();
  await host.locator('.lobby').waitFor();
  await host.waitForURL(/\/r\/[A-Z]{4}$/);
  const code = host.url().split('/r/')[1];
  log(`  room ${code}`);

  const tv = await newPage(TV, 'tv', errors);
  await tv.goto(`${BASE}/tv/${code}`);
  await tv.locator('.tv-lobby').waitFor();

  const players = [host];
  for (const name of ['Ben', 'Cy']) {
    const p = await newPage(PHONE, name, errors);
    await p.goto(`${BASE}/r/${code}`);
    await p.locator('#join-name').fill(name);
    await p.locator('#join-go').click();
    await p.locator('.lobby').waitFor();
    if (variant !== 'standard') {
      await p.locator('.sheet-age').waitFor();
      await acceptAgeGate(p);
    }
    players.push(p);
  }
  await host.locator('.seat:not(.seat-empty) .seat-btn').nth(2).waitFor();
  await h.shot(host, 'lobby');
  await tv.waitForFunction(() => document.querySelectorAll('.tv-players li:not(.empty)').length === 3);
  await h.shot(tv, 'tv-lobby');

  if (extras.hostPass) {
    await host.locator('.seat-btn', { hasText: 'Ben' }).click();
    await host.locator('.sheet-actions .btn', { hasText: 'Make Ben host' }).click();
    await players[1].locator('#lb-start').waitFor();
    await host.locator('#lb-start').waitFor({ state: 'detached', timeout: 5000 })
      .catch(() => { throw new Error('old host still has Start'); });
    await players[1].locator('.seat-btn', { hasText: 'Ana' }).click();
    await players[1].locator('.sheet-actions .btn', { hasText: 'Make Ana host' }).click();
    await host.locator('#lb-start').waitFor();
    log('  host hand-over and back: ok');
  }
  if (driver.setup) {
    // Room settings live in the host's Settings sheet.
    await host.locator('#lb-settings').click();
    await host.locator('.sheet-wrap.open.sheet-settings').waitFor();
    await driver.setup({ page: host, mode: 'room', h });
    await host.locator('.sheet-settings .sheet-actions [data-i="0"]').click();
    await host.locator('.sheet-wrap').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  }
  await host.locator('#lb-start').click();
  for (const p of players) await p.locator('#rm-main > *').first().waitFor();

  if (extras.reconnect) {
    const strip = (s) => s.replace(/\d/g, '').replace(/\s+/g, ' ').trim();
    const before = strip(await players[2].locator('#rm-main').innerText());
    await players[2].reload();
    await players[2].locator('#rm-main > *').first().waitFor();
    await players[2].waitForTimeout(300);
    const after = strip(await players[2].locator('#rm-main').innerText());
    if (before !== after) throw new Error(`view changed after refresh:\n    ${before}\n    ${after}`);
    log('  refresh mid-game: same view back');
  }

  await driver.room({ players, host, tv, variant, h });
  // The TV cannot scroll: whatever the round ended on must fit the screen.
  await tv.waitForTimeout(900);
  const tvH = await tv.evaluate(() => [document.documentElement.scrollHeight, innerHeight]);
  if (tvH[0] > tvH[1] + 2) throw new Error(`TV page runs off the screen: ${tvH[0]}px tall on a ${tvH[1]}px screen`);

  if (extras.failover) {
    await host.context().close();
    log('  host gone, waiting out the 30s grace...');
    await players[1].locator('#rm-host .btn').first().waitFor({ timeout: 45_000 });
    log('  failover: Ben (longest connected) now has the host controls');
  }
  for (const p of [...players, tv]) if (!p.isClosed()) await p.context().close().catch(() => {});
  return errors;
}

for (const [gi, gameId] of GAMES.entries()) {
  const driverPath = join(GAMES_DIR, gameId, 'e2e.mjs');
  if (!existsSync(driverPath)) {
    results.push({ name: gameId, ok: false, err: `no games/${gameId}/e2e.mjs driver` });
    continue;
  }
  const driver = await import(pathToFileURL(driverPath).href);
  for (const variant of TIERS) {
    for (const mode of MODES) {
      const name = `${gameId} ${mode} ${variant}`;
      runName = name;
      log(`\n▶ ${name}`);
      const t0 = Date.now();
      await ensureBrowser();
      try {
        const extras = gi === 0 && mode === 'room' && variant === 'standard'
          ? { hostPass: true, reconnect: true, failover: true } : {};
        const errors = mode === 'pass' ? await passRun(gameId, variant, driver) : await roomRun(gameId, variant, driver, extras);
        if (errors.length) throw new Error(`console errors:\n    ${errors.join('\n    ')}`);
        results.push({ name, ok: true });
        log(`  PASS (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      } catch (err) {
        results.push({ name, ok: false, err: err.message.split('\n').slice(0, 4).join('\n') });
        log(`  FAIL: ${err.message.split('\n').slice(0, 4).join('\n')}`);
      }
    }
  }
}

await browser.close();
if (moments.length) {
  log('\n==== Deadly takeovers seen ====');
  for (const m of moments) log(`  ${m}`);
}
log('\n==== summary ====');
for (const r of results) log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `: ${r.err}`}`);
log(`screenshots: ${OUT}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
