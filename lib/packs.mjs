// Custom content packs: a deck of prompts/words/questions for any game whose
// engine exports `pack` (see docs/GAME-MODULES.md). Saved as one JSON file
// per pack under a data dir OUTSIDE the repo (never git, never part of a
// deploy), unlisted by default: anyone with the short code (or a link
// carrying it) can load it, nobody can browse the list. No database, same
// philosophy as everything else here.
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { findProfanity } from './profanity.mjs';
import { makeLimiter } from './ratelimit.mjs';

const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no i l o 0 1 (easy to read and type)
const CODE_LENGTH = 8;
const TITLE_MAX = 60;
const DEFAULT_FIELD_MAX = 60;
const MAX_FILE_BYTES = 120 * 1024;
const PLATFORM_MAX_ITEMS = 400;
const CREATE_WINDOW_MS = 60 * 60_000;
const CREATE_LIMIT_PER_IP = 20;

const FIELD_TYPES = ['text', 'textarea'];

// Used by lib/registry.mjs to validate a game's optional `pack` export at
// load time, the same way it validates `meta`.
export function validatePackSchema(p) {
  const problems = [];
  if (typeof p.label !== 'string' || !p.label) problems.push('pack.label missing');
  if (typeof p.itemLabel !== 'string' || !p.itemLabel) problems.push('pack.itemLabel missing');
  if (!Array.isArray(p.fields) || !p.fields.length) problems.push('pack.fields must be a non-empty array');
  for (const f of p.fields || []) {
    if (!f.key || !f.label) problems.push(`pack field missing key/label: ${JSON.stringify(f)}`);
    if (f.type && !FIELD_TYPES.includes(f.type)) problems.push(`pack field ${f.key}: bad type ${f.type}`);
  }
  if (!Number.isInteger(p.minItems) || p.minItems < 1) problems.push('pack.minItems must be a positive integer');
  if (!Number.isInteger(p.maxItems) || p.maxItems < p.minItems) problems.push('pack.maxItems must be >= minItems');
  if (typeof p.aiHint !== 'string' || !p.aiHint) problems.push('pack.aiHint missing (tells the AI pack maker what to invent)');
  if (typeof p.apply !== 'function') problems.push('pack.apply must be a function(content, items, title)');
  return problems;
}

function codeOk(code) {
  return typeof code === 'string' && /^[a-z0-9]{4,12}$/.test(code);
}

export function makePacks({ dir, games, log = () => {} }) {
  mkdirSync(dir, { recursive: true });
  const limiter = makeLimiter(CREATE_WINDOW_MS);
  // Packs are immutable once created, so the content an engine's pack.apply
  // builds from them never changes either: cache it, since ctx(room) (lib/
  // rooms.mjs) resolves this on every broadcast, not just when a pack is
  // picked.
  const resolved = new Map(); // code -> { gameId, content }

  function fileFor(code) { return join(dir, `${code}.json`); }

  function newCode() {
    for (let i = 0; i < 50; i++) {
      const bytes = randomBytes(CODE_LENGTH);
      let code = '';
      for (let j = 0; j < CODE_LENGTH; j++) code += CODE_ALPHABET[bytes[j] % CODE_ALPHABET.length];
      if (!existsSync(fileFor(code))) return code;
    }
    return null;
  }

  function validateItems(schema, items) {
    if (!Array.isArray(items)) return 'That pack is not shaped right.';
    const maxItems = Math.min(schema.maxItems, PLATFORM_MAX_ITEMS);
    if (items.length < schema.minItems) return `Add at least ${schema.minItems} ${schema.itemLabel}${schema.minItems === 1 ? '' : 's'}.`;
    if (items.length > maxItems) return `${schema.itemLabel}s are capped at ${maxItems} per pack.`;
    for (const it of items) {
      if (!it || typeof it !== 'object') return 'That pack is not shaped right.';
      for (const f of schema.fields) {
        const v = it[f.key];
        if (typeof v !== 'string') return `Every ${schema.itemLabel} needs ${f.label.toLowerCase()}.`;
        if (!f.optional && !v.trim()) return `Every ${schema.itemLabel} needs ${f.label.toLowerCase()}.`;
        const max = f.maxLength || DEFAULT_FIELD_MAX;
        if (v.trim().length > max) return `${f.label} is too long (max ${max} characters).`;
      }
    }
    return null;
  }

  function cleanItems(schema, items) {
    return items.map((it) => Object.fromEntries(schema.fields.map((f) => [f.key, String(it[f.key]).trim().replace(/\s+/g, ' ')])));
  }

  // source: 'custom' (a player built it; rate-limited and counted) or 'ai'
  // (the AI pack maker already rate-limits and cost-caps its own calls).
  function create({ ip, gameId, title, items, source = 'custom' }) {
    const game = games.get(gameId);
    if (!game || !game.engine.pack) return { error: 'That game does not take custom packs.' };
    const schema = game.engine.pack;
    const cleanTitle = String(title || '').trim().replace(/\s+/g, ' ').slice(0, TITLE_MAX) || `${game.engine.meta.name} pack`;
    if (source === 'custom' && ip && !limiter.hit(ip, CREATE_LIMIT_PER_IP)) {
      return { error: 'Too many packs made from this connection in the last hour. Try again later.' };
    }
    const bounded = Array.isArray(items) ? items.slice(0, PLATFORM_MAX_ITEMS + 5) : items;
    const itemsErr = validateItems(schema, bounded);
    if (itemsErr) return { error: itemsErr };
    const clean = cleanItems(schema, bounded);
    const strings = [cleanTitle, ...clean.flatMap((it) => Object.values(it))];
    if (findProfanity(strings)) return { error: "That pack has something in it we can't host. Try different wording." };
    const code = newCode();
    if (!code) return { error: 'Could not generate a pack code. Try again.' };
    const record = { code, gameId, title: cleanTitle, items: clean, source, createdAt: Date.now() };
    const json = JSON.stringify(record);
    if (json.length > MAX_FILE_BYTES) return { error: 'That pack is too big to save. Trim it down a little.' };
    writeFileSync(fileFor(code), json);
    log(`${source} pack ${code} saved for ${gameId} (${clean.length} ${schema.itemLabel}s)`);
    return { pack: record };
  }

  function get(code) {
    if (!codeOk(code)) return null;
    const file = fileFor(code);
    if (!existsSync(file)) return null;
    try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
  }

  // The content a game's engine actually plays with: the pack's items run
  // through that game's own `pack.apply`, or the built-in content.json when
  // no pack (or a dead/foreign one) is in play. Never throws: a stale or
  // tampered pack code degrades to the built-in deck instead of breaking
  // the room.
  function contentFor(gameId, packCode) {
    const game = games.get(gameId);
    if (!packCode || !game || !game.engine.pack) return game ? game.content : {};
    const cached = resolved.get(packCode);
    if (cached) return cached.gameId === gameId ? cached.content : game.content;
    const rec = get(packCode);
    if (!rec || rec.gameId !== gameId) return game.content;
    let content;
    try { content = game.engine.pack.apply(game.content, rec.items, rec.title); } catch { content = game.content; }
    resolved.set(packCode, { gameId, content });
    return content;
  }

  return { create, get, contentFor };
}
