// Answer-to-paint benchmark for a live room, on a CPU-throttled phone.
//
//   node e2e/stutter.mjs [--base=http://127.0.0.1:8979] [--bots=5] [--throttle=4] [--tier=standard] [--rounds=3]
//
// One real Chromium phone (390x844, CPU throttled) and one real /tv page sit in
// a Most Likely To room with N websocket bots. Each round the bots vote one by
// one, then the phone votes. For every `state` message the phone receives we
// time: message arrives -> DOM updated -> next frame painted, and watch for
// long tasks, dropped frames and CSS animations a render (re)started.
// Prints a JSON summary; BEFORE/AFTER numbers in the PR come from this.
// With --assert it exits 1 unless an answer is a non-event on screen:
//   - no entry animation replays (the screen never blinks to transparent)
//   - at most one thing animates per answer (the new thing), not the whole screen
//   - a press that straddles someone else's answer still registers
import { chromium } from 'playwright-core';
import WebSocket from 'ws';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] ?? d;
const BASE = arg('base', 'http://127.0.0.1:8979');
const BOTS = Number(arg('bots', 5));
const THROTTLE = Number(arg('throttle', 4));
const TIER = arg('tier', 'standard');
const ROUNDS = Number(arg('rounds', 3));
const ASSERT = process.argv.includes('--assert');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Bot {
  constructor(name) { this.name = name; this.inbox = []; this.seq = 0; this.waiters = new Map(); }
  async open() {
    this.ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws');
    this.ws.on('message', (d) => {
      const m = JSON.parse(d);
      if (m.t === 'state') this.state = m;
      if (m.t === 'joined') { this.joined = m; }
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

const bots = [];
const host = new Bot('Ana');
await host.open();
bots.push(host);
const created = await host.req({ t: 'create', gameId: 'mlt', variant: TIER, name: 'Ana', avatar: '🦊', options: { rounds: 20 } });
if (created.t === 'error') throw new Error(created.message);
const code = host.joined.code;
for (let i = 1; i < BOTS; i++) {
  const b = new Bot(['Ben', 'Cy', 'Dee', 'Eve', 'Fay', 'Gus', 'Hal'][i - 1]);
  await b.open();
  const r = await b.req({ t: 'join', code, name: b.name, avatar: ['🐻', '🐼', '🦁', '🐸', '🐙', '🦄', '🐢'][i - 1] });
  if (r.t === 'error') throw new Error(r.message);
  bots.push(b);
}

const browser = await chromium.launch();
const mk = async (opts) => {
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript(() => {
    localStorage.setItem('games.18ok', '1');
    localStorage.setItem('games.deadlyok', '1');
    localStorage.setItem('games.howto.mlt', '1');
    const M = (window.__m = { recv: [], paints: [], long: [], frames: [], anims: 0, names: {}, seen: new WeakSet(), errors: [] });
    const NativeWS = window.WebSocket;
    window.WebSocket = class extends NativeWS {
      constructor(...a) {
        super(...a);
        this.addEventListener('message', (e) => {
          if (typeof e.data === 'string' && /^\{"t":"(state|tv)"/.test(e.data)) M.recv.push({ at: performance.now(), n: e.data.length });
        });
      }
    };
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) M.long.push({ at: e.startTime, d: e.duration }); }).observe({ entryTypes: ['longtask'] });
    } catch { /* no longtask */ }
    // Next paint after every DOM change inside the game surface.
    addEventListener('DOMContentLoaded', () => {
      let last = performance.now();
      const tick = (t) => { M.frames.push({ at: t, gap: t - last }); last = t; requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      new MutationObserver((list) => {
        // The 200ms countdown ticker is not an answer: skip it.
        if (list.every((m) => (m.target.nodeType === 3 ? m.target.parentElement : m.target).closest?.('.cd, .cd-ring'))) return;
        const dom = performance.now();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          // How much finite animation is still to run, and how see-through the
          // screen is right now: a re-render that replays its entry animation
          // blinks the whole screen back to transparent.
          // Transitions (a tapped button filling in) are motion we want; it is
          // CSS *animations* replaying on content that did not change we count.
          const fin = document.getAnimations().filter((x) => x instanceof CSSAnimation && x.effect.getComputedTiming().iterations !== Infinity && x.playState === 'running');
          const settle = fin.reduce((mx, x) => Math.max(mx, x.effect.getComputedTiming().endTime - x.currentTime), 0);
          const stage = document.querySelector('#rm-main > *, #tv-surface > *');
          const opacity = stage ? Number(getComputedStyle(stage).opacity) : 1;
          M.paints.push({ dom, paint: performance.now(), settle, opacity });
          // Animations (re)started by this render: new nodes replay theirs.
          for (const a of document.getAnimations().filter((x) => x instanceof CSSAnimation && x.playState === 'running' && !M.seen.has(x))) {
            M.seen.add(a);
            M.anims++;
            const k = a.animationName;
            M.names[k] = (M.names[k] || 0) + 1;
          }
        }));
      }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    });
  });
  return ctx;
};
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
const phoneCtx = await mk(PHONE);
const phone = await phoneCtx.newPage();
phone.on('pageerror', (e) => console.error('pageerror', e.message));
const tvCtx = await mk({ viewport: { width: 1440, height: 900 } });
const tv = await tvCtx.newPage();
await tv.goto(`${BASE}/tv/${code}`);
await tv.locator('.tv-lobby').waitFor();

await phone.goto(`${BASE}/r/${code}`);
await phone.locator('#join-name').fill('Zed');
await phone.locator('#join-go').click();
await phone.locator('.lobby').waitFor();
await host.req({ t: 'host', op: 'start' });
await phone.locator('.pick[data-act="vote"]').first().waitFor();
await sleep(1500);

const cdp = await phoneCtx.newCDPSession(phone);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
const resetIn = () => { const M = window.__m; M.recv.length = M.paints.length = M.long.length = M.frames.length = 0; M.anims = 0; M.names = {}; };
const reset = () => Promise.all([phone.evaluate(resetIn), tv.evaluate(resetIn)]);

const rows = [];
const tvRows = [];
const botVoteOn = async (b) => {
  const s = b.state;
  const target = s.view.players.find((id) => id !== s.view.me);
  await b.req({ t: 'act', type: 'vote', payload: target });
};
for (let round = 0; round < ROUNDS; round++) {
  await phone.locator('.pick[data-act="vote"]').first().waitFor();
  await sleep(1200);
  await reset();
  // Others answer, one at a time, like people on their own phones.
  for (const b of bots.slice(0, -1)) { await botVoteOn(b); await sleep(900); }
  const tapAt = await phone.evaluate(() => performance.now());
  await phone.locator('.pick[data-act="vote"]').first().tap();
  await sleep(1200);
  const m = await phone.evaluate(() => JSON.parse(JSON.stringify(window.__m)));
  rows.push(m);
  tvRows.push(await tv.evaluate(() => JSON.parse(JSON.stringify(window.__m))));
  // Last bot closes the round; host moves to the next prompt.
  await botVoteOn(bots[bots.length - 1]).catch(() => {});
  await phone.locator('.mlt-result').waitFor({ timeout: 8000 }).catch(() => {});
  await sleep(600);
  await host.req({ t: 'act', type: 'next', payload: null });
  await sleep(300);
}

// A finger is down on a vote button when another player's answer arrives. The
// press must still count as a tap on that button.
await phone.locator('.pick[data-act="vote"]').first().waitFor();
await sleep(1200);
const pick = await phone.locator('.pick[data-act="vote"]').first().boundingBox();
const touch = (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: pick.x + pick.width / 2, y: pick.y + pick.height / 2 }] });
await touch('touchStart');
await botVoteOn(bots[1]);
await sleep(250);
await touch('touchEnd');
await sleep(700);
const straddleOk = (await phone.locator('.pick.on').count()) === 1;

const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1); };
// Pair each state message with the first DOM change after it.
const all = rows.flatMap((m) => m.recv.map((r) => {
  const p = m.paints.find((x) => x.dom >= r.at);
  return p ? { recvAt: r.at, dom: p.dom, paint: p.paint, settle: p.settle, opacity: p.opacity } : null;
}).filter(Boolean));
const toDom = all.map((p) => p.dom - p.recvAt);
const toPaint = all.map((p) => p.paint - p.recvAt);
const long = rows.flatMap((m) => m.long);
const gaps = rows.flatMap((m) => m.frames.map((f) => f.gap));
const summary = {
  base: BASE, bots: BOTS, throttle: THROTTLE, tier: TIER, rounds: ROUNDS,
  stateMsgs: rows.reduce((n, m) => n + m.recv.length, 0),
  stateBytesMax: Math.max(...rows.flatMap((m) => m.recv.map((r) => r.n))),
  recvToDomMs: { p50: pct(toDom, 0.5), p95: pct(toDom, 0.95), max: pct(toDom, 1) },
  recvToPaintMs: { p50: pct(toPaint, 0.5), p95: pct(toPaint, 0.95), max: pct(toPaint, 1) },
  longTasks: { count: long.length, totalMs: +long.reduce((n, l) => n + l.d, 0).toFixed(0), maxMs: long.length ? +Math.max(...long.map((l) => l.d)).toFixed(0) : 0 },
  frameGapsOver50ms: gaps.filter((g) => g > 50).length,
  frameGapMaxMs: gaps.length ? +Math.max(...gaps).toFixed(0) : 0,
  blinkMinOpacity: +Math.min(...all.map((p) => p.opacity)).toFixed(2),
  settleMs: { p50: pct(all.map((p) => p.settle), 0.5), max: pct(all.map((p) => p.settle), 1) },
  straddledPressRegistered: straddleOk,
  animationNames: rows.reduce((o, m) => { for (const [k, v] of Object.entries(m.names)) o[k] = (o[k] || 0) + v; return o; }, {}),
  animationsRestartedPerState: +(rows.reduce((n, m) => n + m.anims, 0) / Math.max(1, all.length)).toFixed(1),
};
const tvPaints = tvRows.flatMap((m) => m.paints);
summary.tv = {
  stateMsgs: tvRows.reduce((n, m) => n + m.recv.length, 0),
  blinkMinOpacity: +Math.min(...tvPaints.map((p) => p.opacity), 1).toFixed(2),
  settleMsMax: Math.max(0, ...tvPaints.map((p) => p.settle)),
  animationNames: tvRows.reduce((o, m) => { for (const [k, v] of Object.entries(m.names)) o[k] = (o[k] || 0) + v; return o; }, {}),
  animsRestartedPerState: +(tvRows.reduce((n, m) => n + m.anims, 0) / Math.max(1, tvRows.reduce((n, m) => n + m.recv.length, 0))).toFixed(1),
};
console.log(JSON.stringify(summary, null, 2));
await browser.close();
for (const b of bots) b.ws.close();
if (ASSERT) {
  const bad = [];
  if (summary.blinkMinOpacity < 0.99) bad.push(`the screen blinked to ${summary.blinkMinOpacity} opacity on an answer`);
  if (summary.animationNames['phase-in']) bad.push(`entry animation replayed ${summary.animationNames['phase-in']}x within a phase`);
  if (summary.animationsRestartedPerState > 1.5) bad.push(`${summary.animationsRestartedPerState} animations restart per answer (only something new should animate)`);
  if (summary.tv.animationNames['phase-in']) bad.push(`TV: entry animation replayed ${summary.tv.animationNames['phase-in']}x within a phase`);
  if (summary.tv.blinkMinOpacity < 0.99) bad.push(`TV: the screen blinked to ${summary.tv.blinkMinOpacity} opacity on an answer`);
  if (summary.tv.animsRestartedPerState > 1.5) bad.push(`TV: ${summary.tv.animsRestartedPerState} animations restart per answer (only the new answer should animate)`);
  if (!straddleOk) bad.push('a press that straddled another answer was lost');
  if (bad.length) { console.error(`FAIL\n  ${bad.join('\n  ')}`); process.exit(1); }
  console.log('PASS');
}
process.exit(0);
