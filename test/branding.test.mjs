// The site's own address and contact email are filled in per request, not baked
// into the pages: the live site reads exactly as it always did, and any other
// host (or GAMES_SITE_URL / GAMES_CONTACT_EMAIL) gets its own.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIVE = 'games.example.com';
const procs = [];
let tmp;

const freePort = () => new Promise((res) => { const s = createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });

async function start(env = {}) {
  const port = await freePort();
  // A real .env in the checkout would otherwise leak into the child; it never overrides a set variable.
  const child = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, GAMES_SITE_URL: '', GAMES_CONTACT_EMAIL: '', GAMES_PORT: String(port), GAMES_PACKS_DIR: tmp, ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
  procs.push(child);
  await new Promise((res, rej) => { child.stdout.on('data', (d) => String(d).includes('games on') && res()); child.on('exit', () => rej(new Error('server exited'))); });
  // fetch() will not let a caller set Host, so go through node:http.
  return (path, host) => new Promise((res, rej) => {
    request({ host: '127.0.0.1', port, path, headers: host ? { host } : {} }, (r) => { let b = ''; r.setEncoding('utf8'); r.on('data', (c) => (b += c)); r.on('end', () => res(b)); }).on('error', rej).end();
  });
}

before(() => { tmp = mkdtempSync(join(tmpdir(), 'games-brand-')); });
after(() => { for (const p of procs) p.kill(); rmSync(tmp, { recursive: true, force: true }); });

test('on the live host every page reads as it did before the placeholders', async () => {
  const get = await start();
  const index = await get('/', LIVE);
  assert.match(index, new RegExp(`<link rel="canonical" href="https://${LIVE}/">`));
  assert.match(index, new RegExp(`og:image" content="https://${LIVE}/og-image.png"`));
  assert.match(await get('/privacy', LIVE), /href="mailto:games@example\.com">games@example\.com<\/a>/);
  assert.match(await get('/credits', LIVE), new RegExp(`canonical" href="https://${LIVE}/credits"`));
  assert.match(await get('/nope', LIVE), new RegExp(`look like ${LIVE}/r/ABCD`));
  assert.match(await get('/robots.txt', LIVE), new RegExp(`Sitemap: https://${LIVE}/sitemap.xml`));
  const sitemap = await get('/sitemap.xml', LIVE);
  assert.match(sitemap, new RegExp(`<loc>https://${LIVE}/</loc>`));
  assert.match(sitemap, new RegExp(`<loc>https://${LIVE}/games/imposter</loc>`));
  assert.match(await get('/games/imposter', LIVE), new RegExp(`canonical" href="https://${LIVE}/games/imposter"`));
});

test('another host gets its own address, and no placeholder ever reaches the browser', async () => {
  const get = await start();
  for (const path of ['/', '/privacy', '/credits', '/nope', '/robots.txt', '/sitemap.xml']) {
    const body = await get(path, 'play.example.org');
    assert.ok(!body.includes('{{'), `${path} has no raw placeholder`);
    assert.ok(!body.includes(LIVE) || path === '/privacy' || path === '/credits', `${path} does not name the maintainer's host`);
  }
  assert.match(await get('/', 'play.example.org'), /canonical" href="https:\/\/play\.example\.org\/"/);
  assert.match(await get('/sitemap.xml', 'localhost:1234'), /<loc>http:\/\/localhost:1234\/<\/loc>/);
});

test('GAMES_SITE_URL and GAMES_CONTACT_EMAIL override the request and the default', async () => {
  const get = await start({ GAMES_SITE_URL: 'https://fun.example.net/', GAMES_CONTACT_EMAIL: 'hi@example.net' });
  assert.match(await get('/', LIVE), /canonical" href="https:\/\/fun\.example\.net\/"/);
  assert.match(await get('/privacy', LIVE), /mailto:hi@example\.net">hi@example\.net</);
  assert.match(await get('/sitemap.xml', LIVE), /<loc>https:\/\/fun\.example\.net\/credits<\/loc>/);
});
