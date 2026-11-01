// Own-device rooms: in-memory only, server-authoritative, no database.
//
// Transport-agnostic so it can be unit tested without sockets: a connection
// is any object with send(obj) and close(). server.mjs wires real WebSockets
// in; test/rooms.test.mjs drives it with fake connections and a fake clock.
//
// Wire protocol (JSON). Client -> server, every message may carry `id`, which
// is echoed back on the matching { t:'ack' } or { t:'error' }:
//   { t:'create', name, avatar?, gameId, variant, options, shotCap?, packCode? }
//   { t:'join', code, name?, avatar?, token? } token = rejoin as that player
//   { t:'tv', code }                          big-screen viewer, no identity
//   { t:'peek', code }                        what a join link leads to, before joining:
//                                             replies { t:'peeked', code, gameId, variant, players, host }
//   { t:'act', type, payload }                a game action
//   { t:'host', op, ... }                     setGame | setVariant | setOptions
//                                             | setPack {packCode: string|null}
//                                             | setShotCap {shotCap}
//                                             | setTeams {teams: [{name, memberIds}]|null}
//                                             | setAudience {playerId, audience}
//                                             | start | restart | end
//                                             | passHost {to} | kick {playerId}
//                                             Party Night: queueAdd {gameId}
//                                             | queueRemove {index} | standings
//                                             | next {gameId?} | recap | newNight
//   { t:'drink', out }                        "I'm out": my drinks become forfeits
//   { t:'react', emoji }                      floats across every screen, no game involved
//   { t:'profile', name?, color?, avatar? }
//   { t:'ready', on }                         lobby only: I'm ready (reset when a game starts)
//   { t:'leave' } | { t:'ping' }
//   Host Box device, in place of a player or TV (docs/HOSTBOX-PROTOCOL.md):
//   { t:'device', boxId, code? }               identify; code attaches straight to that room
//   { t:'press' } | { t:'longpress' } | { t:'heartbeat' }
//   Host ops to pair one: pairBox {boxId} | unpairBox {} | setBoxSlots {slots}
//                        | assignBoxPlayer {playerId}
// Server -> client:
//   { t:'joined', code, playerId, token }     only ever to that connection
//   { t:'state', now, room, view, actions, platform, drink }
//                                             per player, their view only
//   { t:'tv', now, room, view, drink }        public view only
//   room.phase: lobby | game | between (Party Night standings) | recap
//   room.pack: { code, title } | null         the active content pack, if any
//   room.teams, room.audienceIds             null/[] when not set up this run
//   room.box: { id, connected, slots, asPlayerId } | null
//   { t:'reaction', from, emoji }             fanned to every socket in the room
//   { t:'ack', id } | { t:'error', id, code, message } | { t:'pong' }
//   { t:'kicked' } | { t:'closed', reason }
//   Host Box device: { t:'paired', code } | { t:'unpaired', reason }
//                   | { t:'scene', name, params } | { t:'button', mode, label }
//                   | { t:'audio', url, text } | { t:'buttonResult', ok, message? }
import { randomBytes, randomInt } from 'node:crypto';
import * as rt from '../games/_kit/runtime.js';
import { COLORS, TEAM_COLORS, AVATARS } from '../games/_kit/palette.js';
import { newLedger, withLedger, publicDrink } from '../games/_kit/drinks.js';
import { newNight, archiveGame, MAX_QUEUE } from '../games/_kit/night.js';
import * as hostbox from './hostbox.mjs';
import * as voice from './voice.mjs';
import { CURATED_PREFIX, curatedIdOf } from './curated.mjs';

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O
export const CODE_LENGTH = 4;
export { COLORS, TEAM_COLORS, AVATARS };
const MAX_PLAYERS = 24;
const MAX_TVS = 6;
const NAME_MAX = 20;
const MAX_TEAMS = 6;
const REACTIONS = new Set(['😂', '🔥', '👀', '😬', '🍻', '💀']);

// [{ id, name, color, memberIds }], 2-MAX_TEAMS teams, trimmed to real
// players and deduped (a player named in two teams keeps only the first).
function validateTeams(input, players) {
  if (!Array.isArray(input) || input.length < 2 || input.length > MAX_TEAMS) {
    return { error: `Pick between 2 and ${MAX_TEAMS} teams.` };
  }
  const seen = new Set();
  const teams = input.map((t, i) => {
    const raw = Array.isArray((t || {}).memberIds) ? t.memberIds : [];
    const memberIds = [...new Set(raw)].filter((id) => players.has(id) && !seen.has(id));
    memberIds.forEach((id) => seen.add(id));
    return { id: `t${i + 1}`, name: cleanName((t || {}).name) || `Team ${i + 1}`, color: TEAM_COLORS[i % TEAM_COLORS.length], memberIds };
  });
  if (!teams.some((t) => t.memberIds.length)) return { error: 'Assign at least one player to a team.' };
  return { teams };
}

// Teams for the game about to start: only the active roster, teams left
// with nobody dropped. Fewer than 2 non-empty teams left: no teams this run.
function trimTeams(teams, activeIds) {
  if (!teams) return null;
  const set = new Set(activeIds);
  const trimmed = teams.map((t) => ({ ...t, memberIds: t.memberIds.filter((id) => set.has(id)) })).filter((t) => t.memberIds.length);
  return trimmed.length >= 2 ? trimmed : null;
}

const realTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h),
};

export function cleanName(raw) {
  if (typeof raw !== 'string') return '';
  // Strip control characters and collapse whitespace; names are rendered
  // escaped everywhere, this is just to keep them tidy.
  return raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

export class RoomManager {
  constructor({
    games,
    now = Date.now,
    timers = realTimers,
    rng = Math.random,
    hostGraceMs = 30_000,
    emptyTtlMs = 15 * 60_000,
    idleTtlMs = 3 * 60 * 60_000,
    maxRooms = 2000,
    log = () => {},
    speak = async () => null,
    packs = null,
  }) {
    this.games = games;
    this.now = now;
    this.timers = timers;
    this.rng = rng;
    this.hostGraceMs = hostGraceMs;
    this.emptyTtlMs = emptyTtlMs;
    this.idleTtlMs = idleTtlMs;
    this.maxRooms = maxRooms;
    this.log = log;
    this.speak = speak; // text -> url|null, lib/tts.mjs; a no-op until server.mjs wires Kokoro in
    this.packs = packs; // lib/packs.mjs, optional (tests may omit it: packs just never apply)
    this.rooms = new Map();
    this.pendingBoxes = new Map(); // boxId -> connection, identified but not yet paired to a room
  }

  // The pack the room wants to play with right now, if any, validated
  // against the game it is actually for: a curated pack (c:<id>, shipped in
  // games/<id>/packs/) or a custom one (lib/packs.mjs). Anything else is
  // refused up front; a pack that later goes stale degrades to the built-in
  // content instead of breaking the room.
  checkPack(gameId, packCode) {
    if (packCode === undefined || packCode === null || packCode === '') return { code: null };
    const g = this.games.get(gameId);
    if (typeof packCode !== 'string') return { error: 'That pack code was not found.' };
    if (packCode.startsWith(CURATED_PREFIX)) {
      const id = curatedIdOf(packCode);
      if (!g || !id || !g.curated || !g.curated.has(id)) return { error: 'That pack is not available for this game.' };
      return { code: packCode };
    }
    if (!this.packs) return { error: 'That pack is not available right now.' };
    if (!g || !g.engine.pack) return { error: `${g ? g.engine.meta.name : 'That game'} does not take packs.` };
    const rec = this.packs.get(packCode);
    if (!rec || rec.gameId !== gameId) return { error: 'That pack code was not found.' };
    return { code: packCode };
  }

  contentFor(gameId, packCode) {
    const g = this.games.get(gameId);
    const cid = curatedIdOf(packCode);
    if (cid) {
      const p = g && g.curated && g.curated.get(cid);
      return p ? p.merged : g ? g.content : {};
    }
    if (this.packs) return this.packs.contentFor(gameId, packCode);
    return g ? g.content : {};
  }

  packInfo(room) {
    const cid = curatedIdOf(room.packCode);
    if (cid) {
      const g = this.games.get(room.gameId);
      const p = g && g.curated && g.curated.get(cid);
      return p ? { code: p.code, title: p.title, emoji: p.emoji, count: p.count, curated: true } : null;
    }
    if (!room.packCode || !this.packs) return null;
    const rec = this.packs.get(room.packCode);
    return rec ? { code: rec.code, title: rec.title, count: rec.items.length, curated: false } : null;
  }

  /* ---------- connections ---------- */

  connect(conn) {
    const c = { conn, room: null, playerId: null, tv: false, box: null, bucket: 40, bucketAt: this.now() };
    return {
      message: (msg) => this.onMessage(c, msg),
      close: () => this.onClose(c),
    };
  }

  send(c, msg) {
    try { c.conn.send(msg); } catch { /* socket already gone */ }
  }

  reply(c, msg, ok) {
    if (msg && msg.id !== undefined) this.send(c, ok === true ? { t: 'ack', id: msg.id } : { t: 'error', id: msg.id, ...ok });
    else if (ok !== true) this.send(c, { t: 'error', ...ok });
  }

  // Token bucket: 20 messages a second, bursts of 40.
  allow(c) {
    const t = this.now();
    c.bucket = Math.min(40, c.bucket + ((t - c.bucketAt) / 1000) * 20);
    c.bucketAt = t;
    if (c.bucket < 1) return false;
    c.bucket -= 1;
    return true;
  }

  onMessage(c, msg) {
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    if (!this.allow(c)) return this.reply(c, msg, { code: 'slow', message: 'Too many taps, slow down a second.' });
    if (msg.t === 'ping') return this.send(c, { t: 'pong', now: this.now() });
    const room = c.room ? this.rooms.get(c.room) : null;
    if (room) room.lastActivity = this.now();
    switch (msg.t) {
      case 'create': return this.reply(c, msg, this.create(c, msg));
      case 'join': return this.reply(c, msg, this.join(c, msg));
      case 'tv': return this.reply(c, msg, this.watch(c, msg));
      case 'peek': return this.reply(c, msg, this.peek(c, msg));
      case 'act': return this.reply(c, msg, this.act(c, msg));
      case 'host': return this.reply(c, msg, this.hostOp(c, msg));
      case 'profile': return this.reply(c, msg, this.profile(c, msg));
      case 'ready': return this.reply(c, msg, this.setReady(c, msg));
      case 'leave': return this.reply(c, msg, this.leave(c));
      case 'drink': return this.reply(c, msg, this.drinkOut(c, msg));
      case 'react': return this.reply(c, msg, this.react(c, msg));
      case 'device': return this.reply(c, msg, this.deviceHello(c, msg));
      case 'press': return this.reply(c, msg, this.boxPress(c));
      case 'longpress': return this.reply(c, msg, this.boxLongPress(c));
      case 'heartbeat': return this.reply(c, msg, this.boxHeartbeat(c));
      default: return this.reply(c, msg, { code: 'bad', message: 'Unknown message.' });
    }
  }

  onClose(c) {
    if (c.box) {
      const room = c.room ? this.rooms.get(c.room) : null;
      if (room && room.box && room.box.c === c) { room.box.c = null; room.box.connected = false; room.box.disconnectedAt = this.now(); }
      if (!c.room && this.pendingBoxes.get(c.box) === c) this.pendingBoxes.delete(c.box);
      c.room = null;
      return;
    }
    const room = c.room ? this.rooms.get(c.room) : null;
    if (!room) return;
    if (c.tv) {
      room.tvs.delete(c);
    } else if (c.playerId) {
      const p = room.players.get(c.playerId);
      if (p) {
        p.sockets.delete(c);
        if (p.sockets.size === 0) {
          p.connected = false;
          p.disconnectedAt = this.now();
          if (room.hostId === p.id) this.armFailover(room);
        }
      }
    }
    c.room = null;
    this.markEmpty(room);
    this.broadcast(room);
  }

  detach(c) {
    if (c.room) this.onClose(c);
  }

  /* ---------- rooms ---------- */

  newCode() {
    for (let i = 0; i < 50; i++) {
      let code = '';
      for (let j = 0; j < CODE_LENGTH; j++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    return null;
  }

  create(c, msg) {
    const game = this.games.get(msg.gameId);
    if (!game) return { code: 'nogame', message: 'That game does not exist.' };
    if (!(game.engine.meta.modes || ['pass', 'room']).includes('room')) {
      return { code: 'nomode', message: `${game.engine.meta.name} is one-phone only.` };
    }
    if (!rt.VARIANTS.includes(msg.variant)) return { code: 'bad', message: 'Pick Standard, Drinking or Deadly.' };
    const name = cleanName(msg.name);
    if (!name) return { code: 'name', message: 'Type your name first.' };
    const packCheck = this.checkPack(msg.gameId, msg.packCode);
    if (packCheck.error) return { code: 'bad', message: packCheck.error };
    if (this.rooms.size >= this.maxRooms) return { code: 'full', message: 'The server is full right now. Try again in a few minutes.' };
    const code = this.newCode();
    if (!code) return { code: 'full', message: 'Could not find a free room code. Try again.' };
    const t = this.now();
    const room = {
      code,
      gameId: game.id,
      variant: msg.variant,
      options: rt.normaliseOptions(game.engine.meta.options, msg.options),
      optionsByGame: {},
      packCode: packCheck.code,
      packByGame: packCheck.code ? { [game.id]: packCheck.code } : {},
      ledger: newLedger({ tier: msg.variant, shotCap: msg.shotCap, now: t }),
      night: newNight(t),
      stage: 'lobby',
      hostId: null,
      players: new Map(),
      tvs: new Set(),
      teams: null,
      forcedAudience: new Set(),
      audienceIds: [],
      box: null,
      state: null,
      createdAt: t,
      lastActivity: t,
      emptySince: null,
      // Play telemetry (see "play telemetry" below): the running game, and
      // counters for the one summary line written when the room closes.
      play: null,
      lobbySince: t,
      tele: { peak: 0, games: 0, finished: 0, rounds: 0, tierDrops: 0 },
      failoverTimer: null,
      deadlineTimer: null,
      seq: 0,
    };
    this.rooms.set(code, room);
    const p = this.addPlayer(room, name, msg.avatar);
    room.hostId = p.id;
    this.bind(c, room, p);
    this.log(`room ${code} created (${game.id}, ${msg.variant})`);
    this.broadcast(room);
    return true;
  }

  addPlayer(room, name, avatar) {
    const used = new Set([...room.players.values()].map((p) => p.color));
    const color = COLORS.find((col) => !used.has(col)) || COLORS[room.players.size % COLORS.length];
    const faces = new Set([...room.players.values()].map((p) => p.avatar));
    const face = AVATARS.includes(avatar) && !faces.has(avatar) ? avatar
      : AVATARS.find((a) => !faces.has(a)) || AVATARS[room.players.size % AVATARS.length];
    const t = this.now();
    const p = {
      id: `p${randomBytes(5).toString('hex')}`,
      token: randomBytes(18).toString('base64url'),
      name,
      color,
      avatar: face,
      ready: false,
      joinedAt: t,
      connectedSince: t,
      connected: false,
      disconnectedAt: t,
      sockets: new Set(),
    };
    room.players.set(p.id, p);
    room.tele.peak = Math.max(room.tele.peak, room.players.size);
    if (room.state) {
      const g = this.games.get(room.gameId);
      room.state = rt.addPlayerTo(g.engine, room.state, p, this.ctx(room));
    }
    return p;
  }

  bind(c, room, p) {
    this.detach(c);
    c.room = room.code;
    c.playerId = p.id;
    c.tv = false;
    if (!p.connected) {
      p.connected = true;
      p.connectedSince = this.now();
    }
    p.sockets.add(c);
    room.emptySince = null;
    this.send(c, { t: 'joined', code: room.code, playerId: p.id, token: p.token });
    // A host who has been gone past the grace period while nobody else was
    // around to take over hands over as soon as someone is.
    const host = room.players.get(room.hostId);
    if (host && !host.connected && this.now() - host.disconnectedAt >= this.hostGraceMs) this.failover(room);
  }

  join(c, msg) {
    const code = typeof msg.code === 'string' ? msg.code.trim().toUpperCase() : '';
    const room = this.rooms.get(code);
    if (!room) return { code: 'noroom', message: `No room called ${code || '?'}. Check the code, or it may have ended.` };
    if (typeof msg.token === 'string' && msg.token) {
      const p = [...room.players.values()].find((x) => x.token === msg.token);
      if (p) {
        this.bind(c, room, p);
        this.broadcast(room);
        return true;
      }
      if (!msg.name) return { code: 'gone', message: 'You are no longer in this room. Join again with your name.' };
    }
    const name = cleanName(msg.name);
    if (!name) return { code: 'name', message: 'Type your name first.' };
    if (room.players.size >= MAX_PLAYERS) return { code: 'full', message: 'This room is full.' };
    const lower = name.toLowerCase();
    if ([...room.players.values()].some((x) => x.name.toLowerCase() === lower)) {
      return { code: 'name', message: `Someone here is already called ${name}. Pick another name.` };
    }
    const p = this.addPlayer(room, name, msg.avatar);
    if (!room.hostId) room.hostId = p.id;
    this.bind(c, room, p);
    this.broadcast(room);
    return true;
  }

  // The join screen shows what you're walking into (game, tier, how many,
  // who's hosting) before you type a name. Public facts only: anyone with
  // the code can already join and see far more.
  peek(c, msg) {
    const code = typeof msg.code === 'string' ? msg.code.trim().toUpperCase() : '';
    const room = this.rooms.get(code);
    if (!room) return { code: 'noroom', message: `No room called ${code || '?'}. Check the code, or it may have ended.` };
    const host = room.players.get(room.hostId);
    this.send(c, { t: 'peeked', code, gameId: room.gameId, variant: room.variant, players: room.players.size, host: host ? host.name : null });
    return true;
  }

  watch(c, msg) {
    const code = typeof msg.code === 'string' ? msg.code.trim().toUpperCase() : '';
    const room = this.rooms.get(code);
    if (!room) return { code: 'noroom', message: `No room called ${code || '?'}.` };
    if (room.tvs.size >= MAX_TVS) return { code: 'full', message: 'Too many screens on this room already.' };
    this.detach(c);
    c.room = room.code;
    c.tv = true;
    c.playerId = null;
    room.tvs.add(c);
    room.emptySince = null;
    this.sendTv(room, c, this.ctx(room));
    return true;
  }

  /* ---------- Host Box device ---------- */
  // docs/HOSTBOX-PROTOCOL.md. A box identifies with its short boxId. With a
  // remembered room code AND a box already approved for that room (by a
  // prior pairBox), it reattaches straight away (reconnect after a wifi
  // blip, or a resumed first-boot setup); otherwise it waits in
  // pendingBoxes for a host to claim it by ID from the lobby's "Add a Host
  // Box" - including the very first time a code-carrying box shows up,
  // since a room code is shared broadly (QR code, invite link) for players
  // to join and must never, by itself, grant Host Box trust to whoever
  // merely knows it.

  deviceHello(c, msg) {
    const boxId = typeof msg.boxId === 'string' ? msg.boxId.trim() : '';
    if (!hostbox.BOX_ID_RE.test(boxId)) return { code: 'bad', message: 'Bad Host Box ID.' };
    if (typeof msg.code === 'string' && msg.code.trim()) {
      const code = msg.code.trim().toUpperCase();
      const room = this.rooms.get(code);
      if (!room) return { code: 'noroom', message: `No room called ${code}.` };
      if (room.box) {
        if (room.box.id === boxId) { this.attachBox(c, room, boxId); return true; }
        return { code: 'paired', message: 'This room already has a different Host Box paired.' };
      }
      // No box approved for this room yet: fall through and wait, exactly
      // like a box with no remembered code at all.
    }
    if (this.pendingBoxes.get(boxId) !== c) this.pendingBoxes.set(boxId, c);
    c.box = boxId;
    c.room = null;
    return true;
  }

  attachBox(c, room, boxId) {
    if (this.pendingBoxes.get(boxId) === c) this.pendingBoxes.delete(boxId);
    c.box = boxId;
    c.room = room.code;
    if (!room.box) {
      room.box = { id: boxId, c: null, slots: new Array(hostbox.MAX_SLOTS).fill(null), asPlayerId: null, connected: false, lastScene: null, lastButtonMode: null, lastMomentId: null, announcedOver: false };
    }
    room.box.id = boxId;
    room.box.c = c;
    room.box.connected = true;
    // A reconnect (wifi blip, or the simulator reloading) is a brand new
    // connection that has never been sent anything: force a fresh scene and
    // button push even if the room's own state has not changed since the
    // last one this box (or its predecessor connection) received.
    room.box.lastScene = null;
    room.box.lastButtonMode = null;
    this.send(c, { t: 'paired', code: room.code });
    this.afterChange(room);
  }

  boxPress(c) {
    const room = c.room ? this.rooms.get(c.room) : null;
    if (!room || !room.box || room.box.c !== c) return { code: 'noroom', message: 'Not paired to a room.' };
    const g = this.games.get(room.gameId);
    const mode = hostbox.buttonModeFor(room, g, this.ctx(room));
    let r = true;
    if (mode.op) {
      r = this.hostOp({ room: room.code, playerId: room.hostId, tv: false }, { op: mode.op, ...(mode.payload || {}) });
    } else if (mode.type) {
      const asId = (mode.asAssigned && room.box.asPlayerId) || room.hostId;
      r = this.act({ room: room.code, playerId: asId, tv: false }, { type: mode.type, payload: mode.payload ?? null });
    } else {
      return true; // idle: nothing to press
    }
    this.send(c, r === true ? { t: 'buttonResult', ok: true } : { t: 'buttonResult', ok: false, message: r.message });
    return true;
  }

  boxLongPress(c) {
    const room = c.room ? this.rooms.get(c.room) : null;
    if (!room || !room.box || room.box.c !== c) return { code: 'noroom', message: 'Not paired to a room.' };
    // The one default binding: the box's long-press hands the host baton to
    // whichever player it is assigned to. (docs/HOSTBOX-PROTOCOL.md)
    const to = room.box.asPlayerId && room.players.get(room.box.asPlayerId);
    if (!to || !to.connected || to.id === room.hostId) return true;
    this.setHost(room, to.id);
    this.log(`room ${room.code}: host -> ${to.id} (Host Box long-press)`);
    this.afterChange(room);
    return true;
  }

  boxHeartbeat(c) {
    const room = c.room ? this.rooms.get(c.room) : null;
    if (room && room.box && room.box.c === c) room.box.lastSeen = this.now();
    return true;
  }

  nameOf(room, id) {
    const p = room.players.get(id);
    return p ? p.name : '';
  }

  // Render and queue `text` for the room's paired box; no-op without one or
  // when Kokoro is unreachable (this.speak resolves null). Fire-and-forget:
  // never blocks the action that triggered it.
  announce(room, text) {
    if (!text || !room.box) return;
    const boxId = room.box.id;
    this.speak(text).then((url) => {
      if (!url) return;
      const cur = this.rooms.get(room.code);
      if (!cur || !cur.box || cur.box.id !== boxId || !cur.box.c) return;
      this.send(cur.box.c, { t: 'audio', url, text });
    }).catch(() => {});
  }

  me(c) {
    const room = c.room ? this.rooms.get(c.room) : null;
    if (!room || c.tv || !c.playerId) return {};
    return { room, p: room.players.get(c.playerId) };
  }

  // A phone re-sends a tap it never saw acknowledged when its socket drops and
  // comes back (public/js/net.js). The repeat carries the same `rid`: answer it
  // the same way and do not apply it, or broadcast, a second time.
  act(c, msg) {
    const { p } = this.me(c);
    const rid = typeof msg.rid === 'string' && msg.rid.length <= 64 ? msg.rid : null;
    if (!p || !rid) return this.applyAct(c, msg);
    if (!p.rids) p.rids = new Map();
    if (p.rids.has(rid)) return p.rids.get(rid);
    const result = this.applyAct(c, msg);
    p.rids.set(rid, result);
    if (p.rids.size > 64) p.rids.delete(p.rids.keys().next().value);
    return result;
  }

  applyAct(c, msg) {
    const { room, p } = this.me(c);
    if (!p) return { code: 'noroom', message: 'You are not in a room.' };
    if (!room.state) return { code: 'lobby', message: 'The game has not started yet.' };
    const g = this.games.get(room.gameId);
    const action = { type: msg.type, payload: msg.payload ?? null, from: p.id, host: room.hostId === p.id };
    const r = rt.applyAction(g.engine, room.state, action, this.ctx(room));
    if (r.error) {
      if (r.detail) this.log(`engine ${room.gameId} threw on ${msg.type}: ${r.detail}`);
      return { code: 'rejected', message: r.error };
    }
    room.state = r.state;
    this.afterChange(room);
    return true;
  }

  hostOp(c, msg) {
    const { room, p } = this.me(c);
    if (!p) return { code: 'noroom', message: 'You are not in a room.' };
    if (room.hostId !== p.id) return { code: 'nothost', message: 'Only the host can do that.' };
    const lobbyOnly = ['setGame', 'setOptions', 'setPack', 'setTeams', 'setAudience'];
    if (lobbyOnly.includes(msg.op) && room.state) return { code: 'ingame', message: 'End the game first to change that.' };
    switch (msg.op) {
      case 'setGame': {
        const g = this.roomGame(msg.gameId);
        if (!g) return { code: 'nogame', message: 'That game is not available.' };
        room.gameId = g.id;
        room.options = rt.normaliseOptions(g.engine.meta.options, room.optionsByGame[g.id] || {});
        room.packCode = room.packByGame[g.id] || null;
        break;
      }
      case 'setPack': {
        const packCheck = this.checkPack(room.gameId, msg.packCode);
        if (packCheck.error) return { code: 'bad', message: packCheck.error };
        room.packCode = packCheck.code;
        room.packByGame[room.gameId] = packCheck.code;
        break;
      }
      case 'setVariant': {
        if (!rt.VARIANTS.includes(msg.variant)) return { code: 'bad', message: 'Pick Standard, Drinking or Deadly.' };
        if (room.state) {
          // Mid-game the tier can only go down, never up.
          if (rt.tierRank(msg.variant) >= rt.tierRank(room.variant)) return { code: 'ingame', message: 'Mid-game the tier can only go down. Raise it between games.' };
          room.state = rt.withDrinkPatch(room.state, { tier: msg.variant });
        }
        this.logTierChange(room, msg.variant);
        room.variant = msg.variant;
        room.ledger = withLedger(room.ledger, { tier: msg.variant });
        break;
      }
      case 'setShotCap':
        this.patchLedger(room, { shotCap: msg.shotCap });
        break;
      case 'setTeams': {
        const g = this.games.get(room.gameId);
        if (!g.engine.meta.teams) return { code: 'noteams', message: `${g.engine.meta.name} does not support teams.` };
        if (msg.teams === null) { room.teams = null; break; }
        const r = validateTeams(msg.teams, room.players);
        if (r.error) return { code: 'bad', message: r.error };
        room.teams = r.teams;
        break;
      }
      case 'setAudience': {
        const target = room.players.get(msg.playerId);
        if (!target) return { code: 'bad', message: 'That player is not in the room.' };
        if (msg.audience) room.forcedAudience.add(target.id);
        else room.forcedAudience.delete(target.id);
        break;
      }
      case 'setOptions': {
        const g = this.games.get(room.gameId);
        room.options = rt.normaliseOptions(g.engine.meta.options, { ...room.options, ...(msg.options || {}) });
        room.optionsByGame[room.gameId] = room.options;
        break;
      }
      case 'start':
      case 'restart': {
        if (msg.op === 'start' && room.state) return { code: 'ingame', message: 'The game is already running.' };
        if (msg.op === 'restart' && !room.state) return { code: 'lobby', message: 'No game is running.' };
        const err = this.startGame(room, room.gameId);
        if (err) return err;
        break;
      }
      case 'end':
        this.stopGame(room, false, 'host-end');
        room.stage = 'lobby';
        break;
      case 'queueAdd': {
        const g = this.roomGame(msg.gameId);
        if (!g) return { code: 'nogame', message: 'That game is not available.' };
        if (room.night.queue.length >= MAX_QUEUE) return { code: 'full', message: `The night already has ${MAX_QUEUE} games lined up.` };
        room.night = { ...room.night, queue: [...room.night.queue, g.id] };
        if (room.stage === 'between' && room.night.queue.length === 1) this.lineUpNext(room);
        break;
      }
      case 'queueRemove': {
        const i = Number(msg.index);
        if (!Number.isInteger(i) || i < 0 || i >= room.night.queue.length) return { code: 'bad', message: 'That game is not in the queue.' };
        room.night = { ...room.night, queue: room.night.queue.filter((_, j) => j !== i) };
        if (room.stage === 'between' && i === 0) this.lineUpNext(room);
        break;
      }
      case 'standings':
        // End the running game (finished or not), fold it into the night and
        // show the standings between games.
        if (!room.state) return { code: 'lobby', message: 'No game is running.' };
        this.stopGame(room, true, 'standings');
        room.stage = 'between';
        this.lineUpNext(room);
        break;
      case 'next': {
        if (room.state) return { code: 'ingame', message: 'Finish this game first.' };
        const queue = room.night.queue.slice();
        let id = typeof msg.gameId === 'string' ? msg.gameId : null;
        if (!id) id = queue.shift();
        else if (queue[0] === id) queue.shift();
        if (!id) return { code: 'bad', message: 'Pick the next game first.' };
        if (!this.roomGame(id)) return { code: 'nogame', message: 'That game is not available.' };
        const err = this.startGame(room, id);
        if (err) return err;
        room.night = { ...room.night, queue };
        break;
      }
      case 'recap':
        if (room.state) this.stopGame(room, true, 'recap');
        if (!room.night.played.length) return { code: 'bad', message: 'Play a game first, then the awards.' };
        room.stage = 'recap';
        this.log(`room ${room.code}: recap after ${room.night.played.length} games`);
        if (room.box) this.announce(room, voice.recap(room.night, (id) => this.nameOf(room, id)));
        break;
      case 'newNight':
        this.stopGame(room, false, 'new-night');
        room.night = newNight(this.now());
        room.ledger = withLedger(room.ledger, { reset: true, now: this.now() });
        room.stage = 'lobby';
        break;
      case 'passHost': {
        const to = room.players.get(msg.to);
        if (!to) return { code: 'bad', message: 'That player is not in the room.' };
        if (!to.connected) return { code: 'offline', message: `${to.name} is offline right now.` };
        this.setHost(room, to.id);
        break;
      }
      case 'kick': {
        if (msg.playerId === p.id) return { code: 'bad', message: 'Use Leave room to leave.' };
        const target = room.players.get(msg.playerId);
        if (!target) return { code: 'bad', message: 'That player is not in the room.' };
        for (const s of target.sockets) {
          this.send(s, { t: 'kicked' });
          s.room = null;
          s.playerId = null;
        }
        this.removePlayer(room, target.id);
        break;
      }
      case 'pairBox': {
        const boxId = typeof msg.boxId === 'string' ? msg.boxId.trim() : '';
        if (!hostbox.BOX_ID_RE.test(boxId)) return { code: 'bad', message: 'Enter the ID printed on the Host Box.' };
        if (room.box && room.box.c) return { code: 'paired', message: 'This room already has a Host Box. Unpair it first.' };
        const conn = this.pendingBoxes.get(boxId);
        if (!conn) return { code: 'notfound', message: 'No Host Box with that ID is waiting to pair. Power it on (or open the simulator) and try again.' };
        this.attachBox(conn, room, boxId);
        break;
      }
      case 'unpairBox': {
        if (!room.box) return { code: 'bad', message: 'No Host Box is paired.' };
        if (room.box.c) {
          this.send(room.box.c, { t: 'unpaired', reason: 'The host unpaired this box.' });
          room.box.c.room = null;
          this.pendingBoxes.set(room.box.id, room.box.c);
        }
        room.box = null;
        break;
      }
      case 'setBoxSlots':
        if (!room.box) return { code: 'bad', message: 'No Host Box is paired.' };
        room.box.slots = hostbox.cleanSlots(msg.slots, [...room.players.keys()]);
        break;
      case 'assignBoxPlayer':
        if (!room.box) return { code: 'bad', message: 'No Host Box is paired.' };
        room.box.asPlayerId = msg.playerId === null || room.players.has(msg.playerId) ? msg.playerId : room.box.asPlayerId;
        break;
      default:
        return { code: 'bad', message: 'Unknown host action.' };
    }
    this.afterChange(room);
    return true;
  }

  roomGame(id) {
    const g = typeof id === 'string' ? this.games.get(id) : null;
    return g && (g.engine.meta.modes || ['pass', 'room']).includes('room') ? g : null;
  }

  // Between games the next queued game becomes the room's game, so the
  // host can set its options (setOptions) before starting it.
  lineUpNext(room) {
    const g = this.roomGame(room.night.queue[0]);
    if (!g) return;
    room.gameId = g.id;
    room.options = rt.normaliseOptions(g.engine.meta.options, room.optionsByGame[g.id] || {});
    room.packCode = room.packByGame[g.id] || null;
  }

  // Start `gameId` with everyone in the room, carrying the night's drink
  // ledger. Anyone past the game's player cap (and anyone the host forced to
  // the crowd) watches as audience instead of a hard "room full" refusal.
  // Returns an error reply or null.
  startGame(room, gameId) {
    const g = this.games.get(gameId);
    const options = gameId === room.gameId ? room.options : rt.normaliseOptions(g.engine.meta.options, room.optionsByGame[gameId] || {});
    const packCode = gameId === room.gameId ? room.packCode : (room.packByGame[gameId] || null);
    const all = [...room.players.values()];
    const ordered = all.filter((p) => !room.forcedAudience.has(p.id)).sort((a, b) => a.joinedAt - b.joinedAt);
    const active = ordered.slice(0, g.engine.meta.maxPlayers);
    const overflow = ordered.slice(g.engine.meta.maxPlayers);
    const audienceList = [...all.filter((p) => room.forcedAudience.has(p.id)), ...overflow];
    const players = active.map(({ id, name, color }) => ({ id, name, color }));
    const audience = g.engine.meta.audience && audienceList.length
      ? audienceList.map(({ id, name, color }) => ({ id, name, color }))
      : null;
    const teams = g.engine.meta.teams ? trimTeams(room.teams, players.map((p) => p.id)) : null;
    if (room.state) room.ledger = room.state.$drink || room.ledger;
    const r = rt.createGame(g.engine, {
      players, variant: room.variant, mode: 'room', options, teams, audience,
      content: this.contentFor(gameId, packCode), rng: this.rng, now: this.now(), drink: room.ledger,
    });
    if (r.error) return { code: 'players', message: r.error };
    if (room.play) this.endPlay(room, 'restart'); // flushes the old run from the old state
    room.gameId = gameId;
    room.options = options;
    room.packCode = packCode;
    room.state = r.state;
    room.stage = 'game';
    for (const pl of room.players.values()) pl.ready = false;
    room.audienceIds = audienceList.map((p) => p.id);
    this.beginPlay(room, players.length, audienceList.length);
    if (room.box) {
      room.box.announcedOver = false;
      this.announce(room, voice.roundStart({ name: g.engine.meta.name, variant: room.variant }));
    }
    return null;
  }

  // Stop the running game. The drink ledger always survives (drinks taken
  // were taken); `archive` also folds its scores and stats into the night.
  stopGame(room, archive, reason = 'stopped') {
    if (!room.state) return;
    this.endPlay(room, reason);
    room.ledger = room.state.$drink || room.ledger;
    if (archive) {
      const g = this.games.get(room.gameId);
      room.night = archiveGame(room.night, { gameId: room.gameId, name: g.engine.meta.name, state: room.state, now: this.now() });
    }
    room.state = null;
  }

  ledger(room) {
    return (room.state && room.state.$drink) || room.ledger;
  }

  patchLedger(room, patch) {
    room.ledger = withLedger(this.ledger(room), patch);
    if (room.state) room.state = rt.withDrinkPatch(room.state, patch);
  }

  // Any player: "I'm out" (or back in). Their drinks become forfeits.
  drinkOut(c, msg) {
    const { room, p } = this.me(c);
    if (!p) return { code: 'noroom', message: 'You are not in a room.' };
    this.patchLedger(room, { out: [p.id, !!msg.out] });
    this.broadcast(room);
    return true;
  }

  // A quick emoji, mostly for the audience: floats across every screen.
  // Platform-only, no game involved; not stored, just fanned straight out.
  react(c, msg) {
    const { room, p } = this.me(c);
    if (!p) return { code: 'noroom', message: 'You are not in a room.' };
    if (!REACTIONS.has(msg.emoji)) return { code: 'bad', message: 'Pick one of the reactions.' };
    const out = { t: 'reaction', from: p.id, emoji: msg.emoji };
    for (const pl of room.players.values()) for (const s of pl.sockets) this.send(s, out);
    for (const s of room.tvs) this.send(s, out);
    return true;
  }

  profile(c, msg) {
    const { room, p } = this.me(c);
    if (!p) return { code: 'noroom', message: 'You are not in a room.' };
    if (msg.name !== undefined) {
      const name = cleanName(msg.name);
      if (!name) return { code: 'name', message: 'Name cannot be empty.' };
      const lower = name.toLowerCase();
      if ([...room.players.values()].some((x) => x.id !== p.id && x.name.toLowerCase() === lower)) {
        return { code: 'name', message: `Someone here is already called ${name}.` };
      }
      p.name = name;
    }
    if (msg.color !== undefined) {
      if (!COLORS.includes(msg.color)) return { code: 'bad', message: 'Pick one of the colours.' };
      p.color = msg.color;
    }
    if (msg.avatar !== undefined) {
      if (!AVATARS.includes(msg.avatar)) return { code: 'bad', message: 'Pick one of the faces.' };
      p.avatar = msg.avatar;
    }
    this.broadcast(room);
    return true;
  }

  // Lobby only: a player says they are ready. Purely a signal for the host;
  // starting never waits on it. Everyone resets when a game starts.
  setReady(c, msg) {
    const { room, p } = this.me(c);
    if (!p) return { code: 'noroom', message: 'You are not in a room.' };
    if (room.state || room.stage === 'between' || room.stage === 'recap') return { code: 'ingame', message: 'Ready only counts in the lobby.' };
    p.ready = !!msg.on;
    this.broadcast(room);
    return true;
  }

  leave(c) {
    const { room, p } = this.me(c);
    if (!p) return true;
    for (const s of p.sockets) { s.room = null; s.playerId = null; }
    this.removePlayer(room, p.id);
    if (this.rooms.has(room.code)) this.afterChange(room);
    return true;
  }

  removePlayer(room, playerId) {
    room.players.delete(playerId);
    room.forcedAudience.delete(playerId);
    if (room.teams) room.teams = room.teams.map((t) => ({ ...t, memberIds: t.memberIds.filter((id) => id !== playerId) }));
    if (room.state) {
      const g = this.games.get(room.gameId);
      room.state = rt.removePlayerFrom(g.engine, room.state, playerId, this.ctx(room));
    }
    if (room.players.size === 0) return this.closeRoom(room, 'Everyone left.', 'all-left');
    if (room.hostId === playerId) {
      room.hostId = null;
      this.failover(room, true);
    }
    this.markEmpty(room);
  }

  /* ---------- host ---------- */

  setHost(room, id) {
    room.hostId = id;
    if (room.failoverTimer) { this.timers.clear(room.failoverTimer); room.failoverTimer = null; }
  }

  armFailover(room) {
    if (room.failoverTimer) this.timers.clear(room.failoverTimer);
    room.failoverTimer = this.timers.set(() => {
      room.failoverTimer = null;
      if (!this.rooms.has(room.code)) return;
      const host = room.players.get(room.hostId);
      if (host && host.connected) return;
      if (this.failover(room)) this.broadcast(room);
    }, this.hostGraceMs);
  }

  // Hand host to the player who has been connected the longest without a
  // break. Returns true if the host changed.
  failover(room, force = false) {
    const host = room.players.get(room.hostId);
    if (host && host.connected && !force) return false;
    const candidates = [...room.players.values()]
      .filter((p) => p.connected && p.id !== room.hostId)
      .sort((a, b) => a.connectedSince - b.connectedSince || a.joinedAt - b.joinedAt);
    if (!candidates.length) {
      // Nobody online: keep the old host (if any) or the earliest joiner.
      if (!room.players.get(room.hostId)) room.hostId = [...room.players.values()][0]?.id || null;
      return false;
    }
    this.setHost(room, candidates[0].id);
    this.log(`room ${room.code}: host -> ${candidates[0].id}`);
    return true;
  }

  /* ---------- state fan-out ---------- */

  ctx(room) {
    return {
      players: [...room.players.values()].map(({ id, name, color }) => ({ id, name, color })),
      content: this.contentFor(room.gameId, room.packCode),
      rng: this.rng,
      now: this.now(),
    };
  }

  afterChange(room) {
    room.lastActivity = this.now();
    this.trackPlay(room);
    if (room.state && room.state.$drink) room.ledger = room.state.$drink;
    if (room.box && room.state) {
      const l = room.state.$drink;
      if (l && l.moment && l.moment.id !== room.box.lastMomentId) {
        room.box.lastMomentId = l.moment.id;
        this.announce(room, voice.deadlyMoment(l.moment, (id) => this.nameOf(room, id)));
      }
      if (room.state.$over && !room.box.announcedOver) {
        room.box.announcedOver = true;
        this.announce(room, voice.gameOver(room.state.$over.board, (id) => this.nameOf(room, id)));
      }
    }
    this.scheduleDeadline(room);
    this.broadcast(room);
  }

  scheduleDeadline(room) {
    if (room.deadlineTimer) { this.timers.clear(room.deadlineTimer); room.deadlineTimer = null; }
    if (!room.state) return;
    const g = this.games.get(room.gameId);
    const d = rt.deadlineOf(g.engine, room.state);
    if (!d) return;
    room.deadlineTimer = this.timers.set(() => {
      room.deadlineTimer = null;
      if (!this.rooms.has(room.code) || !room.state) return;
      const before = room.state;
      room.state = rt.runDeadlines(g.engine, room.state, this.ctx(room));
      if (room.state !== before) this.afterChange(room);
      else this.scheduleDeadline(room);
    }, Math.max(0, d.at - this.now()));
  }

  roomInfo(room) {
    return {
      code: room.code,
      gameId: room.gameId,
      variant: room.variant,
      options: room.options,
      pack: this.packInfo(room),
      hostId: room.hostId,
      phase: room.state ? 'game' : room.stage === 'game' ? 'lobby' : room.stage,
      // Party Night: what is queued, what has been played, the running
      // points and (finished games only) the award stats.
      night: room.night,
      over: !!(room.state && room.state.$over),
      players: [...room.players.values()].map((p) => ({
        id: p.id, name: p.name, color: p.color, avatar: p.avatar, ready: !!p.ready, connected: p.connected, host: p.id === room.hostId,
      })),
      // Ids the running game knows about. Anyone else joined mid-game and
      // watches until the next one, unless the engine took them in.
      inGame: room.state ? this.inGameIds(room) : null,
      // Teams set up for the current game (null = none); who is forced to
      // the crowd by the host; who is actually watching as audience this
      // run (set at the last start, meaningful while a game is running).
      teams: room.teams,
      forcedAudience: [...room.forcedAudience],
      audienceIds: room.state ? room.audienceIds : [],
      box: room.box ? { id: room.box.id, connected: !!room.box.c, slots: room.box.slots, asPlayerId: room.box.asPlayerId } : null,
    };
  }

  inGameIds(room) {
    const s = room.state;
    if (s && Array.isArray(s.players)) return s.players.map((p) => (typeof p === 'string' ? p : p.id));
    return [...room.players.keys()];
  }

  broadcast(room) {
    if (!this.rooms.has(room.code)) return;
    room.seq++;
    const ctx = this.ctx(room);
    const info = this.roomInfo(room);
    const g = this.games.get(room.gameId);
    let actions = [];
    if (room.state) {
      try { actions = rt.hostActionsOf(g.engine, room.state, ctx); } catch (err) { this.log(`hostActions threw: ${err.stack}`); }
    }
    // Platform buttons for the host bar once the game is over.
    const platform = [];
    if (room.state && room.state.$over) {
      const next = room.night.queue[0];
      const ng = next && this.games.get(next);
      platform.push({ op: 'standings', label: ng ? `Standings, then ${ng.engine.meta.name}` : 'Standings', tone: 'primary' });
    }
    const drink = publicDrink(this.ledger(room), ctx.now);
    for (const p of room.players.values()) {
      if (!p.sockets.size) continue;
      let view = null;
      let viewError = null;
      if (room.state) {
        try { view = rt.playerViewOf(g.engine, room.state, p.id, ctx); } catch (err) {
          viewError = String(err.message || err);
          this.log(`playerView threw: ${err.stack}`);
        }
      }
      const msg = {
        t: 'state', seq: room.seq, now: ctx.now, room: { ...info, you: p.id }, view, viewError,
        actions: p.id === room.hostId ? actions : [],
        platform: p.id === room.hostId ? platform : [],
        drink,
      };
      for (const s of p.sockets) this.send(s, msg);
    }
    for (const s of room.tvs) this.sendTv(room, s, ctx, info, drink);
    if (room.box && room.box.c) {
      const deadline = room.state ? rt.deadlineOf(g.engine, room.state) : null;
      const scene = hostbox.sceneFor(room, { drink, deadline, now: ctx.now });
      if (!hostbox.sameDescriptor(scene, room.box.lastScene)) {
        room.box.lastScene = scene;
        this.send(room.box.c, { t: 'scene', ...scene });
      }
      const btn = hostbox.buttonModeFor(room, g, ctx);
      const btnKey = { mode: btn.mode, label: btn.label };
      if (!hostbox.sameDescriptor(btnKey, room.box.lastButtonMode)) {
        room.box.lastButtonMode = btnKey;
        this.send(room.box.c, { t: 'button', mode: btn.mode, label: btn.label });
      }
    }
  }

  sendTv(room, s, ctx, info = this.roomInfo(room), drink = publicDrink(this.ledger(room), ctx.now)) {
    let view = null;
    let viewError = null;
    if (room.state) {
      try { view = rt.tvViewOf(this.games.get(room.gameId).engine, room.state, ctx); } catch (err) {
        viewError = String(err.message || err);
      }
    }
    this.send(s, { t: 'tv', seq: room.seq, now: ctx.now, room: info, view, viewError, drink });
  }

  /* ---------- play telemetry ----------
     Greppable `[rooms]` lines in the journal, key=value, never a name, so
     "audit what we played" has evidence (`npm run plays`, lib/plays.mjs):
       room X game start game= tier= players= audience= tvs= pack= phase= lobby_ms=
       room X phase game= round= phase=<entered> prev=<left> prev_ms=
       room X game over game= round= rounds= ms=          (reached the end)
       room X game end game= reason= rounds= ms= finished= phase= phase_ms=
       room X: tier -> <to> from= game= round= game_ms= room_ms=
       room X summary reason= ms= active_ms= games= finished= rounds= tier_drops= peak_players=
     `rounds` is the engine's own state.round when it has one, else the
     number of passes through the game's first phase. */

  tl(room, text) {
    this.log(`room ${room.code} ${text}`);
  }

  roundOf(room) {
    const s = room.state;
    return s && Number.isInteger(s.round) ? s.round : room.play ? room.play.rounds : 0;
  }

  beginPlay(room, players, audience) {
    const s = room.state;
    const t = this.now();
    room.play = {
      gameId: room.gameId, startedAt: t, phase: s.phase, phaseAt: t, firstPhase: s.phase,
      round: Number.isInteger(s.round) ? s.round : null, rounds: 1, finished: false,
    };
    room.tele.games += 1;
    const pack = !room.packCode ? 'none' : curatedIdOf(room.packCode) ? room.packCode : 'custom';
    this.tl(room, `game start game=${room.gameId} tier=${room.variant} players=${players} audience=${audience} tvs=${room.tvs.size} pack=${pack} phase=${s.phase} lobby_ms=${t - room.lobbySince}`);
  }

  // After every state change: count rounds, and log a phase line when the
  // phase moved (entered, left, and how long the one we left lasted).
  trackPlay(room) {
    const s = room.state;
    const p = room.play;
    if (!s || !p) return;
    const t = this.now();
    if (Number.isInteger(s.round)) {
      if (s.round !== p.round) { p.round = s.round; p.rounds += 1; }
    } else if (s.phase !== p.phase && s.phase === p.firstPhase) {
      p.rounds += 1;
    }
    if (s.phase !== p.phase) {
      this.tl(room, `phase game=${p.gameId} round=${this.roundOf(room)} phase=${s.phase} prev=${p.phase} prev_ms=${t - p.phaseAt}`);
      p.phase = s.phase;
      p.phaseAt = t;
    }
    if (s.$over && !p.finished) {
      p.finished = true;
      room.tele.finished += 1;
      this.tl(room, `game over game=${p.gameId} round=${this.roundOf(room)} rounds=${p.rounds} ms=${t - p.startedAt}`);
    }
  }

  endPlay(room, reason) {
    const p = room.play;
    if (!p) return;
    this.trackPlay(room);
    const t = this.now();
    this.tl(room, `game end game=${p.gameId} reason=${reason} rounds=${p.rounds} ms=${t - p.startedAt} finished=${p.finished ? 1 : 0} phase=${p.phase} phase_ms=${t - p.phaseAt}`);
    room.tele.rounds += p.rounds;
    room.play = null;
    room.lobbySince = t;
  }

  logTierChange(room, to) {
    const t = this.now();
    const p = room.play;
    if (rt.tierRank(to) < rt.tierRank(room.variant)) room.tele.tierDrops += 1;
    this.log(`room ${room.code}: tier -> ${to} from=${room.variant} game=${p ? p.gameId : 'none'} round=${p ? this.roundOf(room) : 0} game_ms=${p ? t - p.startedAt : 0} room_ms=${t - room.createdAt}`);
  }

  logSummary(room, reason) {
    const t = this.now();
    const k = room.tele;
    this.tl(room, `summary reason=${reason} ms=${t - room.createdAt} active_ms=${room.lastActivity - room.createdAt} games=${k.games} finished=${k.finished} rounds=${k.rounds} tier_drops=${k.tierDrops} peak_players=${k.peak}`);
  }

  /* ---------- expiry ---------- */

  socketCount(room) {
    let n = room.tvs.size;
    for (const p of room.players.values()) n += p.sockets.size;
    return n;
  }

  markEmpty(room) {
    if (this.socketCount(room) === 0 && room.emptySince === null) room.emptySince = this.now();
  }

  // Called every minute by the server. Rooms die after emptyTtlMs with
  // nobody connected, or idleTtlMs with no messages at all.
  sweep() {
    const t = this.now();
    for (const room of [...this.rooms.values()]) {
      if (t - room.lastActivity >= this.idleTtlMs) this.closeRoom(room, 'This room timed out after a long quiet spell.', 'idle');
      else if (room.emptySince !== null && t - room.emptySince >= this.emptyTtlMs) this.closeRoom(room, 'Everyone left, so the room closed.', 'empty');
    }
  }

  closeRoom(room, reason, code = 'closed') {
    this.endPlay(room, 'closed');
    this.logSummary(room, code);
    if (room.failoverTimer) this.timers.clear(room.failoverTimer);
    if (room.deadlineTimer) this.timers.clear(room.deadlineTimer);
    const sockets = [...room.tvs];
    for (const p of room.players.values()) sockets.push(...p.sockets);
    for (const s of sockets) {
      this.send(s, { t: 'closed', reason });
      s.room = null;
      s.playerId = null;
    }
    if (room.box && room.box.c) {
      this.send(room.box.c, { t: 'unpaired', reason });
      room.box.c.room = null;
      this.pendingBoxes.set(room.box.id, room.box.c);
    }
    this.rooms.delete(room.code);
    this.log(`room ${room.code} closed: ${reason}`);
  }

  stats() {
    let players = 0;
    for (const r of this.rooms.values()) players += r.players.size;
    return { rooms: this.rooms.size, players };
  }
}
