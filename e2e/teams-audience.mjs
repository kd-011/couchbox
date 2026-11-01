// Teams + audience platform e2e, in real headless Chromium:
//   teams:     a quiz-show room, 4 phones (390x844) + a TV (1440x900). The
//              host assigns 2 explicit teams in the lobby sheet, starts the
//              game, and one team member's answer/buzz locks in for their
//              teammate too (shared contestant).
//   audience:  a fake-out room with one more player than the game's cap
//              (13 for a cap of 12). The last joiner watches as audience,
//              gets the crowd-vote screen once the host forces the vote, and
//              betting on the (only) truth option never breaks the real game.
//   react:     the platform's reaction burst, menu -> React -> emoji, shows
//              up on another player's screen and the TV.
//
//   node e2e/teams-audience.mjs [baseUrl]
// Screenshots: /tmp/games-e2e/ta-*.png
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] && process.argv[2].startsWith('http') ? process.argv[2] : 'http://127.0.0.1:8979';
const OUT = process.env.E2E_OUT || '/tmp/games-e2e';
mkdirSync(OUT, { recursive: true });
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
const TV = { viewport: { width: 1440, height: 900 } };
const log = (...a) => console.log(...a);
const browser = await chromium.launch();

async function newPage(opts, label, errors) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label}: ${m.text()}`); });
  await page.addLocatorHandler(page.locator('.moment .mo-done'), async (btn) => {
    await btn.click({ force: true }).catch(() => {});
  }, { noWaitAfter: true });
  for (const [sel, btn] of [['.sheet-wrap.open.sheet-howto', '0'], ['.sheet-wrap.open.sheet-install', '1']]) {
    await page.addLocatorHandler(page.locator(sel), async (w) => {
      await w.locator(`.sheet-actions [data-i="${btn}"]`).click().catch(() => {});
      await w.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
    }, { noWaitAfter: true });
  }
  return page;
}

async function confirmSheet(page) {
  const btn = page.locator('.sheet-wrap.open .sheet-actions [data-i="0"]');
  await btn.waitFor({ timeout: 5000 });
  await btn.click();
  await page.locator('.sheet-wrap').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
}

async function joinRoom(code, name, errors) {
  const p = await newPage(PHONE, name, errors);
  await p.goto(`${BASE}/r/${code}`);
  await p.locator('#join-name').fill(name);
  await p.locator('#join-go').click();
  await p.locator('.lobby').waitFor();
  return p;
}

async function teamsRun() {
  const tag = 'ta-teams';
  const errors = [];
  const host = await newPage(PHONE, 'host', errors);
  await host.goto(`${BASE}/#/new/quiz-show/room/standard`);
  await host.locator('#host-name').fill('Ana');
  await host.locator('#create').click();
  await host.locator('.lobby').waitFor();
  await host.waitForURL(/\/r\/[A-Z]{4}$/);
  const code = host.url().split('/r/')[1];
  log(`  room ${code}`);
  const tv = await newPage(TV, 'tv', errors);
  await tv.goto(`${BASE}/tv/${code}`);
  await tv.locator('.tv-lobby').waitFor();

  const ben = await joinRoom(code, 'Ben', errors);
  const cy = await joinRoom(code, 'Cy', errors);
  const dev = await joinRoom(code, 'Dev', errors);
  await host.locator('.seat:not(.seat-empty) .seat-btn').nth(3).waitFor();

  // Teams sheet: Ana+Ben -> team 1, Cy+Dev -> team 2 (one tap = team 1, two
  // taps = team 2; a tap past the team count wraps back to unassigned).
  await host.locator('#lb-settings').click();
  await host.locator('#st-teams').click();
  await host.locator('.sheet-teams .tm-chip').nth(3).waitFor();
  const tapChip = async (i) => { await host.locator('.sheet-teams .tm-chip').nth(i).click(); await host.waitForTimeout(150); };
  await tapChip(0); // Ana -> team 1
  await tapChip(1); // Ben -> team 1
  await tapChip(2); await tapChip(2); // Cy -> team 2
  await tapChip(3); await tapChip(3); // Dev -> team 2
  const chipText = await host.locator('.sheet-teams .tm-chip').allInnerTexts();
  if (!/Team Red/.test(chipText[0]) || !/Team Red/.test(chipText[1]) || !/Team Blue/.test(chipText[2]) || !/Team Blue/.test(chipText[3])) {
    throw new Error(`team chip assignment looked wrong: ${JSON.stringify(chipText)}`);
  }
  await host.locator('.sheet-teams .sheet-actions [data-i="0"]', { hasText: 'Save teams' }).click();
  await host.locator('.sheet-wrap').waitFor({ state: 'detached' });
  await host.locator('.team-dot').nth(3).waitFor();
  const dots = await host.locator('.team-dot').count();
  if (dots !== 4) throw new Error(`expected 4 team dots in the lobby, saw ${dots}`);
  log('  teams saved: Ana+Ben vs Cy+Dev');
  await host.screenshot({ path: `${OUT}/${tag}-lobby.png` });

  await host.locator('#lb-start').click();
  for (const p of [host, ben, cy, dev]) await p.locator('#rm-main > *').first().waitFor();
  await tv.locator('.qs-board, .qs-stage').first().waitFor();

  // Board: the host (any player can, but keep it simple) picks a tile, and
  // wait for the board itself to go away before reading what round it is.
  await host.locator('.qs-tile').first().click();
  await host.waitForFunction(() => !document.querySelector('.qs-board'), { timeout: 8000 });
  await host.waitForTimeout(300);

  const buzzer = await host.locator('[data-act="buzz"]').count();
  log(`  round type: ${buzzer ? 'buzzer' : 'answer'}`);
  if (buzzer) {
    await ben.locator('[data-act="buzz"]').first().click();
    await host.waitForFunction(() => !document.querySelector('[data-act="buzz"]:not([disabled])'), { timeout: 5000 });
    log("  buzzer: Ben buzzed in, teammate Ana's Buzz! button is gone too (shared contestant)");
  } else {
    await ben.locator('[data-act="answer"]').first().waitFor();
    await ben.locator('[data-act="answer"]').first().click();
    await host.locator('[data-act="answer"].on').first().waitFor({ timeout: 5000 });
    log("  Ben answered; Ana's screen shows the same pick locked in (shared contestant)");
  }
  await host.screenshot({ path: `${OUT}/${tag}-question-host.png` });
  await tv.screenshot({ path: `${OUT}/${tag}-question-tv.png` });

  for (const p of [host, ben, cy, dev, tv]) await p.context().close();
  if (errors.length) throw new Error(`console errors:\n    ${errors.join('\n    ')}`);
}

async function audienceRun() {
  const tag = 'ta-audience';
  const errors = [];
  const host = await newPage(PHONE, 'host', errors);
  await host.goto(`${BASE}/#/new/fake-out/room/standard`);
  await host.locator('#host-name').fill('Host');
  await host.locator('#create').click();
  await host.locator('.lobby').waitFor();
  await host.waitForURL(/\/r\/[A-Z]{4}$/);
  const code = host.url().split('/r/')[1];
  log(`  room ${code}, filling to one over the cap of 12...`);

  const joiners = [];
  for (let i = 0; i < 12; i++) joiners.push(await joinRoom(code, `P${i}`, errors));
  await host.locator('.seat:not(.seat-empty) .seat-btn').nth(12).waitFor();
  log(`  13 players in (host + 12 joiners); the 13th (last joined) watches as audience`);

  await host.locator('#lb-start').click();
  for (const p of [host, ...joiners]) await p.locator('#rm-main > *').first().waitFor();

  const audiencePage = joiners.at(-1);
  // Confirm they are watching, not writing a fake, before the vote even opens.
  const watchingText = await audiencePage.locator('#rm-main').innerText();
  if (!/next round|crowd/i.test(watchingText)) throw new Error(`audience member's pre-vote screen looked wrong: ${watchingText.slice(0, 120)}`);

  // Force the vote without anyone writing a fake: the only vote option left
  // is the truth, so the crowd's bet can never go wrong either.
  await host.locator('.hostbar .btn', { hasText: 'Start voting now' }).click();
  await confirmSheet(host);
  await audiencePage.locator('[data-act="audienceVote"]').first().waitFor({ timeout: 8000 });
  await audiencePage.screenshot({ path: `${OUT}/${tag}-crowd-vote.png` });
  await audiencePage.locator('[data-act="audienceVote"]').first().click();
  await audiencePage.locator('.pick.on, [aria-pressed="true"]').first().waitFor({ timeout: 5000 });
  log('  audience member saw the crowd-vote screen and voted');

  await host.locator('.hostbar .btn', { hasText: 'Close voting' }).click();
  await confirmSheet(host);
  await host.locator('.fo-result, .fo-stage').first().waitFor();
  log('  the round resolved fine with an audience bet in play');

  for (const p of [host, ...joiners]) await p.context().close();
  if (errors.length) throw new Error(`console errors:\n    ${errors.join('\n    ')}`);
}

async function reactRun() {
  const tag = 'ta-react';
  const errors = [];
  const host = await newPage(PHONE, 'host', errors);
  await host.goto(`${BASE}/#/new/wyr/room/standard`);
  await host.locator('#host-name').fill('Ana');
  await host.locator('#create').click();
  await host.locator('.lobby').waitFor();
  await host.waitForURL(/\/r\/[A-Z]{4}$/);
  const code = host.url().split('/r/')[1];
  const tv = await newPage(TV, 'tv', errors);
  await tv.goto(`${BASE}/tv/${code}`);
  await tv.locator('.tv-lobby').waitFor();
  const ben = await joinRoom(code, 'Ben', errors);
  await host.locator('.seat:not(.seat-empty) .seat-btn').nth(1).waitFor();

  await ben.locator('#rm-menu').click();
  await ben.locator('.menu-item', { hasText: 'React' }).click();
  await ben.locator('.react-pick').first().click();
  await host.locator('.reaction-float').first().waitFor({ timeout: 5000 });
  await tv.locator('.reaction-float').first().waitFor({ timeout: 5000 });
  log('  Ben reacted; the floating emoji showed on Ana\'s phone and the TV');
  await host.screenshot({ path: `${OUT}/${tag}-host.png` });

  for (const p of [host, ben, tv]) await p.context().close();
  if (errors.length) throw new Error(`console errors:\n    ${errors.join('\n    ')}`);
}

const results = [];
for (const [name, run] of [['teams', teamsRun], ['audience', audienceRun], ['react', reactRun]]) {
  log(`\n▶ ${name}`);
  const t0 = Date.now();
  try {
    await run();
    results.push({ name, ok: true });
    log(`  PASS (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (err) {
    results.push({ name, ok: false, err: err.message.split('\n').slice(0, 6).join('\n') });
    log(`  FAIL: ${err.message.split('\n').slice(0, 6).join('\n')}`);
  }
}
await browser.close();
log('\n==== summary ====');
for (const r of results) log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `: ${r.err}`}`);
log(`screenshots: ${OUT}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
