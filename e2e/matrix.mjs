// QA matrix: every game, played to game over by bots, in every mode, every
// tier, with the built-in deck and with curated packs, plus Party Nights of
// three games. Two layers:
//
//   engine   in-process, fast, exhaustive: rooms through the real
//            RoomManager (lib/rooms.mjs, packs by their c:<id> code, the same
//            path a phone's websocket takes) and pass and play through the
//            runtime exactly as public/js/pass.js drives it. Every view of
//            every step is rendered through the game's real client.js and
//            checked. Every curated pack of every game, x pass/room x 3 tiers.
//   browser  real Chromium against a local server started with
//            GAMES_TEST_HOOKS=1. Bots pick a legal move from the real state
//            (pass: the phone's saved game; room: the server's test hook) and
//            then make it by tapping the matching button on the right screen
//            (the hand-the-phone gate, the host bar, a data-act button, a
//            form). A move with no button to tap is made through the hook
//            instead and reported as "no UI path". One curated pack per run,
//            rotated so every game plays 3+ packs including its smallest and
//            biggest.
//
//   node e2e/matrix.mjs                      engine layer only
//   node e2e/matrix.mjs --layer=browser [baseUrl]   (server needs GAMES_TEST_HOOKS=1)
//   node e2e/matrix.mjs --layer=all [baseUrl]
//   options: --games=wyr,heads --modes=room --tiers=deadly --json=out.json
//
// Checked on every run: it reaches game over; no uncaught exception, engine
// throw, rejected bot move, view error or console error; never stuck (no move
// and no timer); no rendered "undefined", "null", "NaN", "[object Object]" or
// empty prompt; and no deck item (prompt, word, pair, question, location,
// spectrum) dealt twice in one game while unseen ones were left.
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GAMES_DIR = join(ROOT, 'games');
const argv = process.argv.slice(2);
const flag = (k, d = '') => (argv.find((a) => a.startsWith(`--${k}=`)) || `--${k}=${d}`).split('=').slice(1).join('=');
const BASE = (argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8979').replace(/\/+$/, '');
const LAYER = flag('layer', 'engine');
const ONLY = flag('games').split(',').filter(Boolean);
const MODES = flag('modes', 'pass,room').split(',');
const TIERS = flag('tiers', 'standard,drinking,deadly').split(',');
const OUT = process.env.E2E_OUT || '/tmp/games-e2e';
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);

// The client kit touches a few browser globals at import and in toasts; the
// engine layer renders client.js output to strings only, so stubs do.
const noop = () => {};
const el = () => ({ dataset: {}, style: {}, classList: { add: noop, remove: noop, toggle: noop }, appendChild: noop, setAttribute: noop, addEventListener: noop, remove: noop, querySelector: () => null, querySelectorAll: () => [] });
globalThis.window ??= globalThis;
globalThis.document ??= { ...el(), body: el(), documentElement: el(), createElement: el, getElementById: () => null };
globalThis.localStorage ??= { getItem: () => null, setItem: noop, removeItem: noop };
globalThis.getComputedStyle ??= () => ({ getPropertyValue: () => '' });
globalThis.matchMedia ??= () => ({ matches: false, addEventListener: noop });

const { loadGames } = await import(pathToFileURL(join(ROOT, 'lib/registry.mjs')).href);
const { RoomManager } = await import(pathToFileURL(join(ROOT, 'lib/rooms.mjs')).href);
const rt = await import(pathToFileURL(join(ROOT, 'games/_kit/runtime.js')).href);
const { makeApi } = await import(pathToFileURL(join(ROOT, 'public/js/surface.js')).href);
const { Tracker, botMoves } = await import('./matrix-lib.mjs');

const games = await loadGames(GAMES_DIR, { strict: true });
const GAME_IDS = [...games.keys()].filter((id) => !ONLY.length || ONLY.includes(id));
const clients = new Map();
for (const id of GAME_IDS) clients.set(id, await import(pathToFileURL(join(GAMES_DIR, id, 'client.js')).href));

/* what to play */

// Every pack for the engine layer; for the browser, a rotation that covers
// the smallest, the biggest and at least one more per game across its runs.
function packsOf(g) {
  return [...(g.curated ? g.curated.values() : [])].sort((a, b) => a.count - b.count || a.id.localeCompare(b.id));
}
function browserPackPlan(g) {
  const all = packsOf(g);
  if (!all.length) return [null];
  const pick = [all[0], all[all.length - 1], all[Math.floor(all.length / 2)], all[Math.floor(all.length / 4)], all[Math.floor((3 * all.length) / 4)]];
  return [...new Set(pick)];
}

// Options per tier: Standard plays the longest game the options allow (the
// most deals, so a repeat would show), Drinking turns spicy material on,
// Deadly plays the defaults.
function optionsFor(g, tier) {
  const o = {};
  for (const opt of g.engine.meta.options || []) {
    if (tier === 'standard' && opt.type === 'stepper' && /round|turn/i.test(opt.key)) o[opt.key] = opt.max;
    if (tier === 'drinking' && opt.type === 'toggle' && /spic/i.test(opt.key)) o[opt.key] = true;
    if (tier === 'drinking' && opt.type === 'choice' && opt.key === 'spice') o[opt.key] = 'wild';
  }
  return o;
}

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* checks */

function render(tracker, gameId, fn, view, api, where) {
  const client = clients.get(gameId);
  let markup;
  try { markup = String(client[fn](view, api) ?? ''); } catch (err) {
    tracker.problem(`${where} render threw: ${err.message}`);
    return;
  }
  tracker.html(markup, where);
  if (fn !== 'tv' || api.surface === 'shared') {
    try {
      const line = typeof client.now === 'function' ? client.now(view, api) : null;
      if (line) tracker.html(String(line.text), `${where} now()`);
    } catch (err) { tracker.problem(`${where} now() threw: ${err.message}`); }
  }
}

/* engine layer: pass and play */

const NAMES = ['Ava', 'Ben', 'Cat', 'Dev', 'Eli', 'Fin', 'Gus', 'Hana', 'Ivy', 'Jay', 'Kit', 'Leo', 'Mia', 'Ned', 'Oli', 'Pip', 'Quin', 'Rex', 'Sam', 'Tia'];
const MAX_STEPS = 4000;

function enginePass(g, pack, tier, seed) {
  const m = g.engine.meta;
  const rng = seeded(seed);
  const n = Math.min(m.maxPlayers, Math.max(m.minPlayers, 4));
  const players = NAMES.slice(0, n).map((name, i) => ({ id: `p${i}`, name, color: '#ff6b6b' }));
  const content = pack ? pack.merged : g.content;
  let now = 1_700_000_000_000;
  const ctx = () => ({ players, content, rng, now });
  const created = rt.createGame(g.engine, { players, variant: tier, mode: 'pass', options: optionsFor(g, tier), content, rng, now });
  if (created.error) throw new Error(created.error);
  let state = created.state;
  const tr = new Tracker(g.id, content);
  const base = { players, hostId: null, mode: 'pass', variant: tier };
  let step = 0;
  for (; step < MAX_STEPS && !state.$over; step++) {
    tr.state(state);
    const turn = rt.passTurnOf(g.engine, state, ctx());
    if (turn) render(tr, g.id, 'player', rt.playerViewOf(g.engine, state, turn, ctx()), makeApi({ ...base, surface: 'player', me: players.find((p) => p.id === turn), isHost: false }), 'pass player');
    else render(tr, g.id, 'tv', rt.tvViewOf(g.engine, state, ctx()), makeApi({ ...base, surface: 'shared', me: null, isHost: true }), 'pass shared');
    const moves = botMoves(g.engine, state, [turn], ctx());
    const d = rt.deadlineOf(g.engine, state);
    if (!moves.length || (d && rng() < 0.15)) {
      if (!d) throw new Error(`stuck in phase ${state.phase}: no move and no timer`);
      now = Math.max(now, d.at);
      state = rt.runDeadlines(g.engine, state, ctx());
      continue;
    }
    const { who, a } = moves[Math.floor(rng() * moves.length)];
    const r = rt.applyAction(g.engine, state, { type: a.type, payload: a.payload ?? null, from: who, host: who === null }, ctx());
    if (r.error) throw new Error(`bot move ${a.type} ${JSON.stringify(a.payload)} rejected in ${state.phase}: ${r.error} ${r.detail || ''}`);
    state = r.state;
    now += 700;
  }
  tr.state(state);
  if (state.$over) render(tr, g.id, 'tv', rt.tvViewOf(g.engine, state, ctx()), makeApi({ ...base, surface: 'shared', me: null, isHost: true }), 'pass game over');
  if (!state.$over) throw new Error(`no game over after ${MAX_STEPS} steps (phase ${state.phase})`);
  return { steps: step, tracker: tr };
}

/* engine layer: rooms through the real RoomManager */

function fakeClock() {
  let now = 1_700_000_000_000;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => now,
    timers: { set: (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: now + ms }); return id; }, clear: (id) => timers.delete(id) },
    advance(ms) { now += ms; },
    // Fire the next due timer (jumping the clock to it). False if none.
    fireNext(filter = () => true) {
      const next = [...timers.entries()].filter(([, t]) => filter(t)).sort((x, y) => x[1].at - y[1].at)[0];
      if (!next) return false;
      timers.delete(next[0]);
      now = Math.max(now, next[1].at);
      next[1].fn();
      return true;
    },
    pending: () => timers.size,
  };
}

let cseq = 0;
function conn(rooms, label, errors) {
  const c = { inbox: [], label };
  c.handle = rooms.connect({ send: (m) => c.inbox.push(m), close: () => {} });
  c.send = (m) => {
    const id = ++cseq;
    if (c.inbox.length > 60) c.inbox.splice(0, c.inbox.length - 20);
    try { c.handle.message({ ...m, id }); } catch (err) { errors.push(`${label}: ${m.t} threw ${err.stack}`); }
    const r = c.inbox.findLast((x) => x.id === id);
    return r && r.t === 'error' ? { error: r.message || r.code } : { ok: true };
  };
  c.last = (t) => c.inbox.findLast((x) => x.t === t);
  return c;
}

function roomSetup(gameIds, tier, packFor, playerCount, seed) {
  const clock = fakeClock();
  const errors = [];
  const rooms = new RoomManager({
    games, now: clock.now, timers: clock.timers, rng: seeded(seed),
    log: (msg) => { if (/threw|error|fail/i.test(msg)) errors.push(`server: ${msg.split('\n')[0]}`); },
  });
  const first = games.get(gameIds[0]);
  const host = conn(rooms, 'host', errors);
  const pk = packFor(first);
  const r = host.send({ t: 'create', name: NAMES[0], gameId: first.id, variant: tier, packCode: pk ? pk.code : null, options: optionsFor(first, tier) });
  if (r.error) throw new Error(`create: ${r.error}`);
  const code = host.last('joined').code;
  const seats = [host];
  for (let i = 1; i < playerCount; i++) {
    const c = conn(rooms, NAMES[i], errors);
    const j = c.send({ t: 'join', code, name: NAMES[i] });
    if (j.error) throw new Error(`join: ${j.error}`);
    seats.push(c);
  }
  const tv = conn(rooms, 'tv', errors);
  const w = tv.send({ t: 'tv', code });
  if (w.error) throw new Error(`tv: ${w.error}`);
  const room = rooms.rooms.get(code);
  for (const id of gameIds.slice(1)) {
    const q = host.send({ t: 'host', op: 'queueAdd', gameId: id });
    if (q.error) throw new Error(`queueAdd ${id}: ${q.error}`);
  }
  return { clock, errors, rooms, host, seats, tv, room, code };
}

// Play the room's current game to game over. Returns the step count.
function playRoomGame(env, tier, seed, tracker) {
  const { clock, rooms, host, seats, tv, room } = env;
  const g = games.get(room.gameId);
  const rng = seeded(seed + 17);
  const byId = new Map(seats.map((c) => [c.last('state').room.you, c]));
  let step = 0;
  for (; step < MAX_STEPS && !(room.state && room.state.$over); step++) {
    const state = room.state;
    tracker.state(state);
    // Every phone and the TV, as the server sent them.
    for (const c of seats) {
      const msg = c.last('state');
      if (msg.viewError) tracker.problem(`playerView error: ${msg.viewError}`);
      const me = msg.room.players.find((p) => p.id === msg.room.you);
      if (msg.view) render(tracker, g.id, 'player', msg.view, makeApi({ surface: 'player', me, players: msg.room.players, hostId: msg.room.hostId, isHost: msg.room.hostId === me.id, mode: 'room', variant: msg.room.variant }), `room ${me.name}`);
    }
    const tvMsg = tv.last('tv');
    if (tvMsg.viewError) tracker.problem(`tvView error: ${tvMsg.viewError}`);
    if (tvMsg.view) render(tracker, g.id, 'tv', tvMsg.view, makeApi({ surface: 'tv', me: null, players: tvMsg.room.players, hostId: tvMsg.room.hostId, isHost: false, mode: 'room', variant: tvMsg.room.variant }), 'room tv');

    const ctx = rooms.ctx(room);
    const inGame = new Set(rooms.inGameIds(room));
    const audience = new Set(state.audience || []);
    const seatIds = [null, ...[...byId.keys()].filter((id) => inGame.has(id) || audience.has(id))];
    const moves = botMoves(g.engine, state, seatIds, ctx);
    const pendingDeadline = rt.deadlineOf(g.engine, state);
    if (!moves.length || (pendingDeadline && rng() < 0.15)) {
      if (!pendingDeadline) throw new Error(`stuck in phase ${state.phase}: no move and no timer`);
      // The room's own deadline timer, fired by the clock.
      if (!clock.fireNext((t) => t.at <= pendingDeadline.at + 1)) throw new Error(`phase ${state.phase} has a deadline but the room scheduled no timer`);
      continue;
    }
    const { who, a } = moves[Math.floor(rng() * moves.length)];
    const c = who === null ? host : byId.get(who);
    const r = c.send({ t: 'act', type: a.type, payload: a.payload ?? null });
    if (r.error) throw new Error(`bot move ${a.type} ${JSON.stringify(a.payload)} by ${c.label} rejected in ${state.phase}: ${r.error}`);
    clock.advance(700);
  }
  tracker.state(room.state);
  if (!(room.state && room.state.$over)) throw new Error(`no game over after ${MAX_STEPS} steps (phase ${room.state && room.state.phase})`);
  // The host bar now leads with Standings.
  const hs = host.last('state');
  if (!hs.platform.some((p) => p.op === 'standings')) tracker.problem('game over but no Standings button for the host');
  return step;
}

function engineRoom(g, pack, tier, seed, count = null) {
  const m = g.engine.meta;
  const n = count || Math.min(m.maxPlayers, Math.max(m.minPlayers, 4));
  const env = roomSetup([g.id], tier, () => pack, n, seed);
  const content = env.rooms.contentFor(g.id, pack ? pack.code : null);
  if (pack && content !== pack.merged && JSON.stringify(content) !== JSON.stringify(pack.merged)) throw new Error('room is not dealing from the picked pack');
  const s = env.host.send({ t: 'host', op: 'start' });
  if (s.error) throw new Error(`start: ${s.error}`);
  const tracker = new Tracker(g.id, content);
  const steps = playRoomGame(env, tier, seed, tracker);
  for (const e of env.errors) tracker.problem(e);
  return { steps, tracker };
}

// A Party Night of three games in one room: play each to game over, go to
// the standings, start the next, then the awards.
function engineNight(gameIds, tier, seed) {
  const env = roomSetup(gameIds, tier, (g) => packsOf(g)[1] || null, 4, seed);
  for (const id of gameIds.slice(1)) {
    const g = games.get(id);
    const p = packsOf(g)[1];
    if (!p) continue;
    // Each game of the night keeps its own pack (packByGame): set it by
    // lining the game up in the lobby, then switch back.
    env.room.packByGame[id] = p.code;
  }
  let s = env.host.send({ t: 'host', op: 'start' });
  if (s.error) throw new Error(`start: ${s.error}`);
  const tracker = new Tracker(gameIds[0], null);
  let steps = 0;
  for (let i = 0; i < gameIds.length; i++) {
    if (env.room.gameId !== gameIds[i]) throw new Error(`game ${i + 1} is ${env.room.gameId}, expected ${gameIds[i]}`);
    const want = packsOf(games.get(gameIds[i]))[1];
    if (want && env.room.packCode !== want.code) throw new Error(`${gameIds[i]} is not playing its own pack (${env.room.packCode})`);
    const t = new Tracker(gameIds[i], env.rooms.contentFor(gameIds[i], env.room.packCode));
    steps += playRoomGame(env, tier, seed + i, t);
    for (const p of t.problems) tracker.problem(`${gameIds[i]}: ${p}`);
    s = env.host.send({ t: 'host', op: 'standings' });
    if (s.error) throw new Error(`standings: ${s.error}`);
    if (env.room.stage !== 'between') throw new Error(`after standings the room is in ${env.room.stage}`);
    if (i < gameIds.length - 1) {
      s = env.host.send({ t: 'host', op: 'next' });
      if (s.error) throw new Error(`next: ${s.error}`);
    }
  }
  s = env.host.send({ t: 'host', op: 'recap' });
  if (s.error) throw new Error(`recap: ${s.error}`);
  const night = env.room.night;
  if (night.played.length !== gameIds.length) throw new Error(`night recorded ${night.played.length} games, expected ${gameIds.length}`);
  if (env.room.stage !== 'recap') throw new Error(`awards did not show (stage ${env.room.stage})`);
  const tvMsg = env.tv.last('tv');
  if (tvMsg.room.phase !== 'recap') tracker.problem(`TV is on ${tvMsg.room.phase}, not the awards`);
  for (const e of env.errors) tracker.problem(e);
  return { steps, tracker };
}

/* running and reporting */

const results = [];
function record(r) {
  results.push(r);
  const mark = r.ok ? (r.problems.length ? 'WARN' : 'PASS') : 'FAIL';
  log(`${mark}  ${r.layer.padEnd(7)} ${r.game.padEnd(11)} ${r.mode.padEnd(5)} ${r.tier.padEnd(8)} ${r.pack.padEnd(22)} ${r.steps != null ? `${r.steps} steps` : ''}${r.err ? `  ${r.err}` : ''}`);
  for (const p of r.problems) log(`        - ${p}`);
}

function runEngineLayer() {
  let seed = 1;
  for (const id of GAME_IDS) {
    const g = games.get(id);
    const modes = (g.engine.meta.modes || ['pass', 'room']).filter((m) => MODES.includes(m));
    for (const pack of [null, ...packsOf(g)]) {
      for (const mode of modes) {
        for (const tier of TIERS) {
          const s = seed++;
          const base = { layer: 'engine', game: id, mode, tier, pack: pack ? pack.id : 'built-in', problems: [] };
          try {
            const { steps, tracker } = mode === 'pass' ? enginePass(g, pack, tier, s) : engineRoom(g, pack, tier, s);
            record({ ...base, ok: !tracker.problems.length, steps, problems: tracker.problems });
          } catch (err) {
            record({ ...base, ok: false, err: err.message.split('\n')[0] });
          }
        }
      }
    }
  }
  // Player counts: the minimum, the maximum, and two over the cap (they
  // watch from the crowd), each a full room game on the built-in deck.
  for (const id of GAME_IDS) {
    const g = games.get(id);
    const m = g.engine.meta;
    if (!(m.modes || ['pass', 'room']).includes('room') || !MODES.includes('room')) continue;
    for (const [label, count] of [['min', m.minPlayers], ['max', m.maxPlayers], ['max+2', m.maxPlayers + 2]]) {
      const base = { layer: 'engine', game: id, mode: `room ${label} (${count})`, tier: 'drinking', pack: 'built-in', problems: [] };
      try {
        const { steps, tracker } = engineRoom(g, null, 'drinking', seed++, count);
        record({ ...base, ok: !tracker.problems.length, steps, problems: tracker.problems });
      } catch (err) {
        record({ ...base, ok: false, err: err.message.split('\n')[0] });
      }
    }
  }
  // Party Nights: three different games in a row, in each tier.
  if (!ONLY.length || ONLY.length >= 3) {
    const nights = [
      ['wyr', 'quiz-show', 'imposter'],
      ['heads', 'codewords', 'sketchy'],
      ['fake-out', 'tod', 'spyfall'],
      ['mlt', 'tune-in', 'werewolf'],
      ['paranoia', 'salad-bowl', 'nhie'],
    ].filter((n) => n.every((id) => GAME_IDS.includes(id)));
    for (const night of nights) {
      for (const tier of TIERS) {
        const base = { layer: 'engine', game: night.join('+'), mode: 'night', tier, pack: 'second pack each', problems: [] };
        try {
          const { steps, tracker } = engineNight(night, tier, seed++);
          record({ ...base, ok: !tracker.problems.length, steps, problems: tracker.problems });
        } catch (err) {
          record({ ...base, ok: false, err: err.message.split('\n')[0] });
        }
      }
    }
  }
}

if (LAYER === 'engine' || LAYER === 'all') runEngineLayer();
if (LAYER === 'browser' || LAYER === 'all') {
  const { runBrowserLayer } = await import('./matrix-browser.mjs');
  await runBrowserLayer({ BASE, OUT, games, GAME_IDS, MODES, TIERS, browserPackPlan, optionsFor, Tracker, botMoves, record, rt, log });
}

/* summary */

const bad = results.filter((r) => !r.ok);
log('\n==== matrix summary ====');
const table = new Map();
for (const r of results) {
  const k = `${r.layer} ${r.game} ${r.mode}`;
  const row = table.get(k) || { pass: 0, fail: 0, runs: 0 };
  row.runs++;
  if (r.ok) row.pass++; else row.fail++;
  table.set(k, row);
}
for (const [k, v] of table) log(`${v.fail ? 'FAIL' : 'PASS'}  ${k.padEnd(48)} ${v.pass}/${v.runs}`);
log(`\n${results.length} runs, ${results.length - bad.length} passed, ${bad.length} failed`);
const jsonOut = flag('json');
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 1));
process.exit(bad.length ? 1 : 0);
