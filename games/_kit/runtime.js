// The one place that drives a game engine. Used by the room server
// (lib/rooms.mjs) and by the pass-and-play runner in the browser
// (public/js/pass.js), so both modes run identical rules.
// Contract: docs/GAME-MODULES.md.

import { TIERS, newLedger, withLedger, beginDrinks, settleDrinks } from './drinks.js';
import { archiveGame } from './night.js';

export { archiveGame };

export const MODES = ['pass', 'room'];
// The variant is the drinking tier: standard | drinking | deadly.
export const VARIANTS = TIERS;

// Fill in defaults and clamp host-chosen options against the engine's schema.
// Unknown keys are dropped, so a client can never smuggle extra state in.
export function normaliseOptions(schema = [], given = {}) {
  const out = {};
  for (const opt of schema) {
    const v = given ? given[opt.key] : undefined;
    if (opt.type === 'stepper') {
      const n = Number(v);
      const ok = Number.isFinite(n) && n >= opt.min && n <= opt.max;
      out[opt.key] = ok ? Math.round(n) : opt.default;
    } else if (opt.type === 'choice') {
      const ok = opt.choices.some((c) => c.value === v);
      out[opt.key] = ok ? v : opt.default;
    } else if (opt.type === 'multi') {
      const allowed = new Set(opt.choices.map((c) => c.value));
      const picked = Array.isArray(v) ? [...new Set(v.filter((x) => allowed.has(x)))] : null;
      out[opt.key] = picked && picked.length ? picked : opt.default.slice();
    } else if (opt.type === 'toggle') {
      out[opt.key] = typeof v === 'boolean' ? v : !!opt.default;
    }
  }
  return out;
}

// players: [{ id, name, color }]
// drink: the night's drink ledger to carry on (tallies, who is out, the shot
// cap); a fresh one is made when omitted.
// teams: [{ id, name, color, memberIds }] | null, audience: [{ id, name,
// color }] | null. Only ever non-null for a game that declares meta.teams /
// meta.audience; the room is responsible for that gating (docs/GAME-MODULES.md).
export function createGame(engine, { players, variant, mode, options, content, rng = Math.random, now = Date.now(), drink = null, shotCap, teams = null, audience = null }) {
  if (!MODES.includes(mode)) throw new Error(`bad mode ${mode}`);
  if (!VARIANTS.includes(variant)) throw new Error(`bad variant ${variant}`);
  const { minPlayers, maxPlayers } = engine.meta;
  if (players.length < minPlayers) return { error: `${engine.meta.name} needs at least ${minPlayers} players.` };
  if (players.length > maxPlayers) return { error: `${engine.meta.name} takes at most ${maxPlayers} players.` };
  const opts = normaliseOptions(engine.meta.options, options);
  const cleanTeams = teams ? teams.map((t) => ({ id: t.id, name: t.name, color: t.color, memberIds: t.memberIds.slice() })) : null;
  const cleanAudience = audience ? audience.map(cleanPlayer) : null;
  const ctx = { players: players.map(cleanPlayer), variant, mode, options: opts, content, rng, now, teams: cleanTeams, audience: cleanAudience };
  const ledger = drink ? withLedger(drink, { tier: variant }) : newLedger({ tier: variant, shotCap, now });
  ledger.now = now;
  ledger.mark = ledger.seq;
  ledger.pending = [];
  // Drink calls belong in act(), not init(): the ledger goes on afterwards.
  const state = engine.init(ctx);
  // Reserved keys the platform relies on; the engine may read but not change them.
  state.mode = mode;
  state.variant = variant;
  state.options = opts;
  state.teams = cleanTeams;
  state.audience = cleanAudience ? cleanAudience.map((p) => p.id) : null;
  state.$drink = ledger;
  return { state };
}

function cleanPlayer(p) {
  return { id: p.id, name: p.name, color: p.color };
}

// action: { type, payload, from: playerId | null, host: boolean, system?: true }
// ctx: { players, content, rng, now }
// Returns { state } on success (a new object), { error } when the engine
// rejected it. The input state is never touched, so a rejected or throwing
// action can never leave a room half-updated.
export function applyAction(engine, state, action, ctx) {
  if (!action || typeof action.type !== 'string' || action.type.length > 40) {
    return { error: 'Bad action.' };
  }
  const draft = structuredClone(state);
  beginDrinks(draft, ctx.now);
  const overBefore = draft.$over;
  let res;
  try {
    res = engine.act(draft, action, ctx);
  } catch (err) {
    return { error: 'That move broke the game engine.', detail: String(err && err.stack || err) };
  }
  if (res && res.error) return { error: res.error };
  draft.mode = state.mode;
  draft.variant = state.variant;
  draft.options = state.options;
  draft.teams = state.teams;
  draft.audience = state.audience;
  // Play carried on past the end (a new round, "Play again"): the game is no
  // longer over until the engine calls gameOver again.
  if (overBefore && draft.$over === overBefore && draft.phase !== state.phase) delete draft.$over;
  settleDrinks(draft, ctx.now);
  return { state: draft };
}

export function deadlineOf(engine, state) {
  if (!state) return null;
  const d = engine.deadline ? engine.deadline(state) : null;
  return d && Number.isFinite(d.at) && typeof d.type === 'string' ? d : null;
}

// Fire every deadline that has passed. Engines may chain timers, so loop,
// but never more than a handful of times per call.
export function runDeadlines(engine, state, ctx) {
  let s = state;
  for (let i = 0; i < 5; i++) {
    const d = deadlineOf(engine, s);
    if (!d || d.at > ctx.now) break;
    const r = applyAction(engine, s, { type: d.type, payload: null, from: null, host: false, system: true }, ctx);
    if (r.error) break;
    s = r.state;
  }
  return s;
}

export function playerViewOf(engine, state, playerId, ctx) {
  return engine.playerView(state, playerId, ctx);
}

export function tvViewOf(engine, state, ctx) {
  return engine.tvView(state, ctx);
}

export function hostActionsOf(engine, state, ctx) {
  const list = engine.hostActions ? engine.hostActions(state, ctx) : [];
  return Array.isArray(list) ? list.filter((a) => a && typeof a.type === 'string') : [];
}

// Pass-and-play only: whose private turn it is, or null for the shared screen.
export function passTurnOf(engine, state, ctx) {
  return engine.passTurn ? engine.passTurn(state, ctx) || null : null;
}

// Roster changes mid-game. Both hooks are optional: without addPlayer a
// late joiner watches until the host starts a new game; without
// removePlayer a departed player just stays in the engine's state.
export function addPlayerTo(engine, state, player, ctx) {
  if (!engine.addPlayer) return state;
  const draft = structuredClone(state);
  beginDrinks(draft, ctx.now);
  try {
    engine.addPlayer(draft, cleanPlayer(player), ctx);
  } catch {
    return state;
  }
  settleDrinks(draft, ctx.now);
  return draft;
}

export function removePlayerFrom(engine, state, playerId, ctx) {
  if (!engine.removePlayer) return state;
  const draft = structuredClone(state);
  beginDrinks(draft, ctx.now);
  try {
    engine.removePlayer(draft, playerId, ctx);
  } catch {
    return state;
  }
  if (draft.audience) draft.audience = draft.audience.filter((id) => id !== playerId);
  settleDrinks(draft, ctx.now);
  return draft;
}

// Platform edits to a running game's drinking (host drops the tier, a player
// says they're out, the shot cap changes). Returns a new state; the tier is
// the variant, so engines see the drop on their next action.
export function withDrinkPatch(state, patch) {
  const base = state.$drink || newLedger({ tier: state.variant });
  const s = { ...state, $drink: withLedger(base, patch) };
  if (patch.tier && VARIANTS.includes(patch.tier)) s.variant = patch.tier;
  return s;
}

// Lower tiers only, for a mid-game drop.
export function tierRank(t) {
  return Math.max(0, VARIANTS.indexOf(t));
}

// A curated pack's content (games/<id>/packs/*.json) over the built-in
// content.json: every top-level key the pack provides replaces the built-in
// one, keys it leaves out keep the built-in deck. A game can override this
// with `curated.apply(content, packContent)` on its engine. Pure, so the
// server (lib/curated.mjs) and pass and play (public/js/packs.js) agree.
export function withCurated(engine, content, packContent) {
  if (!packContent) return content;
  if (engine && engine.curated && typeof engine.curated.apply === 'function') return engine.curated.apply(content, packContent);
  return { ...content, ...packContent };
}
