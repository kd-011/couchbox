// What did we actually play? Reads the `[rooms]` lines lib/rooms.mjs writes to
// the journal and summarises them per game.
//
//   npm run plays                       last 14 days from the journal
//   npm run plays -- --days=3           narrower window
//   npm run plays -- --all              keep the nightly canary and test blips
//   npm run plays -- --file=log.txt     read a saved journal instead (- is stdin)
//
// Pass-and-play runs in the browser and leaves no server trace, so this only
// ever sees rooms. Rooms from before the telemetry existed (no `game start`
// or `summary` lines) still count: their length comes from the timestamps and
// the game from the `created` line, flagged as legacy.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BLIP_MS = 60_000; // the nightly canary and QA runs open and close inside a minute
const DAY_MS = 86_400_000;
const EMPTY_WAIT_MS = 15 * 60_000; // RoomManager emptyTtlMs
const IDLE_WAIT_MS = 3 * 60 * 60_000; // RoomManager idleTtlMs
const TIER_RANK = { standard: 0, drinking: 1, deadly: 2 };
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

function kv(text) {
  return Object.fromEntries([...text.matchAll(/(\w+)=(\S+)/g)].map((m) => [m[1], m[2]]));
}

const num = (v) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// `2026-10-16T22:41:31+0800` (journalctl -o short-iso) or `Oct 16 22:41:31` (default).
function stamp(line, year) {
  let m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?)([+-]\d\d):?(\d\d|Z)?/.exec(line);
  if (m) {
    const t = Date.parse(`${m[1]}${m[2]}:${m[3] && m[3] !== 'Z' ? m[3] : '00'}`);
    return Number.isFinite(t) ? t : null;
  }
  m = /^([A-Z][a-z]{2})\s+(\d{1,2}) (\d\d:\d\d:\d\d)/.exec(line);
  if (m && m[1] in MONTHS) {
    const t = new Date(`${year} ${m[1]} ${m[2]} ${m[3]}`).getTime();
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function blank(code, createdAt) {
  return {
    code, createdAt, closedAt: null, createdGame: null, createdTier: null,
    runs: [], tierDrops: [], hostChanges: 0, ms: null, activeMs: null, closeReason: null,
    summary: null, legacy: true,
  };
}

// journal text -> one record per room, in the order they were created.
export function parseJournal(text, { year = new Date().getFullYear() } = {}) {
  const rooms = [];
  const open = new Map();
  const get = (code, at) => {
    let r = open.get(code);
    if (!r) { r = blank(code, null); r.partial = true; open.set(code, r); rooms.push(r); }
    if (at !== null && r.createdAt === null && r.partial) r.createdAt = at;
    return r;
  };
  for (const line of String(text || '').split('\n')) {
    const tag = line.indexOf('[rooms] ');
    if (tag < 0) continue;
    const at = stamp(line, year);
    const msg = line.slice(tag + 8).trim();
    let m = /^room ([A-Z]{4}) created \((\S+), (\w+)\)$/.exec(msg);
    if (m) {
      const r = blank(m[1], at);
      r.createdGame = m[2];
      r.createdTier = m[3];
      open.set(m[1], r);
      rooms.push(r);
      continue;
    }
    m = /^room ([A-Z]{4}):? (.*)$/.exec(msg);
    if (!m) continue;
    const r = get(m[1], at);
    const rest = m[2];
    if (rest.startsWith('game start ')) {
      const f = kv(rest);
      r.legacy = false;
      r.runs.push({
        game: f.game, tier: f.tier, players: num(f.players), audience: num(f.audience), tvs: num(f.tvs), pack: f.pack || 'none',
        lobbyMs: num(f.lobby_ms), startedAt: at, rounds: null, ms: null, finished: false, reason: null, phases: {},
      });
    } else if (rest.startsWith('phase ')) {
      const f = kv(rest);
      const run = r.runs[r.runs.length - 1];
      if (run && f.prev && num(f.prev_ms) !== null) (run.phases[f.prev] ||= []).push(num(f.prev_ms));
    } else if (rest.startsWith('game over ')) {
      const run = r.runs[r.runs.length - 1];
      if (run) run.finished = true;
    } else if (rest.startsWith('game end ')) {
      const f = kv(rest);
      const run = r.runs[r.runs.length - 1];
      if (run) {
        run.rounds = num(f.rounds);
        run.ms = num(f.ms);
        run.finished = run.finished || f.finished === '1';
        run.reason = f.reason || null;
        if (f.phase && num(f.phase_ms) !== null) (run.phases[f.phase] ||= []).push(num(f.phase_ms));
      }
    } else if (rest.startsWith('tier -> ')) {
      const f = kv(rest);
      const to = /^tier -> (\w+)/.exec(rest)[1];
      const from = f.from || (r.tierDrops.length ? r.tierDrops[r.tierDrops.length - 1].to : r.createdTier);
      r.tierDrops.push({
        at, from, to, game: f.game && f.game !== 'none' ? f.game : f.game === 'none' ? null : r.createdGame,
        round: num(f.round), gameMs: num(f.game_ms),
        roomMs: num(f.room_ms) ?? (at !== null && r.createdAt !== null ? at - r.createdAt : null),
      });
    } else if (rest.startsWith('summary ')) {
      const f = kv(rest);
      r.legacy = false;
      r.summary = f;
      r.closeReason = f.reason || null;
      r.ms = num(f.ms);
      r.activeMs = num(f.active_ms);
    } else if (rest.startsWith('host -> ')) {
      r.hostChanges += 1;
    } else if (rest.startsWith('closed: ')) {
      r.closedAt = at;
      if (r.ms === null && at !== null && r.createdAt !== null) r.ms = at - r.createdAt;
      // Old lines carry no active time. A room swept after the empty wait (15
      // min) or the idle wait (3 h) was only played until that wait began.
      if (r.activeMs === null && r.ms !== null) {
        const wait = /^closed: Everyone left, so the room closed/.test(rest) ? EMPTY_WAIT_MS : /long quiet spell/.test(rest) ? IDLE_WAIT_MS : 0;
        r.activeMs = Math.max(0, r.ms - wait);
        r.activeEstimated = wait > 0;
      }
      open.delete(m[1]);
    }
  }
  return rooms;
}

const isDrop = (d) => (TIER_RANK[d.to] ?? 0) < (TIER_RANK[d.from] ?? 0);

function median(xs) {
  const a = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid] : Math.round((a[mid - 1] + a[mid]) / 2);
}

// Rooms -> per-game figures. `includeBlips` keeps rooms that lived under a
// minute (the nightly canary, QA runs); `days` keeps rooms created inside it.
export function summarise(rooms, { days = null, now = Date.now(), includeBlips = false } = {}) {
  const since = days ? now - days * DAY_MS : null;
  const inWindow = rooms.filter((r) => since === null || r.createdAt === null || r.createdAt >= since);
  const isBlip = (r) => r.ms !== null && r.ms < BLIP_MS;
  const blips = inWindow.filter(isBlip).length;
  const kept = includeBlips ? inWindow : inWindow.filter((r) => !isBlip(r));
  const games = new Map();
  const slot = (id) => {
    if (!games.has(id)) games.set(id, { id, rooms: 0, legacyRooms: 0, runs: 0, finished: 0, tierDrops: 0, tiers: {}, runMs: [], rounds: [], roomMs: [], players: [], phases: {} });
    return games.get(id);
  };
  let lobbyOnly = 0;
  const closeReasons = {};
  for (const r of kept) {
    if (r.closeReason) closeReasons[r.closeReason] = (closeReasons[r.closeReason] || 0) + 1;
    const ids = new Set(r.runs.map((x) => x.game).filter(Boolean));
    if (!ids.size) {
      if (r.legacy && r.createdGame) ids.add(r.createdGame);
      else if (!r.legacy) lobbyOnly += 1;
    }
    for (const id of ids) {
      const g = slot(id);
      g.rooms += 1;
      if (r.legacy) g.legacyRooms += 1;
      const len = r.activeMs ?? r.ms;
      if (len !== null) g.roomMs.push(len);
    }
    if (r.legacy && r.createdGame && r.createdTier) {
      const g = slot(r.createdGame);
      g.tiers[r.createdTier] = (g.tiers[r.createdTier] || 0) + 1;
    }
    for (const run of r.runs) {
      const g = slot(run.game);
      g.runs += 1;
      if (run.finished) g.finished += 1;
      if (run.tier) g.tiers[run.tier] = (g.tiers[run.tier] || 0) + 1;
      if (run.ms !== null) g.runMs.push(run.ms);
      if (run.rounds !== null) g.rounds.push(run.rounds);
      if (run.players !== null) g.players.push(run.players);
      for (const [ph, list] of Object.entries(run.phases)) (g.phases[ph] ||= []).push(...list);
    }
    for (const d of r.tierDrops) {
      const id = d.game || r.createdGame;
      if (id && isDrop(d)) slot(id).tierDrops += 1;
    }
  }
  const out = [...games.values()].map((g) => ({
    id: g.id, rooms: g.rooms, legacyRooms: g.legacyRooms, runs: g.runs, finished: g.finished, tierDrops: g.tierDrops, tiers: g.tiers,
    medianRoomMs: median(g.roomMs), medianRunMs: median(g.runMs), medianRounds: median(g.rounds), medianPlayers: median(g.players),
    phaseMedians: Object.fromEntries(Object.entries(g.phases).map(([k, v]) => [k, { ms: median(v), n: v.length }])),
  })).sort((a, b) => b.rooms - a.rooms || a.id.localeCompare(b.id));
  return { since, days, rooms: kept.length, blips, lobbyOnly, closeReasons, games: out };
}

export function fmtMs(ms) {
  if (ms === null || ms === undefined) return '-';
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m}m`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

const pad = (v, n, left = false) => (left ? String(v).padStart(n) : String(v).padEnd(n));

export function render(s) {
  if (!s.rooms && !s.blips) return 'No rooms in the journal for that window. Pass-and-play leaves no server trace.\n';
  const lines = [];
  const win = s.days ? `last ${s.days} days` : 'whole journal';
  lines.push(`Rooms played (${win}): ${s.rooms}${s.blips ? `, ${s.blips} canary or test blip${s.blips === 1 ? '' : 's'} under a minute left out` : ''}${s.lobbyOnly ? `, ${s.lobbyOnly} never left the lobby` : ''}.`);
  if (!s.games.length) {
    lines.push('No room started a game in that window.');
    return `${lines.join('\n')}\n`;
  }
  lines.push('');
  lines.push(`${pad('game', 12)}${pad('rooms', 6, true)}${pad('runs', 6, true)}${pad('done', 7, true)}${pad('room', 8, true)}${pad('run', 8, true)}${pad('rounds', 8, true)}${pad('ppl', 5, true)}${pad('drops', 7, true)}  tiers at start`);
  for (const g of s.games) {
    const tiers = Object.entries(g.tiers).map(([k, v]) => `${k} ${v}`).join(', ') || '-';
    lines.push(`${pad(g.id, 12)}${pad(g.rooms, 6, true)}${pad(g.runs || '-', 6, true)}${pad(g.runs ? `${g.finished}/${g.runs}` : '-', 7, true)}${pad(fmtMs(g.medianRoomMs), 8, true)}${pad(fmtMs(g.medianRunMs), 8, true)}${pad(g.medianRounds ?? '-', 8, true)}${pad(g.medianPlayers ?? '-', 5, true)}${pad(g.tierDrops, 7, true)}  ${tiers}`);
  }
  lines.push('');
  lines.push('room = median active length of a room that played it; run = median length of one game; done = games played to the end; drops = tier drops (a tier lowered in the lobby or mid-game); ppl = players at start.');
  const slow = s.games.flatMap((g) => Object.entries(g.phaseMedians).filter(([, v]) => v.n >= 3 && v.ms !== null).map(([ph, v]) => ({ id: g.id, ph, ...v })))
    .sort((a, b) => b.ms - a.ms).slice(0, 5);
  if (slow.length) {
    lines.push('');
    lines.push('Slowest phases (median time in the phase, 3+ samples):');
    for (const x of slow) lines.push(`  ${x.id} ${x.ph}: ${fmtMs(x.ms)} over ${x.n} phases`);
  }
  const legacy = s.games.reduce((n, g) => n + g.legacyRooms, 0);
  if (legacy) lines.push(`\n${legacy} room${legacy === 1 ? '' : 's'} predate run telemetry: game and length come from the created and closed lines only, and a game or tier change inside them is invisible.`);
  const reasons = Object.entries(s.closeReasons).map(([k, v]) => `${k} ${v}`).join(', ');
  if (reasons) lines.push(`Closed by: ${reasons}.`);
  lines.push('Pass-and-play runs in the browser and leaves no server trace, so it is not counted here.');
  return `${lines.join('\n')}\n`;
}

function readJournal(days) {
  return new Promise((resolve, reject) => {
    execFile('journalctl', ['--user', '-u', 'games', '--since', `${days} days ago`, '-o', 'short-iso', '--no-pager'], { maxBuffer: 256 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err); else resolve(stdout);
    });
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (k) => (argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1];
  const days = Number(flag('days')) || 14;
  const file = flag('file');
  let text;
  try {
    text = file ? readFileSync(file === '-' ? 0 : file, 'utf8') : await readJournal(days);
  } catch (err) {
    console.error(`Could not read the journal: ${err.message}`);
    process.exitCode = 1;
    return;
  }
  const rooms = parseJournal(text);
  process.stdout.write(render(summarise(rooms, { days, includeBlips: argv.includes('--all') })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
