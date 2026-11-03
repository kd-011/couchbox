// What the README promises a self-hoster: one command, phones on the same network can join, and a
// packaged copy that really has the files it needs. These start the real server on a spare port.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lanAddress, isLoopbackHost, isPlainHttpHost, lanBanner } from '../lib/lan.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const pkg = JSON.parse(read('package.json'));

const iface = (address, internal = false, family = 'IPv4') => ({ address, internal, family });

function freePort() {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

// Starts a server script and resolves once it prints its listening line. The caller stops it.
async function start(args, env = {}, t) {
  const home = mkdtempSync(join(tmpdir(), 'games-selfhost-'));
  const port = await freePort();
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, HOME: home, GAMES_PACKS_DIR: join(home, 'packs'), GAMES_PORT: String(port), GAMES_HOST: '', GAMES_SITE_URL: '', ...env },
  });
  let out = '';
  child.stderr.on('data', (d) => { out += d; });
  const up = new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { out += d; if (/Ctrl\+C|games on /.test(out)) resolve(); });
    child.on('exit', () => reject(new Error(`exited early:\n${out}`)));
  });
  t.after(() => { child.removeAllListeners('exit'); child.kill(); rmSync(home, { recursive: true, force: true }); });
  await up;
  await new Promise((r) => setTimeout(r, 100)); // let the rest of the banner arrive
  return { port, output: () => out };
}

test('lanAddress picks the home network, not a container bridge or a VPN', () => {
  assert.equal(lanAddress({
    lo: [iface('127.0.0.1', true)],
    docker0: [iface('172.17.0.1')],
    tailscale0: [iface('100.70.1.2')],
    wlan0: [iface('fe80::1', false, 'IPv6'), iface('192.168.1.20')],
  }), '192.168.1.20');
  assert.equal(lanAddress({ eth0: [iface('10.0.0.5')], br0: [iface('172.20.0.1')] }), '10.0.0.5');
  assert.equal(lanAddress({ lo: [iface('127.0.0.1', true)] }), null, 'no network at all');
});

test('isLoopbackHost knows every way to spell this computer', () => {
  for (const h of ['localhost', 'localhost:8969', '127.0.0.1:8969', '[::1]:8969', '127.1.2.3']) assert.equal(isLoopbackHost(h), true, h);
  for (const h of ['192.168.1.20:8969', 'games.example.com', '', undefined]) assert.equal(isLoopbackHost(h), false, String(h));
});

test('a home network address is plain http, a real domain is https, and a proxy that says otherwise wins', async (t) => {
  for (const h of ['192.168.1.20:8969', '10.0.0.5:8969', '172.16.4.2:8969', 'nas:8969', 'nas.local:8969', 'localhost:8969']) assert.equal(isPlainHttpHost(h), true, h);
  for (const h of ['games.example.com', 'games.example.com:8443', '8.8.8.8:8969']) assert.equal(isPlainHttpHost(h), false, h);
  // The sitemap and the QR codes take the same origin. A QR that said https here would fail on every phone.
  const { port } = await start(['server.mjs'], {}, t);
  const origin = (headers) => new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port, path: '/sitemap.xml', headers }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve(/<loc>([^<]+)\//.exec(body)?.[1]));
    }).on('error', reject).end();
  });
  assert.match(await origin({ Host: '192.168.1.20:8969' }), /^http:\/\/192\.168\.1\.20:8969/);
  assert.match(await origin({ Host: 'games.example.com' }), /^https:\/\/games\.example\.com/);
  assert.match(await origin({ Host: 'games.example.com', 'X-Forwarded-Proto': 'http' }), /^http:\/\/games\.example\.com/);
});

test('the banner gives the address and a scannable code, or says plainly there is no network', () => {
  const up = lanBanner({ address: '192.168.1.20', port: 8969 });
  assert.match(up, /http:\/\/192\.168\.1\.20:8969/);
  assert.match(up, /[█▀▄]{4}/, 'a QR code drawn in the terminal');
  assert.match(up, /Ctrl\+C/);
  const down = lanBanner({ address: null, port: 8969 });
  assert.match(down, /http:\/\/localhost:8969/);
  assert.doesNotMatch(down, /[█▀▄]{4}/);
});

test('npm start stays on this computer and says how to let phones in', async (t) => {
  const { port, output } = await start(['server.mjs'], {}, t);
  assert.equal((await fetch(`http://127.0.0.1:${port}/healthz`)).status, 200);
  const lan = lanAddress();
  if (lan) await assert.rejects(fetch(`http://${lan}:${port}/healthz`, { signal: AbortSignal.timeout(1000) }));
  assert.match(output(), /--lan|npm run lan/);
});

test('the one-command start listens on the network and prints the address', async (t) => {
  const { port, output } = await start(['bin/party-games.mjs'], {}, t);
  const lan = lanAddress();
  if (lan) {
    assert.ok(output().includes(`http://${lan}:${port}`), output());
    assert.equal((await fetch(`http://${lan}:${port}/healthz`)).status, 200);
  } else {
    assert.ok(output().includes(`http://localhost:${port}`), output());
  }
});

test('in LAN mode a browser on localhost moves to the network address, so QR codes and links work on phones', async (t) => {
  const lan = lanAddress();
  if (!lan) return t.skip('this machine has no network address');
  const { port } = await start(['server.mjs', '--lan'], {}, t);
  const r = await fetch(`http://127.0.0.1:${port}/r/ABCD`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), `http://${lan}:${port}/r/ABCD`);
  assert.equal((await fetch(`http://127.0.0.1:${port}/healthz`, { redirect: 'manual' })).status, 200, 'health checks stay local');
  assert.equal((await fetch(`http://${lan}:${port}/`, { redirect: 'manual' })).status, 200);
});

test('GAMES_SITE_URL wins over the LAN redirect', async (t) => {
  const { port } = await start(['server.mjs', '--lan'], { GAMES_SITE_URL: 'https://games.example.com' }, t);
  assert.equal((await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual' })).status, 200);
});

test('a port already in use gets a plain sentence, not a stack trace', async (t) => {
  const { port } = await start(['server.mjs'], {}, t);
  const r = spawnSync(process.execPath, ['server.mjs'], { cwd: ROOT, encoding: 'utf8', timeout: 15000, env: { ...process.env, GAMES_PORT: String(port), GAMES_HOST: '', GAMES_PACKS_DIR: join(tmpdir(), 'games-selfhost-busy') } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, new RegExp(`Port ${port} is already in use`));
  assert.match(r.stderr, /GAMES_PORT/);
  assert.doesNotMatch(r.stderr, /at .*\(node:/);
});

test('npx can run it: a bin, an honest engines range, and a package holding the whole app but no test kit', () => {
  const bin = pkg.bin?.['party-games'];
  assert.equal(bin, 'bin/party-games.mjs');
  assert.match(read(bin), /^#!\/usr\/bin\/env node\n/);
  assert.ok(statSync(join(ROOT, bin)).mode & 0o111, 'the bin is executable');
  assert.equal(pkg.engines?.node, '>=20');
  // The release job tags from the export commits and refuses a tree whose version disagrees, so there is none.
  // npx from git does not need one, but npm pack refuses to run without it: read the files list instead.
  assert.equal(pkg.version, undefined);
  for (const need of ['bin', 'lib', 'public', 'games', 'server.mjs', 'THIRD_PARTY_NOTICES.md']) assert.ok(pkg.files.includes(need), `package is missing ${need}`);
  for (const no of ['e2e', 'docs', 'test', 'scripts']) assert.ok(!pkg.files.includes(no), `package should not carry ${no}`);
});

test('the Docker files bind for a container, run as non-root, keep packs in a volume and leave secrets out', () => {
  const docker = read('Dockerfile');
  assert.match(docker, /GAMES_HOST=0\.0\.0\.0/);
  assert.match(docker, /^USER node$/m);
  assert.match(docker, /npm ci --omit=dev/);
  assert.match(docker, /HEALTHCHECK/);
  assert.match(docker, /GAMES_PACKS_DIR=\/data/);
  const compose = read('compose.yaml');
  assert.match(compose, /8969:8969/);
  assert.match(compose, /:\/data/);
  const ignore = read('.dockerignore').split('\n');
  for (const f of ['.env', '.git', 'node_modules', 'data']) assert.ok(ignore.includes(f), `.dockerignore needs ${f}`);
});

test('the README is the short one: real commands, a real gameplay GIF, reference moved to docs', () => {
  const readme = read('README.md');
  const words = readme.replace(/<!--.*?-->/g, '').split(/\s+/).filter(Boolean).length;
  assert.ok(words <= 500, `reads in about two minutes (${words} words)`);
  assert.doesNotMatch(readme, /<this repo>/, 'no placeholder in a command');
  assert.doesNotMatch(readme, /^cd games$/m, 'the public repo is not called games');
  assert.match(readme, /npx github:kd-011\/party-games/);
  assert.match(readme, /docs\/SELF-HOSTING\.md/);
  assert.match(readme, /18\+/);
  // Above the fold: the GIF comes before the first section heading.
  const top = readme.split(/^## /m)[0];
  assert.match(top, /docs\/screenshots\/demo\.gif/);
  const gif = join(ROOT, 'docs/screenshots/demo.gif');
  assert.ok(existsSync(gif), 'the GIF exists');
  assert.ok(statSync(gif).size < 8_000_000, 'the GIF loads on a phone');
  assert.ok(read('scripts/export-allowlist.txt').split('\n').includes('docs/screenshots/demo.gif'), 'the export may publish it');
  assert.ok(existsSync(join(ROOT, 'scripts/demo-gif.mjs')), 'and a committed script makes it');
});

test('every variable in .env.example is documented in docs/SELF-HOSTING.md', () => {
  const doc = read('docs/SELF-HOSTING.md');
  const vars = [...read('.env.example').matchAll(/^#?\s?([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]);
  assert.ok(vars.length > 8);
  for (const v of vars) if (!/^(GAMES_TEST_HOOKS|GAMES_EXAMPLE|GAMES_CANARY_URL|E2E_OUT)$/.test(v)) assert.ok(doc.includes(v), `${v} is undocumented`);
});
