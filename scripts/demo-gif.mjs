// The README's gameplay GIF, from a real run: starts this server, then three phones and a TV play one
// round of Imposter over real WebSockets, with invented players. Nothing is staged except the pacing.
//   node scripts/demo-gif.mjs [outFile]      default docs/screenshots/demo.gif
// Needs ffmpeg on PATH and a Chromium Playwright can find (npx playwright-core install chromium).
import { chromium } from 'playwright-core';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = process.argv[2] || join(ROOT, 'docs', 'screenshots', 'demo.gif');
const WORK = mkdtempSync(join(tmpdir(), 'games-demo-'));
const PORT = 18000 + Math.floor(Math.random() * 2000);
const HOST = 'games.local'; // what the TV shows as the address; the browser maps it to this server

const FPS = 10;
const WIDTH = 1100;
const BG = '0x0d0b14';
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true };
const TV = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };

const server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, GAMES_PORT: String(PORT), GAMES_HOST: '127.0.0.1', GAMES_PACKS_DIR: join(WORK, 'packs') } });
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/healthz`)).ok) break; } catch { /* still starting */ }
  await new Promise((r) => setTimeout(r, 100));
}

const browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${HOST}:80 127.0.0.1:${PORT}`] });
const BASE = `http://${HOST}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(opts) {
  const ctx = await browser.newContext({ ...opts, serviceWorkers: 'block' });
  // Readers have already seen the how-to sheet in the rules; it would only slow the clip down.
  await ctx.addInitScript(() => localStorage.setItem('games.howto.imposter', '1'));
  return ctx.newPage();
}

// One frame stream per screen: screenshots as fast as they come, each stamped with when it was taken.
let recording = true;
const streams = [];
function record(page, name) {
  const dir = join(WORK, name);
  mkdirSync(dir);
  const frames = [];
  streams.push({ name, dir, frames });
  return (async () => {
    while (recording) {
      const file = join(dir, `${String(frames.length).padStart(5, '0')}.jpg`);
      await page.screenshot({ path: file, type: 'jpeg', quality: 95 });
      frames.push({ file, at: Date.now() });
      await wait(40);
    }
  })();
}

// Types like a person, and taps with a beat before it, so the clip can be followed.
const NAMES = ['Ana', 'Ben', 'Cy'];
const say = (locator, text) => locator.pressSequentially(text, { delay: 90 });
const beat = (ms = 500) => wait(ms);

const [ana, ben, cy, tv] = [await open(PHONE), await open(PHONE), await open(PHONE), await open(TV)];
await ana.goto(`${BASE}/#/new/imposter`);
await ana.locator('#host-name').fill('Ana');
await ana.locator('#go-room').click();
await ana.locator('.lobby').waitFor();
const code = /\/r\/([A-Z]{4})/.exec(ana.url())[1];
await tv.goto(`${BASE}/tv/${code}`);
await tv.locator('.tv-qr').waitFor();
for (const p of [ben, cy]) {
  await p.goto(`${BASE}/r/${code}`);
  await p.locator('#join-name').waitFor();
}
await wait(1200); // the entrances finish before the first frame

const t0 = Date.now();
const recorders = [record(ana, 'ana'), record(ben, 'ben'), record(cy, 'cy'), record(tv, 'tv')];
await beat(1500);

await say(ben.locator('#join-name'), 'Ben');
await beat(300);
await ben.locator('#join-go').click();
await beat(1100);
await say(cy.locator('#join-name'), 'Cy');
await beat(300);
await cy.locator('#join-go').click();
await ana.locator('#lb-start:not([aria-disabled="true"])').waitFor();
await beat(1500);

await ana.locator('#lb-start').click();
await ana.locator('.imp-card').waitFor();
await beat(900);
let imposter = 0;
for (const [i, p] of [ana, ben, cy].entries()) {
  await p.locator('.imp-card').click();
  if (await p.locator('.imp-back.is-imposter').count()) imposter = i;
  await beat(500);
}
await beat(1900);
for (const p of [ana, ben, cy]) {
  await p.locator('[data-act="seen"]').click();
  await beat(250);
}
await ana.locator('.cd-ring').waitFor();
await beat(1700);
await ana.locator('.hostbar .btn', { hasText: 'Vote now' }).first().click();
await beat(150);
if (await ana.locator('.sheet-wrap.open').count()) await ana.locator('.sheet-wrap.open .sheet-actions [data-i="0"]').click();
for (const p of [ana, ben, cy]) await p.locator('.pick[data-act="vote"]').first().waitFor();
await beat(900);
// The crew vote for the real imposter, so the clip ends with them caught.
for (const [i, p] of [ana, ben, cy].entries()) {
  const pick = i === imposter ? p.locator('.pick[data-act="vote"]').first() : p.locator('.pick[data-act="vote"]', { hasText: NAMES[imposter] });
  await pick.click();
  await beat(350);
}
await tv.locator('.imp-result').waitFor();
await beat(3600);

recording = false;
await Promise.all(recorders);
const end = Date.now();
await browser.close();
server.kill();

// Each stream becomes a timed slideshow, then they are laid out side by side: the TV, then the phones.
const lists = streams.map(({ name, frames }) => {
  const lines = [];
  frames.forEach((f, i) => {
    const from = i === 0 ? t0 : f.at;
    const to = frames[i + 1]?.at ?? end;
    lines.push(`file '${f.file}'`, `duration ${((to - from) / 1000).toFixed(3)}`);
  });
  lines.push(`file '${frames.at(-1).file}'`);
  const list = join(WORK, `${name}.txt`);
  writeFileSync(list, `${lines.join('\n')}\n`);
  return list;
});
const seconds = (end - t0) / 1000;
const GAP = 12;
const phoneW = 186, phoneH = Math.round(phoneW * 844 / 390);
const tvW = WIDTH - 3 * phoneW - 5 * GAP, tvH = Math.round(tvW * 800 / 1280);
const H = phoneH + 2 * GAP;
const filter = [
  `[0:v]fps=${FPS},scale=${phoneW}:${phoneH}:flags=lanczos[a]`,
  `[1:v]fps=${FPS},scale=${phoneW}:${phoneH}:flags=lanczos[b]`,
  `[2:v]fps=${FPS},scale=${phoneW}:${phoneH}:flags=lanczos[c]`,
  `[3:v]fps=${FPS},scale=${tvW}:${tvH}:flags=lanczos[t]`,
  `color=c=${BG}:s=${WIDTH}x${H}:r=${FPS}:d=${seconds}[bg]`,
  `[bg][t]overlay=${GAP}:${Math.round((H - tvH) / 2)}[v1]`,
  `[v1][a]overlay=${2 * GAP + tvW}:${GAP}[v2]`,
  `[v2][b]overlay=${3 * GAP + tvW + phoneW}:${GAP}[v3]`,
  `[v3][c]overlay=${4 * GAP + tvW + 2 * phoneW}:${GAP}:shortest=1,split[s0][s1]`,
  '[s0]palettegen=max_colors=128:stats_mode=diff[p]',
  '[s1][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
].join(';');
const inputs = lists.flatMap((l) => ['-f', 'concat', '-safe', '0', '-i', l]);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filter, '-loop', '0', OUT], { stdio: 'inherit' });
rmSync(WORK, { recursive: true, force: true });
console.log(`${OUT}: ${seconds.toFixed(1)}s, ${(statSync(OUT).size / 1e6).toFixed(1)} MB`);
