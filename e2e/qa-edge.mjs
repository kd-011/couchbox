// Edge cases for every game, in real Chromium against a local server started
// with GAMES_TEST_HOOKS=1:
//   offline    one phone with the network cut after the first visit, a
//              curated pack picked from the cached bundle, played to game over
//   late       a fifth phone joins mid-game: it gets a real screen, no errors
//   refresh    a guest reloads mid-game and gets the same screen back
//   host-left  the host leaves mid-game: someone else gets the host bar at
//              once and the game still plays to game over
//   squeeze    20-character names at 320x568, reduced motion on, the TV at
//              2560x1440: nothing off screen, no animation left running
//
//   node e2e/qa-edge.mjs [baseUrl] [--games=a,b] [--only=offline,late,...]
// Screenshots: $E2E_OUT (default /tmp/games-e2e)/edge-*.png
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { newPage, startScreen, openRoom, hook, lcg, layoutProblems, passRun, acceptAge } from './matrix-browser.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const flag = (k, d = '') => (argv.find((a) => a.startsWith(`--${k}=`)) || `--${k}=${d}`).split('=').slice(1).join('=');
const BASE = (argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8979').replace(/\/+$/, '');
const OUT = process.env.E2E_OUT || '/tmp/games-e2e';
mkdirSync(OUT, { recursive: true });
const { loadGames } = await import(pathToFileURL(join(ROOT, 'lib/registry.mjs')).href);
const rt = await import(pathToFileURL(join(ROOT, 'games/_kit/runtime.js')).href);
const { Tracker, botMoves } = await import('./matrix-lib.mjs');
const games = await loadGames(join(ROOT, 'games'), { strict: true });
const ONLY = flag('games').split(',').filter(Boolean);
const IDS = [...games.keys()].filter((id) => !ONLY.length || ONLY.includes(id));
const CHECKS = flag('only', 'offline,late,refresh,host-left,squeeze').split(',');
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true };
const TINY = { viewport: { width: 320, height: 568 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, reducedMotion: 'reduce' };
const BIG_TV = { viewport: { width: 2560, height: 1440 }, reducedMotion: 'reduce' };
const BAD_TEXT = /\bundefined\b|\[object Object\]|\bNaN\b|\bnull\b|This screen hit a bug/;
const log = (...a) => console.log(...a);
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function record(game, check, ok, detail = '') {
  results.push({ game, check, ok, detail });
  log(`${ok ? 'PASS' : 'FAIL'}  ${game.padEnd(11)} ${check.padEnd(10)} ${detail}`);
}

const browser = await chromium.launch();

async function waitState(code) {
  let s = await hook(BASE, code);
  for (let i = 0; i < 100 && !s.state; i++) { await sleep(80); s = await hook(BASE, code); }
  return s;
}

// Bot moves through the hook: `n` of them, or until game over when n = Infinity.
async function botPlay(code, g, n, content) {
  const rand = lcg(code.charCodeAt(1) * 7);
  for (let i = 0; i < Math.min(n, 2000); i++) {
    const snap = await hook(BASE, code);
    if (!snap.state || snap.state.$over) return snap;
    const players = snap.players.map((p) => ({ ...p, color: '#fff' }));
    const ctx = { players, content, rng: rand, now: Date.now() };
    const seats = [null, ...snap.inGame.filter((id) => snap.players.some((p) => p.id === id))];
    const moves = botMoves(g.engine, snap.state, seats, ctx);
    const d = rt.deadlineOf(g.engine, snap.state);
    if (!moves.length || (d && rand() < 0.1)) {
      if (!d) throw new Error(`stuck in ${snap.state.phase}`);
      await hook(BASE, code, '/deadline', {});
      continue;
    }
    const m = moves[Math.floor(rand() * moves.length)];
    const r = await hook(BASE, code, '/act', { playerId: m.who, type: m.a.type, payload: m.a.payload ?? null });
    if (r.error) throw new Error(`bot move ${m.a.type} rejected in ${snap.state.phase}: ${r.error}`);
  }
  return hook(BASE, code);
}

const text = (p, sels) => p.evaluate((sels) => sels.map((s) => (document.querySelector(s) || {}).innerText || '').join('\n'), sels);

for (const id of IDS) {
  const g = games.get(id);
  const m = g.engine.meta;
  const packs = [...(g.curated ? g.curated.values() : [])].sort((a, b) => a.count - b.count);
  const roomOk = (m.modes || ['pass', 'room']).includes('room');

  if (CHECKS.includes('offline') && (m.modes || ['pass', 'room']).includes('pass')) {
    try {
      const out = await passRun(browser, { BASE, OUT, Tracker, botMoves, rt }, { g, tier: 'drinking', pack: packs[0] || null, offline: true });
      record(id, 'offline', !out.problems.length, out.problems.length ? out.problems.join(' | ') : `${packs[0] ? packs[0].id : 'built-in'}, ${out.steps} steps with the network off`);
    } catch (err) { record(id, 'offline', false, err.message.split('\n')[0]); }
  }

  if (!roomOk) continue;
  if (CHECKS.some((c) => ['late', 'refresh', 'host-left'].includes(c))) {
    const errors = [];
    const n = Math.min(m.maxPlayers - 1, Math.max(m.minPlayers, 4));
    let room;
    try {
      room = await openRoom(browser, { BASE }, g, 'standard', null, n, errors);
      await room.host.locator('#lb-start').click();
      await waitState(room.code);
      await botPlay(room.code, g, 4, g.content);
      const guests = [...room.pages.values()].slice(1);

      if (CHECKS.includes('late')) {
        const late = await newPage(browser, PHONE, 'late', errors);
        await late.goto(`${BASE}/r/${room.code}`);
        await late.locator('#join-name').fill('Latecomer');
        await late.locator('#join-go').click();
        await late.locator('#rm-main > *, .lobby').first().waitFor({ timeout: 8000 });
        await sleep(600);
        const t = await text(late, ['#rm-main', '#rm-now', 'main']);
        await late.screenshot({ path: `${OUT}/edge-${id}-late.png` });
        const bad = BAD_TEXT.exec(t);
        record(id, 'late', !bad && t.trim().length > 3, bad ? `shows "${bad[0]}"` : t.replace(/\s+/g, ' ').trim().slice(0, 70));
        room.pages.set('Latecomer', late);
      }

      if (CHECKS.includes('refresh')) {
        const p = guests[1];
        const strip = (s) => s.replace(/\d/g, '').replace(/\s+/g, ' ').trim();
        await sleep(400);
        const before = strip(await text(p, ['#rm-main']));
        await p.reload();
        await p.locator('#rm-main > *').first().waitFor();
        await sleep(700);
        const after = strip(await text(p, ['#rm-main']));
        record(id, 'refresh', before === after, before === after ? 'same screen back' : `before: ${before.slice(0, 60)} | after: ${after.slice(0, 60)}`);
      }

      if (CHECKS.includes('host-left')) {
        const hostBefore = (await hook(BASE, room.code)).hostId;
        await room.host.locator('#rm-menu').click();
        await room.host.locator('.menu-item[data-value="leave"]').click();
        await room.host.locator('.sheet-wrap.open .sheet-actions [data-i="0"]').click();
        await room.host.waitForURL(`${BASE}/`, { timeout: 5000 });
        let snap = await hook(BASE, room.code);
        const newHost = snap.players.find((p) => p.id === snap.hostId);
        let barOk = false;
        if (newHost && snap.hostId !== hostBefore) {
          const page = room.pages.get(newHost.name);
          barOk = await page.locator('#rm-host .btn, .hostbar .btn').first().waitFor({ timeout: 5000 }).then(() => true, () => false);
          // Some phases have no host buttons (waiting on players): that is fine.
          if (!barOk && snap.state && !rt.hostActionsOf(g.engine, snap.state, { players: snap.players, content: g.content, rng: Math.random, now: Date.now() }).length) barOk = true;
        }
        snap = await botPlay(room.code, g, Infinity, g.content);
        const over = !!(snap.state && snap.state.$over);
        record(id, 'host-left', !!newHost && barOk && over, `${newHost ? `${newHost.name} is host` : 'no new host'}${barOk ? ', has the host bar' : ', NO host bar'}, ${over ? 'played on to game over' : `stuck in ${snap.state && snap.state.phase}`}`);
      }
      const errs = errors.filter((e) => !/Failed to load resource/.test(e));
      if (errs.length) record(id, 'console', false, errs.slice(0, 3).join(' | '));
    } catch (err) {
      record(id, 'room-edge', false, err.message.split('\n')[0]);
    } finally {
      if (room) for (const p of [...room.pages.values(), room.tv]) await p.context().close().catch(() => {});
    }
  }

  if (CHECKS.includes('squeeze')) {
    const errors = [];
    const names = ['Maximiliana Ottoline', 'Bartholomew Cornelius', 'Wolfgang Amadeus Jnr', 'Persephone Wellingtn'];
    const host = await newPage(browser, TINY, 'tiny-host', errors);
    const pages = [host];
    try {
      await startScreen(host, BASE, g, 'standard', null);
      await host.locator('#host-name').fill(names[0]);
      await host.locator('#go-room').click();
      await host.locator('.lobby').waitFor();
      await host.waitForURL(/\/r\/[A-Z]{4}$/);
      const code = host.url().split('/r/')[1];
      const tv = await newPage(browser, BIG_TV, 'tv2560', errors);
      pages.push(tv);
      await tv.goto(`${BASE}/tv/${code}`);
      await tv.locator('.tv-lobby').waitFor();
      const need = Math.max(m.minPlayers, 3);
      for (let i = 1; i < need; i++) {
        const p = await newPage(browser, TINY, `tiny-${i}`, errors);
        pages.push(p);
        await p.goto(`${BASE}/r/${code}`);
        await p.locator('#join-name').fill(names[i]);
        await p.locator('#join-go').click();
        await p.locator('.lobby').waitFor();
        await acceptAge(p);
      }
      await sleep(500);
      const probs = [];
      await host.screenshot({ path: `${OUT}/edge-${id}-tiny-lobby.png` });
      probs.push(...(await layoutProblems(host)).map((x) => `lobby: ${x}`));
      await host.locator('#lb-start').click();
      await waitState(code);
      await botPlay(code, g, 3, g.content);
      await sleep(900);
      const howto = host.locator('.sheet-wrap.open.sheet-howto .sheet-actions [data-i="0"]');
      if (await howto.count()) await howto.click().catch(() => {});
      await sleep(400);
      await host.screenshot({ path: `${OUT}/edge-${id}-tiny-game.png` });
      await tv.screenshot({ path: `${OUT}/edge-${id}-tv2560.png` });
      probs.push(...(await layoutProblems(host)).map((x) => `phone: ${x}`));
      probs.push(...(await layoutProblems(tv, { tv: true })).map((x) => `tv: ${x}`));
      // Reduced motion: nothing animates for longer than a blink.
      const moving = await host.evaluate(() => document.getAnimations().filter((a) => {
        const t = a.effect && a.effect.getComputedTiming();
        return a.playState === 'running' && t && (t.duration > 50 || t.iterations === Infinity);
      }).map((a) => `${a.animationName || a.constructor.name} on ${a.effect.target && a.effect.target.className}`));
      if (moving.length) probs.push(`reduced motion still animates: ${[...new Set(moving)].slice(0, 3).join(', ')}`);
      const errs = errors.filter((e) => !/Failed to load resource/.test(e));
      probs.push(...errs.slice(0, 3));
      record(id, 'squeeze', !probs.length, probs.join(' | ') || '320x568 + long names + reduced motion, TV 2560x1440: clean');
    } catch (err) {
      record(id, 'squeeze', false, err.message.split('\n')[0]);
    } finally {
      for (const p of pages) await p.context().close().catch(() => {});
    }
  }
}

await browser.close();
const bad = results.filter((r) => !r.ok);
log(`\n${results.length} checks, ${results.length - bad.length} passed, ${bad.length} failed`);
process.exit(bad.length ? 1 : 0);
