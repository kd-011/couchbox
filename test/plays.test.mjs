// `npm run plays`: turns the journal's `[rooms]` lines into "what did we
// actually play". Pure functions here; the CLI only feeds them journalctl.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJournal, summarise, render } from '../lib/plays.mjs';

const P = 'host node[563793]: [rooms]';
const at = (iso, rest) => `${iso} ${P} ${rest}`;

// Old-format lines (before telemetry): the real VGQH and NKFZ rooms, plus a
// canary room that lasted 20 seconds.
const LEGACY = [
  at('2026-10-10T12:08:00+0800', 'room NKFZ created (codewords, standard)'),
  at('2026-10-10T12:51:00+0800', 'room NKFZ closed: Everyone left, so the room closed.'),
  at('2026-10-16T22:41:31+0800', 'room VGQH created (mlt, deadly)'),
  at('2026-10-16T22:43:03+0800', 'room VGQH: tier -> drinking'),
  at('2026-10-16T23:46:26+0800', 'room VGQH closed: Everyone left, so the room closed.'),
  at('2026-10-17T03:00:54+0800', 'room QCDR created (imposter, standard)'),
  at('2026-10-17T03:01:07+0800', 'room QCDR: host -> p92e04a4401'),
  at('2026-10-17T03:01:08+0800', 'room QCDR: host -> p7a911c8cbc'),
  at('2026-10-17T03:01:10+0800', 'room QCDR closed: Everyone left.'),
].join('\n');

// New-format lines for one room that played MLT (dropped the tier, finished),
// then Would You Rather (abandoned).
const NEW = [
  at('2026-10-18T20:00:00+0800', 'room ABCD created (mlt, deadly)'),
  at('2026-10-18T20:00:30+0800', 'room ABCD game start game=mlt tier=deadly players=4 audience=0 tvs=1 pack=none phase=vote lobby_ms=30000'),
  at('2026-10-18T20:00:50+0800', 'room ABCD phase game=mlt round=1 phase=reveal prev=vote prev_ms=20000'),
  at('2026-10-18T20:02:00+0800', 'room ABCD: tier -> drinking from=deadly game=mlt round=3 game_ms=90000 room_ms=120000'),
  at('2026-10-18T20:10:00+0800', 'room ABCD game over game=mlt round=10 rounds=10 ms=570000'),
  at('2026-10-18T20:10:30+0800', 'room ABCD game end game=mlt reason=standings rounds=10 ms=600000 finished=1'),
  at('2026-10-18T20:10:40+0800', 'room ABCD game start game=wyr tier=drinking players=4 audience=0 tvs=1 pack=c:aussie phase=vote lobby_ms=10000'),
  at('2026-10-18T20:12:40+0800', 'room ABCD game end game=wyr reason=closed rounds=2 ms=120000 finished=0'),
  at('2026-10-18T20:30:00+0800', 'room ABCD summary reason=empty ms=1800000 active_ms=900000 games=2 finished=1 rounds=12 tier_drops=1 peak_players=4'),
  at('2026-10-18T20:30:00+0800', 'room ABCD closed: Everyone left, so the room closed.'),
  // Same code reused later, a lobby that never started a game.
  at('2026-10-19T09:00:00+0800', 'room ABCD created (tod, standard)'),
  at('2026-10-19T09:20:00+0800', 'room ABCD summary reason=empty ms=1200000 active_ms=300000 games=0 finished=0 rounds=0 tier_drops=0 peak_players=2'),
  at('2026-10-19T09:20:00+0800', 'room ABCD closed: Everyone left, so the room closed.'),
].join('\n');

const NOISE = [
  '-- Boot --',
  'Oct 09 11:34:22 host node[4092532]: games on http://127.0.0.1:8969',
  at('2026-10-18T19:00:00+0800', 'not a room line at all'),
].join('\n');

test('parses old-format rooms from timestamps alone and flags them legacy', () => {
  const rooms = parseJournal(LEGACY);
  assert.equal(rooms.length, 3);
  const v = rooms.find((r) => r.code === 'VGQH');
  assert.equal(v.legacy, true);
  assert.equal(v.createdGame, 'mlt');
  assert.equal(v.createdTier, 'deadly');
  assert.equal(v.ms, 65 * 60_000 - 5_000 + 0, 'created 22:41:31 to closed 23:46:26');
  assert.equal(v.tierDrops.length, 1);
  assert.equal(v.tierDrops[0].to, 'drinking');
  assert.equal(v.tierDrops[0].roomMs, 92_000, 'derived from timestamps when the line has no room_ms');
});

test('old rooms swept after the empty wait were only played until that wait began', () => {
  const rooms = parseJournal(LEGACY);
  const v = rooms.find((r) => r.code === 'VGQH');
  assert.equal(v.activeMs, v.ms - 15 * 60_000, 'closed 15 minutes after the last phone left');
  assert.equal(v.activeEstimated, true);
  const n = rooms.find((r) => r.code === 'NKFZ');
  assert.equal(n.activeMs, n.ms - 15 * 60_000 > 0 ? n.ms - 15 * 60_000 : 0);
  const q = rooms.find((r) => r.code === 'QCDR');
  assert.equal(q.activeMs, q.ms, 'an immediate "Everyone left." has no wait to take off');
});

test('parses new-format rooms: runs, tier drops and the close summary', () => {
  const [a, b] = parseJournal(NEW);
  assert.equal(a.legacy, false);
  assert.equal(a.runs.length, 2);
  assert.deepEqual(a.runs.map((r) => [r.game, r.tier, r.players, r.finished, r.rounds, r.reason]), [
    ['mlt', 'deadly', 4, true, 10, 'standings'],
    ['wyr', 'drinking', 4, false, 2, 'closed'],
  ]);
  assert.equal(a.runs[0].pack, 'none');
  assert.equal(a.runs[1].pack, 'c:aussie');
  assert.equal(a.tierDrops.length, 1);
  assert.deepEqual([a.tierDrops[0].from, a.tierDrops[0].to, a.tierDrops[0].round, a.tierDrops[0].gameMs], ['deadly', 'drinking', 3, 90_000]);
  assert.equal(a.activeMs, 900_000);
  assert.equal(a.closeReason, 'empty');
  assert.equal(b.runs.length, 0, 'a reused code starts a fresh room');
  assert.equal(b.createdGame, 'tod');
});

test('ignores everything that is not a [rooms] line', () => {
  assert.equal(parseJournal(NOISE).length, 0);
  assert.equal(parseJournal('').length, 0);
});

test('also reads plain journalctl output and bare lines', () => {
  const plain = 'Oct 16 22:41:31 host node[563793]: [rooms] room VGQH created (mlt, deadly)\nOct 16 23:46:26 host node[563793]: [rooms] room VGQH closed: Everyone left.';
  const [r] = parseJournal(plain, { year: 2026 });
  assert.equal(r.code, 'VGQH');
  assert.equal(r.legacy, true);
  assert.ok(r.ms > 60 * 60_000);
  const bare = parseJournal('[rooms] room XXXX created (heads, standard)');
  assert.equal(bare.length, 1);
});

test('summary per game: rooms, runs, completion, medians, rounds, tier drops', () => {
  const rooms = parseJournal([LEGACY, NEW].join('\n'));
  const s = summarise(rooms, { includeBlips: false });
  const mlt = s.games.find((g) => g.id === 'mlt');
  assert.equal(mlt.rooms, 2, 'VGQH (legacy) and ABCD');
  assert.equal(mlt.runs, 1, 'only ABCD has run-level data');
  assert.equal(mlt.finished, 1);
  assert.equal(mlt.tierDrops, 2, 'VGQH and ABCD both dropped out of Deadly');
  assert.equal(mlt.medianRounds, 10);
  assert.equal(mlt.medianRunMs, 600_000);
  assert.equal(mlt.legacyRooms, 1);
  const wyr = s.games.find((g) => g.id === 'wyr');
  assert.equal(wyr.rooms, 1);
  assert.equal(wyr.finished, 0);
  assert.equal(wyr.runs, 1);
});

test('canary and test blips are counted but left out of the games table', () => {
  const rooms = parseJournal(LEGACY);
  const s = summarise(rooms, { includeBlips: false });
  assert.equal(s.blips, 1);
  assert.ok(!s.games.some((g) => g.id === 'imposter'));
  const all = summarise(rooms, { includeBlips: true });
  assert.ok(all.games.some((g) => g.id === 'imposter'));
});

test('rooms that never started a game are reported as lobby-only', () => {
  const s = summarise(parseJournal(NEW), { includeBlips: false });
  assert.equal(s.lobbyOnly, 1);
  assert.equal(s.rooms, 2);
});

test('the room length uses active time when the room reports it, not the empty wait', () => {
  const [a] = parseJournal(NEW);
  const s = summarise([a], { includeBlips: false });
  assert.equal(s.games.find((g) => g.id === 'mlt').medianRoomMs, 900_000);
});

test('the day window drops older rooms', () => {
  const rooms = parseJournal([LEGACY, NEW].join('\n'));
  const s = summarise(rooms, { days: 2, now: Date.parse('2026-10-19T12:00:00+0800'), includeBlips: true });
  assert.ok(!s.games.some((g) => g.id === 'codewords'), 'NKFZ closed on the 10th is outside two days');
  assert.ok(s.games.some((g) => g.id === 'mlt'));
});

test('render is a readable table naming each game and the headline numbers', () => {
  const rooms = parseJournal([LEGACY, NEW].join('\n'));
  const out = render(summarise(rooms, { includeBlips: false }));
  assert.match(out, /mlt/);
  assert.match(out, /wyr/);
  assert.match(out, /codewords/);
  assert.match(out, /tier drops?/i);
  assert.match(out, /lobby/i);
  assert.ok(!out.includes('—'), 'no em dashes in the output');
  assert.match(render(summarise([], {})), /No rooms/i);
});
