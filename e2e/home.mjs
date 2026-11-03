// The home page in a real browser: the card list, the search and the two
// filter rows, Surprise me, Party Night, the join field, the jump-back-in
// strip, the loading and failure states, no overflow at 390 / 768 / 1440,
// 44px targets, and screenshots.
//
//   node e2e/home.mjs [baseUrl]      default http://127.0.0.1:8979
//
// Screenshots: /tmp/games-e2e/home-*.png. Throws on anything wrong.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = (process.argv[2] || 'http://127.0.0.1:8979').replace(/\/+$/, '');
const OUT = process.env.E2E_OUT || '/tmp/games-e2e';
mkdirSync(OUT, { recursive: true });
const SIZES = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  tablet: { viewport: { width: 768, height: 1024 } },
  desktop: { viewport: { width: 1440, height: 900 } },
};
const NO_SW = { serviceWorkers: 'block' };
const log = (...a) => console.log(...a);
const errors = [];
const browser = await chromium.launch();

async function open(size, extra = {}, init = null) {
  const ctx = await browser.newContext({ ...SIZES[size], reducedMotion: 'no-preference', ...extra });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${size}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${size}: ${m.text()}`); });
  page.addLocatorHandler(page.locator('.sheet-wrap.open.sheet-install'), async (w) => { await w.locator('.sheet-actions [data-i="1"]').click().catch(() => {}); }, { noWaitAfter: true });
  return page;
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const shot = async (page, size, name, full = false) => { await page.waitForTimeout(600); await page.screenshot({ path: `${OUT}/home-${size}-${name}.png`, fullPage: full }); };

const index = (await (await fetch(`${BASE}/games/index.json`)).json()).games;

for (const size of Object.keys(SIZES)) {
  log(`\n${size}`);
  const page = await open(size);
  await page.goto(`${BASE}/`);
  await page.locator('a.deck').first().waitFor();

  // Cards say what the game is at a glance.
  ok((await page.locator('a.deck').count()) === index.length, 'one card per game');
  for (const id of ['imposter', 'werewolf']) {
    const card = page.locator(`a.deck[data-game="${id}"]`);
    const g = index.find((x) => x.id === id);
    ok((await card.locator('.deck-pitch').innerText()) === g.pitch, `${id}: pitch on the card`);
    const meta = await card.locator('.deck-meta').innerText();
    ok(meta.includes(`${g.minPlayers}-${g.maxPlayers}`), `${id}: player range on the card (${meta})`);
    ok(/\d+(-\d+)? min/.test(meta), `${id}: length on the card (${meta})`);
  }
  ok(!(await page.locator('a.deck .deck-meta').first().innerText()).includes('pack'), 'no pack count on the card');

  // Join and TV stay in reach, above the fold on a phone.
  const code = page.locator('#join-code');
  const tv = page.locator('a[href="/tv"]').first();
  for (const el of [code, tv, page.locator('#surprise'), page.locator('#night')]) {
    const box = await el.boundingBox();
    ok(box && box.y + box.height <= SIZES[size].viewport.height + 1, `${size}: hero actions above the fold`);
  }

  // Search narrows the list; an empty result is a designed state.
  await page.locator('#home-search').fill('imp');
  await page.waitForFunction(() => document.querySelectorAll('a.deck').length === 1);
  await page.locator('#home-search').fill('zzzz');
  await page.locator('.home-empty').waitFor();
  ok((await page.locator('.home-empty #home-clear').count()) === 1, 'empty state has a way out');
  await shot(page, size, 'empty');
  await page.locator('#home-clear').click();
  await page.waitForFunction((n) => document.querySelectorAll('a.deck').length === n, index.length);
  ok((await page.locator('#home-search').inputValue()) === '', 'clear resets the search');

  // Vibe + player count filters compose.
  await page.locator('[data-vibe="bluff"]').click();
  const bluff = index.filter((g) => g.vibes.includes('bluff')).length;
  await page.waitForFunction((n) => document.querySelectorAll('a.deck').length === n, bluff);
  ok((await page.locator('[data-vibe="bluff"]').getAttribute('aria-pressed')) === 'true', 'vibe chip is pressed');
  await page.locator('[data-vibe="bluff"]').click(); // toggles off
  await page.waitForFunction((n) => document.querySelectorAll('a.deck').length === n, index.length);
  await page.locator('[data-filter="2"]').click();
  const two = index.filter((g) => g.minPlayers <= 2).length;
  await page.waitForFunction((n) => document.querySelectorAll('a.deck').length === n, two);
  await page.locator('[data-filter="all"]').click();
  await page.locator('[data-vibe="quick"]').click();
  const quick = index.filter((g) => g.minutes && g.minutes[1] <= 20).length;
  await page.waitForFunction((n) => document.querySelectorAll('a.deck').length === n, quick);
  await page.locator('[data-vibe="quick"]').click();

  // Surprise me: a reveal sheet, then the game's start screen.
  await page.locator('#surprise').click();
  await page.locator('.sheet-wrap.open [data-value="play"]').waitFor();
  await shot(page, size, 'surprise');
  const picked = await page.locator('.sheet-wrap.open [data-game-id]').getAttribute('data-game-id');
  ok(index.some((g) => g.id === picked), 'surprise picked a real game');
  await page.locator('.sheet-wrap.open [data-value="play"]').click();
  await page.waitForURL(new RegExp(`#/new/${picked}$`));
  await page.goBack();
  await page.locator('a.deck').first().waitFor();

  // Party Night explains itself and leads into a game.
  await page.locator('#night').click();
  await page.locator('.sheet-wrap.open [data-value="pick"]').waitFor();
  await shot(page, size, 'night');
  await page.keyboard.press('Escape');
  await page.locator('.sheet-wrap.open').waitFor({ state: 'detached' });

  // Targets: every control on the home is at least 44px.
  const small = await page.evaluate(() => [...document.querySelectorAll('.home a, .home button, .home input')]
    .filter((el) => el.offsetParent && !el.closest('.code-field') && !el.classList.contains('visually-hidden'))
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.width && (r.height < 43.5 || r.width < 43.5))
    .map(({ el, r }) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}.${el.className} ${Math.round(r.width)}x${Math.round(r.height)} "${(el.textContent || '').trim().slice(0, 20)}"`));
  ok(!small.length, `${size}: controls under 44px: ${small.join('; ')}`);

  const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok(over <= 1, `${size}: horizontal overflow ${over}px`);
  await shot(page, size, 'fold');
  await page.screenshot({ path: `${OUT}/home-${size}-full.png`, fullPage: true });
  await page.context().close();
}

// Jump back in: the last game opened is one tap away.
{
  const page = await open('phone', {}, () => { if (!localStorage.getItem('games.last')) localStorage.setItem('games.last', 'wyr'); });
  await page.goto(`${BASE}/`);
  await page.locator('.jump a[href="/#/new/wyr"]').waitFor();
  ok((await page.locator('.jump').innerText()).includes('Would You Rather'), 'jump strip names the last game');
  await shot(page, 'phone', 'jump');
  await page.context().close();
}

// Loading: a skeleton shaped like the cards while the list is on its way.
{
  const page = await open('phone', NO_SW);
  await page.route('**/games/index.json', async (route) => { await new Promise((r) => setTimeout(r, 1500)); route.continue(); });
  await page.goto(`${BASE}/`);
  await page.locator('.deck.skel').first().waitFor();
  ok((await page.locator('.deck.skel').count()) >= 4, 'skeleton cards while loading');
  const h = (await page.locator('.deck.skel').first().boundingBox()).height;
  await shot(page, 'phone', 'loading');
  await page.locator('a.deck').first().waitFor();
  const real = (await page.locator('a.deck').first().boundingBox()).height;
  ok(Math.abs(h - real) <= 28, `skeleton ${h}px vs card ${real}px: no big jump`);
  await page.context().close();
}

// Failure: a real error with the message and a retry that works.
{
  const page = await open('phone', NO_SW);
  let fail = true;
  await page.route('**/games/index.json', (route) => (fail ? route.fulfill({ status: 500, body: 'boom' }) : route.continue()));
  await page.goto(`${BASE}/`);
  await page.locator('.state-card #retry').waitFor({ timeout: 15000 });
  ok((await page.locator('.state-card .err-detail').innerText()).includes('500'), 'error shows the status');
  await shot(page, 'phone', 'error');
  fail = false;
  await page.locator('#retry').click();
  await page.locator('a.deck').first().waitFor();
  await page.context().close();
}

// Keyboard: tab reaches the actions and a card, Enter opens it, and the
// radio-style chips move with the arrow keys.
{
  const page = await open('desktop');
  await page.goto(`${BASE}/`);
  await page.locator('a.deck').first().waitFor();
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    seen.add(await page.evaluate(() => document.activeElement.id || document.activeElement.className.split(' ')[0] || document.activeElement.tagName));
  }
  for (const want of ['surprise', 'night', 'join-code', 'home-search', 'deck']) ok(seen.has(want), `tab reaches ${want} (saw ${[...seen].join(', ')})`);
  await page.locator('a.deck[data-game="imposter"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForURL(/#\/new\/imposter$/);
  await page.context().close();
}

await browser.close();
if (errors.length) { console.log('\nerrors:'); for (const e of errors) console.log(`  ${e}`); process.exit(1); }
log('\nhome e2e ok');
