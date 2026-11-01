// The browser layer of e2e/matrix.mjs: real Chromium, real taps. See the
// header of matrix.mjs. Needs a local server with GAMES_TEST_HOOKS=1 for the
// room runs (lib/testhooks.mjs); pass and play reads the phone's own saved
// game from localStorage, exactly what public/js/pass.js plays.
import { chromium } from 'playwright-core';

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true };
const TV = { viewport: { width: 1440, height: 900 } };
const NAMES = ['Ana', 'Ben', 'Cy', 'Dee', 'Eve', 'Fox'];
const MAX_STEPS = 700;
const BAD_TEXT = /\bundefined\b|\[object Object\]|\bNaN\b|\bnull\b|This screen hit a bug/;

export async function runBrowserLayer(env) {
  const { BASE, games, GAME_IDS, MODES, TIERS, browserPackPlan, log } = env;
  const workers = Math.max(1, Number((process.argv.find((a) => a.startsWith('--workers=')) || '--workers=2').split('=')[1]));
  let browser = await chromium.launch();
  const ensure = async () => { if (!browser.isConnected()) browser = await chromium.launch(); return browser; };

  const jobs = [];
  for (const id of GAME_IDS) {
    const g = games.get(id);
    const plan = [null, ...browserPackPlan(g).filter(Boolean)];
    let k = 0;
    for (const tier of TIERS) {
      for (const mode of (g.engine.meta.modes || ['pass', 'room']).filter((m) => MODES.includes(m))) {
        jobs.push({ g, mode, tier, pack: plan[k++ % plan.length] });
      }
    }
  }
  const nightGames = ['nhie', 'codewords', 'tune-in'].filter((id) => games.has(id));
  const wantNight = nightGames.length === 3 && (GAME_IDS.length >= 3 || process.argv.includes('--night'));

  async function worker() {
    while (jobs.length) {
      const job = jobs.shift();
      const base = { layer: 'browser', game: job.g.id, mode: job.mode, tier: job.tier, pack: job.pack ? job.pack.id : 'built-in', problems: [] };
      const t0 = Date.now();
      try {
        const out = job.mode === 'pass' ? await passRun(await ensure(), env, job) : await roomRun(await ensure(), env, job);
        env.record({ ...base, ok: !out.problems.length, steps: out.steps, problems: out.problems, secs: Math.round((Date.now() - t0) / 1000) });
      } catch (err) {
        env.record({ ...base, ok: false, err: err.message.split('\n').slice(0, 3).join(' | ') });
      }
    }
  }
  await Promise.all(Array.from({ length: workers }, worker));
  if (wantNight) {
    for (const tier of TIERS) {
      const base = { layer: 'browser', game: nightGames.join('+'), mode: 'night', tier, pack: 'built-in', problems: [] };
      try {
        const out = await nightRun(await ensure(), env, nightGames, tier);
        env.record({ ...base, ok: !out.problems.length, steps: out.steps, problems: out.problems });
      } catch (err) {
        env.record({ ...base, ok: false, err: err.message.split('\n').slice(0, 3).join(' | ') });
      }
    }
  }
  await browser.close();
  log('');
}

/* ---------- pages ---------- */

export async function newPage(browser, opts, label, errors) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: uncaught ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label}: console ${m.text().slice(0, 200)}`); });
  await page.addLocatorHandler(page.locator('.moment .mo-done'), async (btn) => {
    await btn.click({ force: true }).catch(() => {});
    await page.locator('.moment').first().waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
  }, { noWaitAfter: true });
  await page.addLocatorHandler(page.locator('.sheet-wrap.open.sheet-howto'), async (w) => {
    await w.locator('.sheet-actions [data-i="0"]').click().catch(() => {});
  }, { noWaitAfter: true });
  await page.addLocatorHandler(page.locator('.sheet-wrap.open.sheet-install'), async (w) => {
    await w.locator('.sheet-actions [data-i="1"]').click().catch(() => {});
  }, { noWaitAfter: true });
  return page;
}

export async function acceptAge(page) {
  const gate = page.locator('.sheet-age .sheet-actions [data-i="0"]');
  if (await gate.count()) {
    await gate.click();
    await page.locator('.sheet-age').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  }
}

// Home -> the game's start screen, tier picked (18+ gate), pack picked in
// the pack browser.
export async function startScreen(page, base, g, tier, pack) {
  await page.goto(`${base}/`);
  await page.locator(`a.deck[href="/#/new/${g.id}"]`).click();
  await page.locator('#tier-standard').waitFor();
  if (tier !== 'standard') {
    await page.locator(`#tier-${tier}`).click();
    await page.locator('.sheet-age').waitFor();
    await acceptAge(page);
    await page.locator(`#tier-${tier}[aria-checked="true"]`).waitFor();
  }
  if (pack) {
    await page.locator('#pack-btn').click();
    await page.locator('.sheet-wrap.open.sheet-pack').waitFor();
    await page.locator(`.pk-card[data-pick="${pack.code}"]`).click();
    await page.locator('.sheet-wrap').waitFor({ state: 'detached' });
    const row = await page.locator('#pack-btn').innerText();
    if (!row.includes(pack.title)) throw new Error(`start screen shows "${row.replace(/\s+/g, ' ')}" after picking ${pack.title}`);
  }
}

/* ---------- making a bot's move with a real tap ---------- */

// Mark the element that makes `move` on this page and return how to use it:
// 'host:<i>' (host bar button i), 'btn' (a data-act button), 'form' (filled
// in, ready to submit) or null when nothing on screen makes that move.
export async function findTarget(page, surfaceSel, hostSel, move, hostIndex) {
  return page.evaluate(({ surfaceSel, hostSel, move, hostIndex }) => {
    document.querySelectorAll('[data-qa]').forEach((n) => n.removeAttribute('data-qa'));
    const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
    if (hostIndex >= 0) {
      const b = document.querySelector(`${hostSel} [data-i="${hostIndex}"]`);
      if (b) { b.setAttribute('data-qa', '1'); return 'host'; }
    }
    const root = document.querySelector(surfaceSel);
    if (!root) return null;
    const visible = (n) => !!(n.offsetWidth || n.offsetHeight || n.getClientRects().length) && !n.disabled;
    const { type, payload } = move;
    let locked = false;
    const alts = [];
    for (const n of root.querySelectorAll(`[data-act="${CSS.escape(type)}"]`)) {
      if (n.tagName === 'FORM') continue;
      if (n.disabled || !visible(n)) { locked = true; continue; }
      let p = null;
      if (n.dataset.payload !== undefined) { try { p = JSON.parse(n.dataset.payload); } catch { p = null; } }
      else if (n.dataset.arg !== undefined) p = n.dataset.arg;
      const match = same(p, payload) || (p !== null && payload !== null && typeof payload !== 'object' && String(p) === String(payload));
      if (match) { n.setAttribute('data-qa', '1'); return 'btn'; }
      alts.push(n);
    }
    if (payload && typeof payload === 'object') {
      for (const f of root.querySelectorAll(`form[data-act="${CSS.escape(type)}"]`)) {
        const fields = Object.keys(payload);
        if (!fields.every((k) => f.elements.namedItem(k))) continue;
        for (const k of fields) {
          const el = f.elements.namedItem(k);
          const v = payload[k];
          if (el instanceof RadioNodeList) { for (const r of el) r.checked = String(r.value) === String(v); continue; }
          el.value = String(v ?? '');
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const submit = f.querySelector('[type=submit]') || f.querySelector('button');
        if (submit && visible(submit)) { submit.setAttribute('data-qa', '1'); return 'form'; }
      }
    }
    // A slider move ({ value: 0-100 }): drag the slider there.
    if (payload && typeof payload === 'object' && typeof payload.value === 'number') {
      const sl = [...root.querySelectorAll('[role="slider"]')].find(visible);
      if (sl) { sl.setAttribute('data-qa', '1'); return 'slide'; }
    }
    // Drawing moves: the canvas itself.
    if (/stroke|points/i.test(type)) {
      const c = root.querySelector('canvas');
      if (c && visible(c)) { c.setAttribute('data-qa', '1'); return 'draw'; }
    }
    // The bot picked a value the screen offers as presets (a wager of 37
    // when the chips say 25 and 50): tap one of the offered ones instead.
    if (alts.length && payload !== null) { alts[Math.floor(Math.random() * alts.length)].setAttribute('data-qa', '1'); return 'btn'; }
    // A button that unlocks after a first look (Imposter's card flip) or
    // opens behind another (Spyfall's "I know it").
    const unlock = locked && [...root.querySelectorAll('[data-flip], [data-guess-open], [aria-expanded="false"]')].find(visible);
    if (unlock) { unlock.setAttribute('data-qa', '1'); return 'unlock'; }
    return null;
  }, { surfaceSel, hostSel, move, hostIndex });
}

export async function tapTarget(page) {
  await page.locator('[data-qa="1"]').first().click({ timeout: 4000 });
  // A data-confirm or a confirm-able host action asks first.
  const ok = page.locator('.sheet-wrap.open .sheet-actions [data-i="0"]');
  if (await ok.first().waitFor({ timeout: 700 }).then(() => true, () => false)) await ok.first().click({ timeout: 3000 }).catch(() => {});
}

// Raw mouse gestures skip the locator handlers that tap away the how-to
// sheet and Deadly takeovers, so clear those by hand first.
async function clearOverlays(page) {
  for (const sel of ['.sheet-wrap.open.sheet-howto .sheet-actions [data-i="0"]', '.sheet-wrap.open.sheet-install .sheet-actions [data-i="1"]', '.moment .mo-done']) {
    const b = page.locator(sel).first();
    if (await b.count()) {
      await b.click({ force: true, timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(350);
    }
  }
}

// The box of the marked element once it has stopped moving (screens slide
// in on a new phase; a drag measured mid-animation lands off target).
async function settledBox(page) {
  const el = page.locator('[data-qa="1"]').first();
  let prev = null;
  for (let i = 0; i < 12; i++) {
    const box = await el.boundingBox();
    if (box && prev && Math.abs(box.x - prev.x) < 0.5 && Math.abs(box.y - prev.y) < 0.5) return box;
    prev = box;
    await page.waitForTimeout(80);
  }
  return prev;
}

// Find the move on screen, unlocking it first if it needs a look; tap it.
async function makeMove(page, surfaceSel, hostSel, move, hostIndex) {
  let how = await findTarget(page, surfaceSel, hostSel, move, hostIndex);
  if (how === 'unlock') {
    await page.locator('[data-qa="1"]').first().click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(250);
    how = await findTarget(page, surfaceSel, hostSel, move, hostIndex);
    if (how === 'unlock') how = null;
  }
  if (how === 'slide' || how === 'draw') await clearOverlays(page);
  if (how === 'slide') {
    // Drag to the value; if the dial did not take it (a re-render landed
    // mid-gesture), find it again and retry, as a person would.
    const target = Math.max(0, Math.min(100, move.payload.value));
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await findTarget(page, surfaceSel, hostSel, move, hostIndex); // the screen may have been rebuilt
      const box = await settledBox(page);
      if (!box) break;
      const x = box.x + (box.width * target) / 100;
      await page.mouse.move(x, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(x + 1, box.y + box.height / 2);
      await page.mouse.up();
      await page.waitForTimeout(300);
      const now = await page.locator('[data-qa="1"]').first().getAttribute('aria-valuenow').catch(() => null);
      if (now === null || Math.abs(Number(now) - target) <= 2) break;
      await clearOverlays(page);
    }
    return how;
  }
  if (how === 'draw') {
    // One stroke across the canvas: pointer down, a few moves, up.
    const box = await settledBox(page);
    if (box) {
      await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
      await page.mouse.down();
      for (let i = 1; i <= 6; i++) await page.mouse.move(box.x + box.width * (0.2 + i * 0.1), box.y + box.height * (0.3 + i * 0.06), { steps: 2 });
      await page.mouse.up();
    }
    return how;
  }
  if (how) await tapTarget(page).catch(() => {});
  return how;
}

export function hostIndexOf(rt, engine, state, ctx, move) {
  if (move.who !== null) return -1;
  const list = rt.hostActionsOf(engine, state, ctx);
  return list.findIndex((a) => a.type === move.a.type && JSON.stringify(a.payload ?? null) === JSON.stringify(move.a.payload ?? null));
}

async function screenText(page, sels) {
  return page.evaluate((sels) => sels.map((s) => (document.querySelector(s) || {}).innerText || '').join('\n'), sels);
}

function checkText(tracker, text, where) {
  const m = BAD_TEXT.exec(text);
  if (m) tracker.problem(`${where} shows "${m[0]}": ...${text.slice(Math.max(0, m.index - 70), m.index + 30).replace(/\s+/g, ' ')}...`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A small integer LCG: the bots' dice for the browser runs.
export function lcg(seed) {
  let s = (seed >>> 0) % 233280;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

/* ---------- one phone ---------- */

export async function passRun(browser, env, { g, tier, pack, offline = false }) {
  const { BASE, Tracker, botMoves, rt } = env;
  const errors = [];
  const page = await newPage(browser, PHONE, 'phone', errors);
  const tracker = new Tracker(g.id, pack ? pack.merged : g.content);
  const noUi = new Set();
  try {
    await page.clock.install();
    if (offline) {
      // Load once online so the service worker precaches everything (this
      // game's files and its curated pack bundle), then cut the network.
      await page.goto(`${BASE}/`);
      await page.evaluate(async () => { await navigator.serviceWorker.ready; });
      await page.waitForFunction(async (id) => !!(await caches.match(`/games/${id}/engine.js`)), g.id, { timeout: 30_000 });
      if (g.curated && g.curated.size) await page.waitForFunction(async (id) => !!(await caches.match(`/games/${id}/packs.json`)), g.id, { timeout: 30_000 });
      await page.context().setOffline(true);
    }
    await startScreen(page, BASE, g, tier, pack);
    await page.locator('#go-pass').click();
    await page.locator('#pass-form').waitFor();
    const m = g.engine.meta;
    const n = Math.min(m.maxPlayers, Math.max(m.minPlayers, 4));
    while (await page.locator('#names input').count() < n) await page.locator('#add').click();
    const inputs = page.locator('#names input');
    for (let i = 0; i < n; i++) await inputs.nth(i).fill(NAMES[i]);
    await page.locator('#start').click();
    await page.locator('#pp-main').waitFor();

    const read = () => page.evaluate(() => localStorage.getItem('games.pass'));
    let raw = await read();
    const saved0 = JSON.parse(raw);
    if (pack && saved0.packCode !== pack.code) throw new Error(`saved game plays ${saved0.packCode}, not ${pack.code}`);
    const content = saved0.content || g.content;
    let step = 0;
    const rand = lcg(7);
    for (; step < MAX_STEPS; step++) {
      const saved = JSON.parse(raw);
      const state = saved.state;
      tracker.state(state);
      await page.waitForTimeout(60);
      checkText(tracker, await screenText(page, ['#pp-main', '#pp-now', '#pp-host', '#pp-title']), 'phone');
      if (state.$over) break;
      const players = saved.players;
      const ctx = { players, content, rng: rand, now: Date.now() };
      const turn = rt.passTurnOf(g.engine, state, ctx);
      if (turn && saved.privateFor !== turn) {
        await page.locator('#gate-go').click({ timeout: 5000 });
        raw = await waitChange(read, raw);
        continue;
      }
      const moves = botMoves(g.engine, state, [turn], ctx);
      const d = rt.deadlineOf(g.engine, state);
      if (!moves.length || (d && rand() < 0.1)) {
        if (!d) throw new Error(`stuck in phase ${state.phase}: no move and no timer`);
        // The runner's own setTimeout fires when the phone's clock gets there.
        await page.clock.fastForward(Math.max(0, d.at - (await page.evaluate(() => Date.now()))) + 200);
        raw = await waitChange(read, raw, 4000);
        continue;
      }
      const move = moves[Math.floor(rand() * moves.length)];
      const how = await makeMove(page, '#pp-main', '#pp-host', move.a, hostIndexOf(rt, g.engine, state, ctx, move));
      let next = raw;
      if (how) next = await waitChange(read, raw, 2500);
      if (next === raw) {
        // No button makes this move (or the tap did nothing): make it the way
        // the runner would and reload, so the run carries on, and report it.
        noUi.add(`${move.a.type}${how ? ' (tap had no effect)' : ''} in ${state.phase}`);
        const r = rt.applyAction(g.engine, state, { type: move.a.type, payload: move.a.payload ?? null, from: move.who, host: move.who === null }, ctx);
        if (r.error) throw new Error(`bot move ${move.a.type} rejected in ${state.phase}: ${r.error}`);
        await page.evaluate((s) => localStorage.setItem('games.pass', s), JSON.stringify({ ...saved, state: r.state, privateFor: saved.privateFor }));
        await page.reload();
        await page.locator('#pp-main').waitFor();
        next = await read();
      }
      raw = next;
    }
    const final = JSON.parse(raw);
    if (!final.state.$over) throw new Error(`no game over after ${step} steps (phase ${final.state.phase})`);
    // Game over: the host bar leads with Standings, and it works.
    await page.locator('#pp-host .btn', { hasText: 'Standings' }).click({ timeout: 5000 });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('games.pass')).stage === 'between', null, { timeout: 5000 });
    checkText(tracker, await screenText(page, ['#pp-main']), 'standings');
    await page.screenshot({ path: `${env.OUT}/matrix-${g.id}-pass-${tier}.png` }).catch(() => {});
    for (const u of noUi) tracker.problem(`no UI path: ${u}`);
    for (const e of errors) tracker.problem(e);
    return { steps: step, problems: tracker.problems };
  } finally {
    await page.context().close().catch(() => {});
  }
}

async function waitChange(read, before, ms = 2500) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const now = await read();
    if (now !== before) return now;
    await sleep(40);
  }
  return before;
}

/* ---------- own phones ---------- */

export async function hook(base, code, sub = '', body = null) {
  const r = await fetch(`${base}/__test/room/${code}${sub}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json();
  if (r.status === 404 && j.error === 'no room') throw new Error('room vanished');
  if (!body && !r.ok) throw new Error(`test hook ${r.status}: ${j.error}. Start the server with GAMES_TEST_HOOKS=1`);
  return j;
}

export async function openRoom(browser, env, g, tier, pack, n, errors) {
  const { BASE } = env;
  const host = await newPage(browser, PHONE, NAMES[0], errors);
  await startScreen(host, BASE, g, tier, pack);
  const nameInput = host.locator('#host-name');
  if (await nameInput.isVisible().catch(() => false)) await nameInput.fill(NAMES[0]);
  await host.locator('#go-room').click();
  await host.locator('.lobby').waitFor();
  await host.waitForURL(/\/r\/[A-Z]{4}$/);
  const code = host.url().split('/r/')[1];
  const tv = await newPage(browser, TV, 'tv', errors);
  await tv.goto(`${BASE}/tv/${code}`);
  await tv.locator('.tv-lobby').waitFor();
  const pages = new Map([[NAMES[0], host]]);
  for (let i = 1; i < n; i++) {
    const p = await newPage(browser, PHONE, NAMES[i], errors);
    await p.goto(`${BASE}/r/${code}`);
    await p.locator('#join-name').fill(NAMES[i]);
    await p.locator('#join-go').click();
    await p.locator('.lobby').waitFor();
    if (tier !== 'standard') { await p.locator('.sheet-age').waitFor(); await acceptAge(p); }
    pages.set(NAMES[i], p);
  }
  return { host, tv, pages, code };
}

// Play the room's running game to game over with real taps.
async function playRoom(env, room, g, content, tracker) {
  const { BASE, botMoves, rt } = env;
  const { host, tv, pages, code } = room;
  const noUi = new Set();
  let snap = await hook(BASE, code);
  // The Start tap travels over the socket: wait for the game to exist.
  for (let i = 0; i < 100 && !snap.state; i++) { await sleep(80); snap = await hook(BASE, code); }
  let step = 0;
  const rand = lcg(code.charCodeAt(0) * 31 + code.charCodeAt(3));
  const byId = new Map(snap.players.map((p) => [p.id, pages.get(p.name)]));
  for (; step < MAX_STEPS; step++) {
    const state = snap.state;
    if (!state) throw new Error(`no game running (stage ${snap.stage})`);
    tracker.state(state);
    await sleep(80);
    for (const [id, p] of byId) checkText(tracker, await screenText(p, ['#rm-main', '#rm-now', '#rm-host']), snap.players.find((x) => x.id === id).name);
    checkText(tracker, await screenText(tv, ['body']), 'tv');
    if (state.$over) break;
    const players = snap.players.map((p) => ({ ...p, color: '#fff' }));
    const ctx = { players, content, rng: rand, now: Date.now() };
    const inGame = new Set(snap.inGame);
    const seats = [null, ...snap.players.map((p) => p.id).filter((id) => inGame.has(id) || (state.audience || []).includes(id))];
    const moves = botMoves(g.engine, state, seats, ctx);
    const d = rt.deadlineOf(g.engine, state);
    const before = JSON.stringify(state);
    if (!moves.length || (d && rand() < 0.1)) {
      if (!d) throw new Error(`stuck in phase ${state.phase}: no move and no timer`);
      await hook(BASE, code, '/deadline', {});
    } else {
      const move = moves[Math.floor(rand() * moves.length)];
      const page = move.who === null ? host : byId.get(move.who);
      const how = await makeMove(page, '#rm-main', '#rm-host', move.a, hostIndexOf(rt, g.engine, state, ctx, move));
      let changed = false;
      if (how) {
        const end = Date.now() + 2500;
        while (Date.now() < end) {
          snap = await hook(BASE, code);
          if (JSON.stringify(snap.state) !== before) { changed = true; break; }
          await sleep(50);
        }
      }
      if (!changed) {
        noUi.add(`${move.a.type}${how ? ' (tap had no effect)' : ''} in ${state.phase}`);
        const res = await hook(BASE, code, '/act', { playerId: move.who, type: move.a.type, payload: move.a.payload ?? null });
        if (res.error) throw new Error(`bot move ${move.a.type} rejected in ${state.phase}: ${res.error}`);
      }
    }
    snap = await hook(BASE, code);
  }
  if (!snap.state || !snap.state.$over) throw new Error(`no game over after ${step} steps (phase ${snap.state && snap.state.phase})`);
  for (const u of noUi) tracker.problem(`no UI path: ${u}`);
  return step;
}

async function standings(env, room) {
  await room.host.locator('#rm-host .btn', { hasText: 'Standings' }).click({ timeout: 6000 });
  const end = Date.now() + 6000;
  while (Date.now() < end) {
    const s = await hook(env.BASE, room.code);
    if (s.stage === 'between') return s;
    await sleep(80);
  }
  throw new Error('Standings did not open the between-games screen');
}

async function roomRun(browser, env, { g, tier, pack }) {
  const errors = [];
  const m = g.engine.meta;
  const n = Math.min(m.maxPlayers, Math.max(m.minPlayers, 4));
  const room = await openRoom(browser, env, g, tier, pack, n, errors);
  try {
    if (pack) {
      const lobby = await room.host.locator('.lobby').innerText();
      if (!lobby.includes(pack.title)) throw new Error(`lobby does not name ${pack.title}`);
    }
    await room.host.locator('#lb-start').click();
    for (const p of room.pages.values()) await p.locator('#rm-main > *').first().waitFor();
    let snap = await hook(env.BASE, room.code);
    for (let i = 0; i < 100 && !snap.state; i++) { await sleep(80); snap = await hook(env.BASE, room.code); }
    if ((snap.packCode || null) !== (pack ? pack.code : null)) throw new Error(`room plays ${snap.packCode}, not ${pack && pack.code}`);
    const content = pack ? pack.merged : g.content;
    const tracker = new env.Tracker(g.id, content);
    const steps = await playRoom(env, room, g, content, tracker);
    await room.tv.screenshot({ path: `${env.OUT}/matrix-${g.id}-room-${tier}-tv.png` }).catch(() => {});
    await standings(env, room);
    await room.tv.waitForTimeout(400);
    checkText(tracker, await screenText(room.tv, ['body']), 'tv standings');
    for (const e of errors) tracker.problem(e);
    return { steps, problems: tracker.problems };
  } finally {
    for (const p of [...room.pages.values(), room.tv]) await p.context().close().catch(() => {});
  }
}

// A Party Night of three games in one room, queued from the lobby's night
// planner, played to game over each, standings between, awards at the end.
async function nightRun(browser, env, ids, tier) {
  const errors = [];
  const [first, ...rest] = ids.map((id) => env.games.get(id));
  const room = await openRoom(browser, env, first, tier, null, 4, errors);
  try {
    for (const g of rest) {
      const res = await addToNight(room.host, g);
      if (!res) throw new Error(`could not queue ${g.engine.meta.name} from the lobby`);
    }
    let snap = await hook(env.BASE, room.code);
    if (snap.night.queue.join() !== rest.map((g) => g.id).join()) throw new Error(`queue is ${snap.night.queue}, expected ${rest.map((g) => g.id)}`);
    await room.host.locator('#lb-start').click();
    let steps = 0;
    const tracker = new env.Tracker(first.id, null);
    for (let i = 0; i < ids.length; i++) {
      snap = await hook(env.BASE, room.code);
      for (let k = 0; k < 100 && !snap.state; k++) { await sleep(80); snap = await hook(env.BASE, room.code); }
      const g = env.games.get(snap.gameId);
      if (g.id !== ids[i]) throw new Error(`game ${i + 1} is ${g.id}, expected ${ids[i]}`);
      for (const p of room.pages.values()) await p.locator('#rm-main > *').first().waitFor();
      const t = new env.Tracker(g.id, g.content);
      steps += await playRoom(env, room, g, g.content, t);
      for (const p of t.problems) tracker.problem(`${g.id}: ${p}`);
      await standings(env, room);
      if (i < ids.length - 1) {
        await room.host.locator('.hostbar .btn', { hasText: 'Play ' }).first().click({ timeout: 6000 });
      }
    }
    // Awards.
    await room.host.locator('.hostbar .btn', { hasText: 'Awards' }).first().click({ timeout: 6000 });
    const end = Date.now() + 6000;
    while (Date.now() < end && (await hook(env.BASE, room.code)).stage !== 'recap') await sleep(100);
    snap = await hook(env.BASE, room.code);
    if (snap.stage !== 'recap') throw new Error(`awards did not open (stage ${snap.stage})`);
    if (snap.night.played !== 3) throw new Error(`night recorded ${snap.night.played} games`);
    await room.tv.waitForTimeout(800);
    await room.tv.screenshot({ path: `${env.OUT}/matrix-night-${tier}-tv-awards.png` }).catch(() => {});
    checkText(tracker, await screenText(room.tv, ['body']), 'tv awards');
    for (const e of errors) tracker.problem(e);
    return { steps, problems: tracker.problems };
  } finally {
    for (const p of [...room.pages.values(), room.tv]) await p.context().close().catch(() => {});
  }
}

// The lobby's night planner (e2e/night.mjs does the same): add a game.
async function addToNight(host, g) {
  await host.locator('#lb-queue').click();
  await host.locator(`.sheet .game-row[data-value="${g.id}"]`).click({ timeout: 5000 });
  await host.locator('.sheet-wrap.open').waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
  return true;
}

// Layout faults on the current screen: wider than the screen, a TV page
// that scrolls (the TV cannot), text cut off inside its own box.
export async function layoutProblems(page, { tv = false } = {}) {
  return page.evaluate((tv) => {
    const out = [];
    const W = innerWidth;
    if (document.documentElement.scrollWidth > W + 1) out.push(`page is ${document.documentElement.scrollWidth}px wide on a ${W}px screen`);
    if (tv && document.documentElement.scrollHeight > innerHeight + 2) out.push(`TV page scrolls: ${document.documentElement.scrollHeight}px tall on ${innerHeight}px`);
    const seen = new Set();
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (el.closest('.toasts, #toasts, .moment, svg, .fx, canvas, .visually-hidden')) continue;
      // Off the right edge of the screen, unless a scroll or clip box holds it.
      const held = () => {
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          const o = getComputedStyle(a).overflowX;
          if (o !== 'visible' && a.getBoundingClientRect().right <= W + 2) return true;
        }
        return false;
      };
      if (r.right > W + 2 && cs.position !== 'fixed' && !held()) {
        const k = `off ${el.className}`;
        if (!seen.has(k)) { seen.add(k); out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} runs off screen (right ${Math.round(r.right)}px)`); }
      }
      // Text cut off inside its own box (overflow hidden, no ellipsis meant).
      if ((cs.overflow === 'hidden' || cs.overflowX === 'hidden') && el.children.length === 0 && el.textContent.trim()
        && el.scrollWidth > el.clientWidth + 2 && cs.textOverflow !== 'ellipsis') {
        const k = `clip ${el.className}`;
        if (!seen.has(k)) { seen.add(k); out.push(`text clipped in ${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}: "${el.textContent.trim().slice(0, 40)}"`); }
      }
    }
    return out.slice(0, 8);
  }, tv);
}
