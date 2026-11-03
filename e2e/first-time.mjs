// The first-time group, in real Chromium: nobody has seen this before. One phone hosts, one guest
// scans the QR, one types the code on the home page, and a card reaches everyone. Every phone is a
// fresh browser, so the first-run how-to sheets are on. Fails if the flow regresses past its budget.
//
//   node e2e/first-time.mjs [baseUrl]    default: starts its own server on a spare port
//
// The site runs under a made-up hostname so the browser treats it as a plain http origin on a home
// network: no secure context, no clipboard API, no service worker. Screenshots: $E2E_OUT or /tmp/games-e2e.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = process.env.E2E_OUT || '/tmp/games-e2e';
mkdirSync(OUT, { recursive: true });
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 18000 + Math.floor(Math.random() * 2000);
let server = null;
let local = process.argv[2]?.replace(/\/+$/, '');
if (!local) {
  server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, GAMES_PORT: String(PORT), GAMES_HOST: '127.0.0.1', GAMES_PACKS_DIR: `${OUT}/first-time-packs` } });
  local = `http://127.0.0.1:${PORT}`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${local}/healthz`)).ok) break; } catch { /* still starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
}
const { hostname, port } = new URL(local);
const IS_LOCAL = /^(localhost|127\.)/.test(hostname);
const NETWORK = IS_LOCAL ? `http://party.test:${port}` : local; // the same server, as a phone on the wifi sees it
const browser = await chromium.launch({ args: [`--host-resolver-rules=MAP party.test ${hostname}`] });
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
const errors = [];
let taps = 0;
let keys = 0;
const t0 = Date.now();
const log = (s) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s  ${String(taps).padStart(2)} taps  ${String(keys).padStart(2)} keys  ${s}`);
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const tap = async (l) => { await l.click(); taps++; };
const type = async (l, s) => { await l.pressSequentially(s); keys += s.length; };

async function phone(label) {
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label}: ${m.text()}`); });
  return page;
}

try {
  // On localhost the QR would be dead on every phone, so the lobby says so instead of drawing it.
  if (IS_LOCAL) {
    const lone = await phone('localhost host');
    await lone.goto(`${local}/#/new/imposter`);
    await lone.locator('#host-name').fill('Ana');
    await lone.locator('#go-room').click();
    await lone.locator('.lobby').waitFor();
    ok(await lone.locator('.lobby-localhost').isVisible(), 'localhost: the lobby warns that phones cannot open this address');
    ok(!(await lone.locator('.lobby-qr').count()), 'localhost: no dead QR in the lobby');
    await lone.screenshot({ path: `${OUT}/first-lobby-localhost.png` });
    await lone.context().close();
  }

  const host = await phone('host');
  await host.goto(`${NETWORK}/`);
  await host.locator('a.deck').first().waitFor();
  log('home loaded');
  await tap(host.locator('a.deck[data-game="imposter"]'));
  await host.locator('#go-room').waitFor();
  await type(host.locator('#host-name'), 'Ana');
  await tap(host.locator('#go-room'));
  await host.locator('.lobby').waitFor();
  const code = /\/r\/([A-Z]{4})/.exec(host.url())?.[1];
  ok(code, 'the host landed in a room');
  log(`host in lobby, room ${code}`);
  ok(taps <= 2, `host reaches the lobby in 2 taps (took ${taps})`);

  // The way in is on screen, with no tap, while the room needs people.
  const qr = host.locator('.lobby-qr img');
  await qr.waitFor();
  ok(!(await host.locator('.sheet-wrap.open').count()), 'no sheet in the way');
  const box = await qr.boundingBox();
  ok(box.y + box.height <= 844, 'the QR is above the fold on a phone');
  ok(box.width >= 150, `the QR is big enough to scan across a table (${box.width}px)`);
  ok(await qr.evaluate((i) => i.complete && i.naturalWidth > 0), 'the QR image loaded');
  await host.waitForTimeout(400);
  await host.screenshot({ path: `${OUT}/first-lobby-waiting.png` });

  // No clipboard API on a plain http origin. The copy has to work anyway.
  await host.locator('#lb-share').click();
  await host.locator('.sheet-share').waitFor();
  await host.locator('[data-value="copy"]').click();
  await host.locator('.toast', { hasText: 'Link copied' }).waitFor({ timeout: 3000 });
  await host.locator('.sheet-wrap').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});

  // Guest one scans: the QR opens the join link.
  const scan = await phone('scan');
  await scan.goto(`${NETWORK}/r/${code}`);
  await scan.locator('#join-name').waitFor();
  await type(scan.locator('#join-name'), 'Ben');
  await tap(scan.locator('#join-go'));
  await scan.locator('.lobby').waitFor();
  log('guest who scanned is in');

  // Guest two types the code on the home page. The fourth letter is enough.
  const typed = await phone('typed');
  await typed.goto(`${NETWORK}/`);
  const tapsBefore = taps;
  await type(typed.locator('#join-code'), code);
  await typed.locator('#join-name').waitFor({ timeout: 3000 });
  ok(taps === tapsBefore, 'the fourth letter of the code moves on by itself');
  await type(typed.locator('#join-name'), 'Cy');
  await tap(typed.locator('#join-go'));
  await typed.locator('.lobby').waitFor();
  log('guest who typed is in');

  ok(await host.locator('.code-tiles.still').count(), 'a join does not re-deal the code tiles');
  ok(await host.locator('.seat.still').count() >= 2, 'only the newcomer gets a seat entrance');

  // Enough players: the QR steps aside so the game settings and Start come back up, and stays one tap away.
  await host.locator('.lobby-qr').waitFor({ state: 'detached', timeout: 3000 });
  ok(await host.locator('#lb-qr').isVisible(), 'the QR button is still there for latecomers');
  await host.waitForTimeout(400);
  await host.screenshot({ path: `${OUT}/first-lobby-ready.png` });

  await tap(host.getByRole('button', { name: /start imposter/i }));
  log('host started');
  for (const p of [host, scan, typed]) {
    await p.locator('.sheet-wrap.open.sheet-howto').waitFor({ timeout: 5000 });
    await tap(p.locator('.sheet-wrap.open .sheet-actions [data-i="0"]'));
    await p.locator('.imp-card').waitFor();
  }
  log('a card is on every phone');
  ok(taps <= 9, `three strangers get from nothing to a dealt card in 9 taps (took ${taps})`);
  ok(keys <= 12, `and 12 keystrokes (took ${keys})`);
  ok(!errors.length, `browser errors:\n${errors.join('\n')}`);
  console.log(`PASS: ${taps} taps, ${keys} keystrokes, ${((Date.now() - t0) / 1000).toFixed(1)}s of machine time`);
} finally {
  await browser.close();
  server?.kill();
}
