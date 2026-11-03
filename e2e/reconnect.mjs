// A dropped socket mid-round must be a non-event for a phone in a room.
//
//   node e2e/reconnect.mjs [--base=http://127.0.0.1:8979]
//
// A real Chromium phone talks to the server through a small TCP proxy that can
// (a) reset every connection, like a tunnel re-registering, and (b) black-hole
// them: bytes just stop in both directions and nothing closes, like a phone
// walking out of signal. Websocket bots play the other seats directly.
//
// Asserted, per scenario:
//   - the screen the player is looking at is not rebuilt or moved (same DOM
//     node, same layout position, no status bar pushing it down)
//   - a blip under ~1s shows no status at all; a long outage shows a small
//     status that does not shift the layout and clears when back
//   - a tap made during the outage is not lost, and counts once
import { chromium } from 'playwright-core';
import WebSocket from 'ws';
import http from 'node:http';
import net from 'node:net';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] ?? d;
const BASE = arg('base', 'http://127.0.0.1:8979');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const target = new URL(BASE);

/* a proxy we can break on purpose */
const conns = new Set();
let hole = false;
const proxy = http.createServer((req, res) => {
  const up = http.request({ host: target.hostname, port: target.port, path: req.url, method: req.method, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  up.on('error', () => res.destroy());
  req.pipe(up);
});
proxy.on('upgrade', (req, client, head) => {
  const up = net.connect(Number(target.port), target.hostname, () => {
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
    if (head.length) up.write(head);
  });
  const pair = { client, up };
  conns.add(pair);
  const fwd = (from, to) => from.on('data', (d) => { if (!hole && !to.destroyed) to.write(d); });
  fwd(client, up);
  fwd(up, client);
  const done = () => { conns.delete(pair); client.destroy(); up.destroy(); };
  client.on('error', done); up.on('error', done);
  client.on('close', done); up.on('close', done);
});
await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
const PROXY = `http://127.0.0.1:${proxy.address().port}`;
const resetAll = () => { for (const { client, up } of [...conns]) { client.destroy(); up.destroy(); } };

/* bots */
class Bot {
  constructor(name) { this.name = name; this.seq = 0; this.waiters = new Map(); }
  async open() {
    this.ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws');
    this.ws.on('message', (d) => {
      const m = JSON.parse(d);
      if (m.t === 'state') this.state = m;
      if (m.t === 'joined') this.joined = m;
      const w = this.waiters.get(m.id);
      if (w) { this.waiters.delete(m.id); w(m); }
    });
    await new Promise((r) => this.ws.once('open', r));
  }
  req(msg) {
    const id = ++this.seq;
    this.ws.send(JSON.stringify({ ...msg, id }));
    return new Promise((r) => this.waiters.set(id, r));
  }
}
const host = new Bot('Ana');
await host.open();
await host.req({ t: 'create', gameId: 'mlt', variant: 'standard', name: 'Ana', avatar: '🦊', options: { rounds: 20 } });
const code = host.joined.code;
const bots = [host];
for (const [i, name] of ['Ben', 'Cy', 'Dee'].entries()) {
  const b = new Bot(name);
  await b.open();
  await b.req({ t: 'join', code, name, avatar: ['🐻', '🐼', '🦁'][i] });
  bots.push(b);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
await ctx.addInitScript(() => {
  localStorage.setItem('games.howto.mlt', '1');
  // Sample the layout every frame: where is the play surface, how tall is the status bar.
  window.__layout = [];
  addEventListener('DOMContentLoaded', () => {
    const tick = () => {
      const main = document.querySelector('#rm-main');
      const net = document.querySelector('#net');
      if (main) window.__layout.push({ top: Math.round(main.getBoundingClientRect().top), net: net && !net.hidden && getComputedStyle(net).display !== 'none' ? net.textContent.trim() : '' });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
});
const phone = await ctx.newPage();
const errors = [];
phone.on('pageerror', (e) => errors.push(e.message));
await phone.goto(`${PROXY}/r/${code}`);
await phone.locator('#join-name').fill('Zed');
await phone.locator('#join-go').click();
await phone.locator('.lobby').waitFor();
await host.req({ t: 'host', op: 'start' });
await phone.locator('.pick[data-act="vote"]').first().waitFor();
await sleep(1200);

const failures = [];
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what); };
const layout = () => phone.evaluate(() => { const l = window.__layout; window.__layout = []; return l; });
const mark = () => phone.evaluate(() => { document.querySelector('#rm-main > *').__mark = 'same'; });
const stillMarked = () => phone.evaluate(() => document.querySelector('#rm-main > *')?.__mark === 'same');
const zedId = () => phone.evaluate(() => JSON.parse(localStorage.getItem('games.rooms'))[location.pathname.split('/').pop()].playerId);
const hostSeesVote = async (id) => { await sleep(300); return (host.state.view.voted || []).includes(id); };
const roundOf = () => host.state.view.round;

/* 1. a blip: connections reset, back in under a second */
console.log('blip (reset, instant return)');
await mark();
await layout();
resetAll();
await sleep(2500);
let l = await layout();
check(await stillMarked(), 'the screen was not rebuilt');
check(new Set(l.map((x) => x.top)).size === 1, `the play surface never moved (tops seen: ${[...new Set(l.map((x) => x.top))].join(', ')})`);
check(l.every((x) => !x.net), 'no status bar flashed for a sub-second blip');

/* 2. a tap during a black-hole outage */
console.log('outage (black hole 30s, a tap in the middle)');
hole = true;
await sleep(500);
const zed = await zedId();
await phone.locator('.pick[data-act="vote"]').first().tap(); // goes into the void
await sleep(100);
check(await phone.locator('.pick[data-act="vote"]').first().isEnabled(), 'taps are never blocked while the connection is down');
// Long enough for the heartbeat to notice, and for the retries to hang on the hole.
await sleep(29_000);
hole = false;
resetAll(); // the stalled sockets finally die; the new ones go through
let seen = '';
const t0 = Date.now();
for (; Date.now() - t0 < 45_000;) {
  if (await hostSeesVote(zed)) { seen = 'yes'; break; }
  await sleep(500);
}
check(seen === 'yes', `the tap made during the outage reached the room (${((Date.now() - t0) / 1000).toFixed(1)}s after the network came back)`);
await sleep(1500);
check((await phone.locator('.pick.on').count()) === 1, 'the phone shows the vote as in');
l = await layout();
check(new Set(l.map((x) => x.top)).size === 1, `the play surface never moved during the outage (tops: ${[...new Set(l.map((x) => x.top))].join(', ')})`);
const shown = l.filter((x) => x.net);
check(shown.length > 0, 'a long outage does show a small status');
check(!(await phone.evaluate(() => { const n = document.querySelector('#net'); return n && !n.hidden; })), 'and it clears once back');

/* 3. nothing double-counted */
// Finish the round with the others; a doubled Zed vote would show as a wrong tally.
for (const b of bots) if (b.state.view.me !== undefined) await b.req({ t: 'act', type: 'vote', payload: b.state.view.players.find((id) => id !== b.state.view.me) });
await phone.locator('.mlt-result').waitFor({ timeout: 10_000 });
const votes = await phone.locator('.mlt-votes li').count();
check(votes === 5, `each of the 5 players has exactly one vote on the result (saw ${votes})`);
check(errors.length === 0, `no page errors${errors.length ? `: ${errors[0]}` : ''}`);

await browser.close();
for (const b of bots) b.ws.close();
proxy.close();
if (failures.length) { console.error(`\nFAIL: ${failures.length} check(s)`); process.exit(1); }
console.log('\nPASS');
process.exit(0);
