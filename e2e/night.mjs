// Party Night end to end, in real headless Chromium:
//   room: host queues the night in the lobby, 3 phones (390x844) + a TV
//         (1440x900) play each game with its own e2e driver, standings
//         between games on the TV, I'm out and a host tier drop from the
//         drinks sheet, then the awards ceremony and the recap image.
//   pass: one phone plays the same games back to back, standings, awards,
//         recap image.
//
//   node e2e/night.mjs [baseUrl] [--games=imposter,wyr] [--tier=deadly] [--modes=room,pass]
// Screenshots: /tmp/games-e2e/night-*.png, the recap images as night-*-recap.png.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const GAMES_DIR = fileURLToPath(new URL('../games', import.meta.url));
const argv = process.argv.slice(2);
const flag = (k, d) => (argv.find((a) => a.startsWith(`--${k}=`)) || `=${d}`).split('=')[1];
const BASE = argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8979';
const GAMES = flag('games', 'imposter,wyr').split(',');
const TIER = flag('tier', 'deadly');
const MODES = flag('modes', 'room,pass').split(',');
const OUT = process.env.E2E_OUT || '/tmp/games-e2e';
mkdirSync(OUT, { recursive: true });
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, acceptDownloads: true };
const TV = { viewport: { width: 1440, height: 900 } };
const log = (...a) => console.log(...a);
const moments = [];
const browser = await chromium.launch();
const drivers = {};
for (const id of GAMES) drivers[id] = await import(pathToFileURL(join(GAMES_DIR, id, 'e2e.mjs')).href);

async function newPage(opts, label, errors) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label}: ${m.text()}`); });
  await page.addLocatorHandler(page.locator('.moment .mo-done'), async (btn) => {
    const t = (await page.locator('.moment').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    const rec = `[${label}] ${t}`;
    if (!moments.includes(rec)) moments.push(rec);
    await btn.click({ force: true }).catch(() => {});
    await page.locator('.moment').first().waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
  }, { noWaitAfter: true });
  for (const [sel, btn] of [['.sheet-wrap.open.sheet-howto', '0'], ['.sheet-wrap.open.sheet-install', '1']]) {
    await page.addLocatorHandler(page.locator(sel), async (w) => {
      await w.locator(`.sheet-actions [data-i="${btn}"]`).click().catch(() => {});
      await w.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
    }, { noWaitAfter: true });
  }
  return page;
}

function helpers(tag) {
  const h = {
    log,
    async shot(page, name) { await page.waitForTimeout(450); await page.screenshot({ path: `${OUT}/${tag}-${name}.png` }); },
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
    async tap(page, sel) { await page.locator(sel).first().click(); await page.waitForTimeout(150); },
    async expectMoment(page, re) {
      const end = Date.now() + 8000;
      while (Date.now() < end) {
        const m = page.locator('.moment.revealed');
        if (await m.count() && re.test(await m.first().innerText().catch(() => ''))) return;
        if (moments.some((x) => re.test(x))) return;
        await page.waitForTimeout(150);
      }
      throw new Error(`no Deadly takeover matching ${re}`);
    },
  };
  return h;
}

async function acceptAgeGate(page) {
  await page.locator('.sheet-age').waitFor({ timeout: 5000 });
  await page.locator('.sheet-age .sheet-actions [data-i="0"]').click();
  await page.locator('.sheet-wrap').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
}

async function menuPick(page, label) {
  await page.locator('#rm-menu, #pp-menu').first().click();
  await page.locator('.menu-item', { hasText: new RegExp(label, 'i') }).click();
}

// End the running game into the standings: the host bar's "Standings" once
// the game is over, else the menu's "End game, show standings".
async function toStandings(host, h) {
  const btn = host.locator('.hostbar .btn', { hasText: /^Standings/ });
  if (await btn.count()) await btn.first().click();
  else {
    await menuPick(host, 'standings');
    await host.locator('.nt-standings, .sheet-wrap.open .sheet-actions').first().waitFor();
    if (await host.locator('.sheet-wrap.open').count()) await h.confirmSheet(host);
  }
  await host.locator('.nt-standings').waitFor({ timeout: 8000 });
}

async function saveRecap(page, name) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.locator('#nt-share').click()]);
  const path = `${OUT}/${name}-recap.png`;
  await dl.saveAs(path);
  return path;
}

async function roomNight() {
  const tag = `night-room-${TIER}`;
  const h = helpers(tag);
  const errors = [];
  const host = await newPage(PHONE, 'host', errors);
  const [first, ...rest] = GAMES;
  await host.goto(`${BASE}/#/new/${first}/room/${TIER}`);
  if (TIER !== 'standard') await acceptAgeGate(host);
  await host.locator('#host-name').fill('Ana');
  await host.locator('#create').click();
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
    if (TIER !== 'standard') await acceptAgeGate(p);
    players.push(p);
  }
  // Line up the night.
  for (const id of rest) {
    await host.locator('#lb-queue').click();
    await host.locator(`.sheet .game-row[data-value="${id}"]`).click();
    await host.locator(`.queue li`).nth(rest.indexOf(id) + 1).waitFor();
  }
  if (await host.locator('[aria-label="Less Rounds"]').count()) {
    for (let i = 0; i < 4; i++) await host.locator('[aria-label="Less Rounds"]').click();
  }
  await h.shot(host, 'lobby-queue');
  await tv.waitForFunction(() => /Party Night/.test(document.body.innerText));
  await h.shot(tv, 'tv-lobby');
  log(`  queued: ${GAMES.join(' -> ')}`);

  await host.locator('#lb-start').click();
  let tier = TIER;
  for (const [i, id] of GAMES.entries()) {
    for (const p of players) await p.locator('#rm-main > *').first().waitFor();
    log(`  game ${i + 1}: ${id}`);
    if (i === 0 && TIER !== 'standard') {
      // Ben goes out: his drinks become forfeits for the rest of the night.
      const ben = players[1];
      await ben.locator('#drink-chip').click();
      await ben.locator('.dk-out').first().click();
      await h.confirmSheet(ben);
      await ben.locator('.drink-chip', { hasText: 'Out' }).waitFor();
      log("  Ben tapped I'm out");
    }
    await drivers[id].room({ players, host, tv, variant: tier, h: helpers(`${tag}-${id}`) });
    await toStandings(host, h);
    for (const p of [...players.slice(1), tv]) await p.locator('.nt-standings').waitFor();
    await tv.locator('.moment').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
    await h.shot(tv, `tv-standings-${i + 1}`);
    await h.shot(players[2], `standings-${i + 1}`);
    log(`  standings after ${id}: ${(await tv.locator('.nt-board').innerText()).replace(/\s+/g, ' ')}`);
    if (i === 0 && TIER === 'deadly') {
      // The host drops the tier to Drinking between games.
      await host.locator('#drink-chip').click();
      await host.locator('.dk-drop .btn', { hasText: 'Drinking' }).click();
      await h.confirmSheet(host);
      await host.locator('.drink-chip.drinking').waitFor();
      await tv.waitForFunction(() => !document.querySelector('.pill-deadly'));
      tier = 'drinking';
      log('  host dropped the tier: Deadly -> Drinking');
    }
    if (i < GAMES.length - 1) {
      const next = drivers[GAMES[i + 1]];
      if (next.setup) {
        await host.locator('#nt-opts').waitFor();
        await next.setup({ page: host, mode: 'room', h });
      }
      await host.locator('.hostbar .btn', { hasText: `Play ` }).click();
    }
  }
  await host.locator('.hostbar .btn', { hasText: 'Awards' }).click();
  await tv.locator('.nt-recap.ceremony').waitFor();
  for (const p of players) await p.locator('.nt-recap').waitFor();
  const awardsN = await tv.locator('.aw').count();
  await tv.waitForTimeout(Math.min(30_000, awardsN * 3400 + 2500));
  await h.shot(tv, 'tv-awards');
  await h.shot(players[1], 'awards');
  log(`  awards: ${(await tv.locator('.aw-title').allInnerTexts()).join(', ')}`);
  const recap = await saveRecap(players[2], tag);
  log(`  recap image: ${recap}`);
  await host.locator('.hostbar .btn', { hasText: 'New night' }).click();
  await host.locator('.lobby').waitFor();
  for (const p of [...players, tv]) await p.context().close();
  return errors;
}

async function passNight() {
  const tag = `night-pass-${TIER}`;
  const h = helpers(tag);
  const errors = [];
  const page = await newPage(PHONE, 'phone', errors);
  const [first, ...rest] = GAMES;
  await page.goto(`${BASE}/#/new/${first}/pass/${TIER}`);
  if (TIER !== 'standard') await acceptAgeGate(page);
  await page.locator('#pass-form').waitFor();
  const inputs = page.locator('#names input');
  for (const [i, n] of ['Ana', 'Ben', 'Cy'].entries()) await inputs.nth(i).fill(n);
  if (await page.locator('#pass-opts [aria-label="Less Rounds"]').count()) {
    for (let i = 0; i < 4; i++) await page.locator('#pass-opts [aria-label="Less Rounds"]').click();
  }
  await h.shot(page, 'setup');
  await page.locator('#start').click();
  for (const [i, id] of [first, ...rest].entries()) {
    await page.locator('#pp-main > *').first().waitFor();
    log(`  game ${i + 1}: ${id}`);
    await drivers[id].pass({ page, variant: TIER, h: helpers(`${tag}-${id}`) });
    await menuPick(page, 'tandings');
    await page.locator('.nt-standings, .sheet-wrap.open .sheet-actions').first().waitFor();
    if (await page.locator('.sheet-wrap.open').count()) await h.confirmSheet(page);
    await page.locator('.nt-standings').waitFor();
    await h.shot(page, `standings-${i + 1}`);
    log(`  standings: ${(await page.locator('.nt-board').innerText()).replace(/\s+/g, ' ')}`);
    if (i < GAMES.length - 1) {
      await page.locator('.hostbar .btn', { hasText: 'Next game' }).click();
      await page.locator(`.sheet .game-row[data-value="${GAMES[i + 1]}"]`).click();
      const opts = page.locator('.sheet-next-opts.open');
      await opts.or(page.locator('#pp-main .gate, #pp-main > *:not(.nt)')).first().waitFor();
      if (await opts.count()) {
        if (drivers[GAMES[i + 1]].setup) await drivers[GAMES[i + 1]].setup({ page, mode: 'pass', h });
        // Each game of the night keeps its own pack: pick a curated one here.
        if (await opts.locator('#next-pack').count()) {
          await opts.locator('#next-pack').click();
          const card = page.locator('.sheet-wrap.open.sheet-pack .pk-card[data-pick^="c:"]').first();
          await card.waitFor();
          const title = (await card.locator('b').innerText()).trim();
          await card.click();
          await page.locator('.sheet-wrap.open.sheet-pack').waitFor({ state: 'detached' });
          await opts.locator('#next-pack', { hasText: title }).waitFor();
          await h.shot(page, 'next-opts');
          log(`  next game pack: ${title}`);
        }
        await opts.locator('.sheet-actions [data-i="0"]').click();
      }
    }
  }
  await page.locator('.hostbar .btn', { hasText: 'Awards' }).click();
  await page.locator('.nt-recap').waitFor();
  await page.waitForTimeout(2500);
  await h.shot(page, 'awards');
  const recap = await saveRecap(page, tag);
  log(`  recap image: ${recap}`);
  await page.context().close();
  return errors;
}

const results = [];
for (const mode of MODES) {
  const name = `party night ${mode} ${TIER}: ${GAMES.join(', ')}`;
  log(`\n▶ ${name}`);
  try {
    const errors = mode === 'room' ? await roomNight() : await passNight();
    if (errors.length) throw new Error(`console errors:\n    ${errors.join('\n    ')}`);
    results.push({ name, ok: true });
    log('  PASS');
  } catch (err) {
    results.push({ name, ok: false, err: err.message.split('\n').slice(0, 5).join('\n') });
    log(`  FAIL: ${err.message.split('\n').slice(0, 5).join('\n')}`);
  }
}
await browser.close();
if (moments.length) { log('\n==== Deadly takeovers seen ===='); for (const m of moments) log(`  ${m}`); }
log('\n==== summary ====');
for (const r of results) log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `: ${r.err}`}`);
writeFileSync(`${OUT}/night-summary.json`, JSON.stringify({ results, moments }, null, 2));
process.exit(results.every((r) => r.ok) ? 0 : 1);
