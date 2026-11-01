// Curated packs: built-in, hand-written themed decks that ship with a game
// in games/<id>/packs/<pack-id>.json (see docs/GAME-MODULES.md). A pack's
// `content` is in the game's own content.json shape and is shallow-merged
// over it (each top-level key it provides replaces the built-in one, keys it
// leaves out keep the built-in deck), so a game needs no code to take one.
//
// Everything here is data-driven from the game's content.json: the shape a
// pack must match, its string length caps, enum values, number ranges and
// per-deck minimums are all learnt from the built-in deck. That keeps "add a
// pack" down to "add a JSON file", and this validator is the safety net for
// every pack of every game (test/curated.test.mjs runs it on all of them).
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { findProfanity } from './profanity.mjs';
import { withCurated } from '../games/_kit/runtime.js';

export const CURATED_PREFIX = 'c:';
export const DEFAULT_MIN_ITEMS = 25;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const TAG_RE = /^[a-z][a-z0-9 ]{0,15}$/;
const TITLE_MAX = 32;
const BLURB_MAX = 100;
const EMOJI_MAX = 16; // UTF-16 units: room for a ZWJ sequence, not for words
const DECK_MIN = 5; // every deck array in a pack, unless the built-in one is smaller
const PACK_FIELDS = new Set(['id', 'title', 'emoji', 'blurb', 'tags', 'order', 'content']);
const IDENTITY_SKIP = new Set(['id', 'key', 'difficulty', 'spicy']);
const EM_DASH = '—';

// c:<pack-id> is a curated pack; custom pack codes are plain [a-z0-9], so the
// two can share every packCode field in rooms and pass and play.
export function curatedCode(id) { return `${CURATED_PREFIX}${id}`; }
export function curatedIdOf(code) {
  if (typeof code !== 'string' || !code.startsWith(CURATED_PREFIX)) return null;
  const id = code.slice(CURATED_PREFIX.length);
  return ID_RE.test(id) ? id : null;
}

// The optional `curated` export on engine.js: { itemLabel, minItems,
// spicyKeys, required, apply, check }. Checked by lib/registry.mjs at load time.
export function validateCuratedSchema(c, content = {}) {
  const problems = [];
  if (!c || typeof c !== 'object') return ['curated must be an object'];
  if (c.minItems !== undefined && (!Number.isInteger(c.minItems) || c.minItems < 1)) problems.push('curated.minItems must be a positive integer');
  for (const k of ['spicyKeys', 'required']) {
    if (c[k] === undefined) continue;
    if (!Array.isArray(c[k]) || c[k].some((x) => typeof x !== 'string')) problems.push(`curated.${k} must be an array of content keys`);
    else for (const x of c[k]) if (!(x in content)) problems.push(`curated.${k}: "${x}" is not a key of content.json`);
  }
  if (c.itemLabel !== undefined && (typeof c.itemLabel !== 'string' || !c.itemLabel)) problems.push('curated.itemLabel must be a word, e.g. "question"');
  for (const k of ['apply', 'check']) if (c[k] !== undefined && typeof c[k] !== 'function') problems.push(`curated.${k} must be a function`);
  return problems;
}

/* ---------- learning the shape from content.json ---------- */

const kindOf = (v) => (Array.isArray(v) ? 'arr' : v === null ? 'null' : typeof v);

function signature(v) {
  const k = kindOf(v);
  return k === 'object' ? `{${Object.keys(v).sort().join(',')}}` : k;
}

// shape: { t: 'str', max, words, enum } | { t: 'num', min, max, int } | { t: 'bool' }
//      | { t: 'arr', of, deck, minLen, maxLen } | { t: 'rec', fields, required } | { t: 'map', of }
function learn(values, { top = false, inItem = false } = {}) {
  const kinds = new Set(values.map(kindOf));
  if (kinds.size !== 1) return { t: 'any' };
  const k = [...kinds][0];
  if (k === 'string') {
    const distinct = new Set(values);
    return {
      t: 'str',
      max: Math.max(12, Math.ceil(Math.max(...values.map((s) => s.length)) * 1.4)),
      words: values.some((s) => /\s/.test(s)),
      enum: distinct.size <= 5 && values.length >= distinct.size * 4 ? [...distinct] : null,
    };
  }
  if (k === 'number') return { t: 'num', min: Math.min(...values), max: Math.max(...values), int: values.every(Number.isInteger) };
  if (k === 'boolean') return { t: 'bool' };
  if (k === 'arr') {
    const elems = values.flat();
    const lens = values.map((a) => a.length);
    return {
      t: 'arr',
      // A deck is an array of things to deal (not an array inside one item,
      // like a quiz question's options or a spyfall location's roles).
      deck: !inItem,
      minLen: Math.min(...lens),
      maxLen: Math.max(...lens),
      of: elems.length ? learn(elems, { inItem: inItem || kindOf(elems[0]) === 'object' }) : { t: 'any' },
    };
  }
  if (k === 'object') {
    const keys = [...new Set(values.flatMap(Object.keys))];
    const vals = values.flatMap(Object.values);
    // A homogeneous object with 3+ entries (categories, say) is a map: a pack
    // brings its own keys. Anything else is a record with fixed keys.
    const sigs = new Set(values.flatMap((o) => Object.values(o).map(signature)));
    if (!top && !inItem && values.length === 1 && keys.length >= 3 && sigs.size === 1) {
      return { t: 'map', of: learn(vals) };
    }
    const fields = {};
    for (const key of keys) fields[key] = learn(values.filter((o) => key in o).map((o) => o[key]), { inItem });
    const required = top ? [] : keys.filter((key) => values.every((o) => key in o));
    return { t: 'rec', fields, required, top };
  }
  return { t: 'any' };
}

/* ---------- checking a pack against it ---------- */

function check(v, shape, path, out) {
  const k = kindOf(v);
  switch (shape.t) {
    case 'str': {
      if (k !== 'string') return out.push(`${path} must be text`);
      const s = v.trim();
      if (!s) return out.push(`${path} is empty`);
      if (s.length > shape.max) out.push(`${path} is too long (${s.length} > ${shape.max} characters)`);
      if (!shape.words && /\s/.test(s)) out.push(`${path} must be one word ("${s}")`);
      if (shape.enum && !shape.enum.includes(v)) out.push(`${path} must be one of ${shape.enum.join(', ')}`);
      return;
    }
    case 'num':
      if (k !== 'number' || !Number.isFinite(v)) return out.push(`${path} must be a number`);
      if (shape.int && !Number.isInteger(v)) out.push(`${path} must be a whole number`);
      if (v < shape.min || v > shape.max) out.push(`${path} must be between ${shape.min} and ${shape.max}`);
      return;
    case 'bool':
      if (k !== 'boolean') out.push(`${path} must be true or false`);
      return;
    case 'arr': {
      if (k !== 'arr') return out.push(`${path} must be a list`);
      if (shape.deck) {
        const min = Math.min(DECK_MIN, shape.minLen);
        if (v.length < min) out.push(`${path} needs at least ${min} entries`);
      } else if (v.length < shape.minLen || v.length > shape.maxLen) {
        out.push(`${path} must have ${shape.minLen === shape.maxLen ? shape.minLen : `${shape.minLen} to ${shape.maxLen}`} entries`);
      }
      v.forEach((x, i) => check(x, shape.of, `${path}[${i}]`, out));
      return;
    }
    case 'map': {
      if (k !== 'object') return out.push(`${path} must be an object`);
      const keys = Object.keys(v);
      if (!keys.length) out.push(`${path} is empty`);
      for (const key of keys) {
        if (!ID_RE.test(key)) out.push(`${path}: key "${key}" must be lowercase a-z, 0-9 and -`);
        check(v[key], shape.of, `${path}.${key}`, out);
      }
      return;
    }
    case 'rec': {
      if (k !== 'object') return out.push(`${path || 'content'} must be an object`);
      for (const key of Object.keys(v)) if (!(key in shape.fields)) out.push(`${path ? `${path}.` : ''}${key} is not part of this game's content`);
      for (const key of shape.required) if (!(key in v)) out.push(`${path}.${key} is missing`);
      for (const key of Object.keys(v)) if (key in shape.fields) check(v[key], shape.fields[key], path ? `${path}.${key}` : key, out);
      return;
    }
    default:
  }
}

const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Walk a pack's content: every deck array, every string, split clean/spicy.
function walk(content, spicyKeys) {
  const decks = [];
  const strings = { clean: [], spicy: [] };
  const ids = [];
  function strs(v, spicy) {
    if (typeof v === 'string') (spicy ? strings.spicy : strings.clean).push(v);
    else if (Array.isArray(v)) v.forEach((x) => strs(x, spicy));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (k === 'id' && typeof x === 'string') ids.push(x); strs(x, spicy); }
  }
  function visit(v, path, spicy) {
    if (Array.isArray(v)) {
      decks.push({ path, items: v, spicy });
      v.forEach((it) => strs(it, spicy || !!(it && it.spicy === true)));
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) visit(x, path ? `${path}.${k}` : k, spicy || (!path && spicyKeys.includes(k)));
    } else strs(v, spicy);
  }
  visit(content, '', false);
  return { decks, strings, ids };
}

function identity(it) {
  if (typeof it === 'string') return norm(it);
  if (it && typeof it === 'object') {
    return Object.entries(it).filter(([k, v]) => typeof v === 'string' && !IDENTITY_SKIP.has(k)).map(([, v]) => norm(v)).join(' | ');
  }
  return JSON.stringify(it);
}

// Number of things to deal: entries of every deck array (not the fields or
// options inside one entry).
export function countItems(content, { spicyKeys = [], clean = false } = {}) {
  const { decks } = walk(content || {}, spicyKeys);
  return decks.reduce((n, d) => n + (clean && d.spicy ? 0 : clean ? d.items.filter((it) => !(it && it.spicy === true)).length : d.items.length), 0);
}

const shapeCache = new WeakMap();
function shapeFor(builtin) {
  if (!shapeCache.has(builtin)) shapeCache.set(builtin, learn([builtin], { top: true }));
  return shapeCache.get(builtin);
}

export function validateCuratedPack(engine, builtin, fileId, raw) {
  const out = [];
  const cfg = engine.curated || {};
  const spicyKeys = cfg.spicyKeys || [];
  if (!ID_RE.test(fileId)) out.push(`file name "${fileId}" must be lowercase a-z, 0-9 and - (it is the pack id)`);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [...out, 'a pack must be a JSON object'];
  for (const k of Object.keys(raw)) if (!PACK_FIELDS.has(k)) out.push(`unknown field "${k}" (extra fields are not allowed)`);
  if (raw.id !== fileId) out.push(`id "${raw.id}" must equal the file name "${fileId}"`);
  const text = (k, max) => {
    if (typeof raw[k] !== 'string' || !raw[k].trim()) out.push(`${k} missing`);
    else if (raw[k].length > max) out.push(`${k} is too long (${raw[k].length} > ${max} characters)`);
  };
  text('title', TITLE_MAX);
  text('blurb', BLURB_MAX);
  if (typeof raw.emoji !== 'string' || !raw.emoji.trim() || raw.emoji.length > EMOJI_MAX || /[a-z0-9]/i.test(raw.emoji)) out.push('emoji must be one emoji');
  if (raw.tags !== undefined && (!Array.isArray(raw.tags) || raw.tags.length > 4 || raw.tags.some((t) => typeof t !== 'string' || !TAG_RE.test(t)))) {
    out.push('tags must be up to 4 short lowercase words');
  }
  if (raw.order !== undefined && !Number.isFinite(raw.order)) out.push('order must be a number');
  const content = raw.content;
  if (!content || typeof content !== 'object' || Array.isArray(content) || !Object.keys(content).length) {
    out.push('content must be an object with at least one deck from content.json');
    return out;
  }
  check(content, shapeFor(builtin), '', out);
  for (const k of cfg.required || []) if (!(k in content)) out.push(`content.${k} is required for this game`);

  const { decks, strings, ids } = walk(content, spicyKeys);
  // Duplicates anywhere in the pack (the same word in two categories counts).
  const seen = new Map();
  for (const d of decks) {
    d.items.forEach((it, i) => {
      const key = identity(it);
      if (!key) return;
      if (seen.has(key)) out.push(`duplicate: ${d.path}[${i}] repeats ${seen.get(key)} ("${key.slice(0, 50)}")`);
      else seen.set(key, `${d.path}[${i}]`);
    });
    const keyed = d.items.filter((it) => it && typeof it === 'object' && typeof it.key === 'string').map((it) => it.key);
    if (new Set(keyed).size !== keyed.length) out.push(`duplicate key in ${d.path}`);
  }
  // ids must be unique across the whole merged deck (Quiz Show tracks used ids globally).
  const mergedIds = [...ids];
  const merged = withCurated(engine, builtin, content);
  for (const [k, v] of Object.entries(merged)) if (!(k in content)) mergedIds.push(...walk({ [k]: v }, []).ids);
  const dupIds = mergedIds.filter((x, i) => mergedIds.indexOf(x) !== i);
  if (dupIds.length) out.push(`duplicate id ${[...new Set(dupIds)].slice(0, 3).join(', ')}`);

  const meta = [raw.title, raw.blurb, ...(raw.tags || [])].filter((s) => typeof s === 'string');
  const all = [...meta, ...strings.clean, ...strings.spicy];
  const dashed = all.find((s) => s.includes(EM_DASH));
  if (dashed) out.push(`em dash in "${dashed.slice(0, 60)}" (use a comma, colon or full stop)`);
  const dirty = findProfanity([...meta, ...strings.clean]);
  if (dirty) out.push(`profanity outside spicy material: "${dirty.slice(0, 60)}"`);

  const min = cfg.minItems || DEFAULT_MIN_ITEMS;
  const spicyOnly = Object.keys(content).every((k) => spicyKeys.includes(k));
  const n = countItems(content, { spicyKeys, clean: !spicyOnly });
  if (n < min) out.push(`needs at least ${min} ${spicyOnly ? '' : 'non-spicy '}items, has ${n}`);
  if (typeof cfg.check === 'function') {
    try { out.push(...(cfg.check(merged, content) || [])); } catch (err) { out.push(`curated.check threw: ${err.message}`); }
  }
  return out;
}

// Reads and validates games/<id>/packs/*.json. A bad pack is reported and
// left out; it never takes the game (or the site) down with it.
export function loadCurated(dir, engine, builtin) {
  const packs = new Map();
  const problems = [];
  const packDir = join(dir, 'packs');
  if (!existsSync(packDir)) return { packs, problems };
  const cfg = engine.curated || {};
  const files = readdirSync(packDir).filter((f) => f.endsWith('.json')).sort();
  for (const f of files) {
    const fileId = f.slice(0, -5);
    let raw;
    try { raw = JSON.parse(readFileSync(join(packDir, f), 'utf8')); } catch (err) { problems.push(`packs/${f}: not valid JSON (${err.message})`); continue; }
    const p = validateCuratedPack(engine, builtin, fileId, raw);
    if (p.length) { problems.push(...p.map((x) => `packs/${f}: ${x}`)); continue; }
    const spicyKeys = cfg.spicyKeys || [];
    packs.set(fileId, {
      id: fileId,
      code: curatedCode(fileId),
      title: raw.title.trim(),
      emoji: raw.emoji.trim(),
      blurb: raw.blurb.trim(),
      tags: raw.tags || [],
      order: Number.isFinite(raw.order) ? raw.order : 100,
      spicy: countItems(raw.content, { spicyKeys }) > countItems(raw.content, { spicyKeys, clean: true }),
      count: countItems(raw.content, { spicyKeys }),
      content: raw.content,
      merged: withCurated(engine, builtin, raw.content),
    });
  }
  const sorted = [...packs.values()].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  return { packs: new Map(sorted.map((p) => [p.id, p])), problems };
}

// What /games/<id>/packs.json serves (and the service worker precaches):
// the catalogue plus each pack's own content, one request per game.
export function curatedBundle(game) {
  const spicyKeys = (game.engine.curated && game.engine.curated.spicyKeys) || [];
  return {
    builtinCount: countItems(game.content, { spicyKeys, clean: true }),
    packs: [...(game.curated || new Map()).values()].map(({ id, code, title, emoji, blurb, tags, spicy, count, content }) => ({
      id, code, title, emoji, blurb, tags, spicy, count, content,
    })),
  };
}
