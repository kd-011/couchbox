// Host Box: the Deadly Host Box's server-side brains. Pure functions only,
// no I/O and no Node APIs, so pairing/scene/button logic is unit testable
// without a real socket. lib/rooms.mjs owns the connection and calls these
// on every broadcast; lib/voice.mjs turns the same events into spoken lines.
// Protocol: docs/HOSTBOX-PROTOCOL.md.
import * as rt from '../games/_kit/runtime.js';

export const MAX_SLOTS = 6;
export const BOX_ID_RE = /^[A-Za-z0-9]{4,12}$/;

// A box's six glasses map to players: slots[i] is a playerId or null.
export function slotOf(slots, playerId) {
  if (!playerId || !slots) return null;
  const i = slots.indexOf(playerId);
  return i === -1 ? null : i;
}

function slotsOf(slots, playerIds) {
  return (playerIds || []).map((id) => slotOf(slots, id)).filter((s) => s !== null);
}

export function cleanSlots(input, playerIds) {
  const ids = new Set(playerIds);
  const out = new Array(MAX_SLOTS).fill(null);
  if (!Array.isArray(input)) return out;
  const seen = new Set();
  for (let i = 0; i < MAX_SLOTS; i++) {
    const id = input[i];
    if (typeof id === 'string' && ids.has(id) && !seen.has(id)) { out[i] = id; seen.add(id); }
  }
  return out;
}

// What the LED ring should show right now. Precedence: the game just ended
// (winner) > a live Deadly moment (roulette or a takeover) > a short
// countdown as a deadline closes > team colours while nothing else is
// happening > idle breathing light.
export function sceneFor(room, { drink = null, deadline = null, now = 0 } = {}) {
  const slots = (room.box && room.box.slots) || [];
  if (room.state && room.state.$over) {
    const board = room.state.$over.board || [];
    const top = board.length ? Math.max(...board.map((r) => r.score)) : 0;
    const winners = board.filter((r) => r.score === top).map((r) => r.id);
    return { name: 'winner', params: { slots: slotsOf(slots, winners) } };
  }
  if (drink && drink.moment) {
    const m = drink.moment;
    if (m.kind === 'water') return { name: 'idle', params: {} };
    if (m.kind === 'roulette' || (m.kind === 'last' && (m.candidates || []).length > 1)) {
      return { name: 'roulette', params: { candidateSlots: slotsOf(slots, m.candidates), landedSlot: slotOf(slots, (m.targets || [])[0]) } };
    }
    return { name: 'deadlyTakeover', params: { slots: slotsOf(slots, m.targets) } };
  }
  if (deadline && Number.isFinite(deadline.at)) {
    const seconds = Math.ceil((deadline.at - now) / 1000);
    if (seconds > 0 && seconds <= 15) return { name: 'countdown', params: { seconds } };
  }
  if (room.teams) {
    return { name: 'teamColours', params: { teams: room.teams.map((t) => ({ color: t.color, slots: slotsOf(slots, t.memberIds) })) } };
  }
  return { name: 'idle', params: {} };
}

// What the arcade button currently does:
//   { mode: 'idle', label: null }                                    nothing to press
//   { mode: 'start'|'next'|'standings', label, op, payload }          a host op, run as the current host
//   { mode: <engine-defined>, label, type, payload, asAssigned }      a game action; asAssigned means
//                                                                      it runs as the box's assigned player, not the host
// An engine may export an optional `boxButton(state, ctx)` returning
// `{ mode, label, action: { type, payload }, asHost }` to claim the button
// for something of its own (the only example today: Quiz Show's buzzer).
// Anything else falls back to the one `tone: 'primary'` host action every
// game already exposes to move its own flow along, with no per-game code.
export function buttonModeFor(room, game, ctx) {
  if (!room.state) {
    if (room.stage === 'between') return { mode: 'next', label: 'Next game', op: 'next', payload: {} };
    if (room.stage === 'recap') return { mode: 'idle', label: null };
    return { mode: 'start', label: 'Start', op: 'start', payload: {} };
  }
  if (room.state.$over) return { mode: 'standings', label: 'Standings', op: 'standings', payload: {} };
  const engine = game.engine;
  if (typeof engine.boxButton === 'function') {
    let custom = null;
    try { custom = engine.boxButton(room.state, ctx); } catch { custom = null; }
    if (custom && custom.action && typeof custom.action.type === 'string') {
      return { mode: custom.mode || 'next', label: custom.label || null, type: custom.action.type, payload: custom.action.payload ?? null, asAssigned: custom.asHost !== true };
    }
  }
  const actions = rt.hostActionsOf(engine, room.state, ctx);
  const primary = actions.find((a) => a.tone === 'primary' && !a.confirm);
  if (primary) return { mode: 'next', label: primary.label, type: primary.type, payload: primary.payload ?? null };
  return { mode: 'idle', label: null };
}

// So the platform only ever sends the box a message when something it cares
// about actually changed.
export function sameDescriptor(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
