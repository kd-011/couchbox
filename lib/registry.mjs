// Game auto-discovery. Every folder in games/ whose name does not start with
// '_' or '.' is a game: games/<id>/engine.js + client.js + content.json +
// rules.md (+ optional style.css). Adding a game never touches this file.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validatePackSchema } from './packs.mjs';
import { validateCuratedSchema, loadCurated, curatedBundle } from './curated.mjs';

export const SERVABLE = new Set(['.js', '.json', '.css', '.md', '.svg', '.png', '.webp', '.jpg']);
// The kind tags a game card can carry; the home page's filter chips mirror them.
export const VIBES = ['bluff', 'brain', 'silly'];
const REQUIRED_FNS = ['init', 'act', 'playerView', 'tvView', 'hostActions', 'bot'];

export function validateEngine(id, engine) {
  const problems = [];
  const m = engine.meta;
  if (!m || typeof m !== 'object') return ['missing export meta'];
  if (m.id !== id) problems.push(`meta.id "${m.id}" must equal the folder name "${id}"`);
  for (const k of ['name', 'emoji', 'tagline']) if (typeof m[k] !== 'string' || !m[k]) problems.push(`meta.${k} missing`);
  if (!Number.isInteger(m.minPlayers) || !Number.isInteger(m.maxPlayers) || m.minPlayers < 1 || m.maxPlayers < m.minPlayers) {
    problems.push('meta.minPlayers/maxPlayers invalid');
  }
  if (!m.variants || ['standard', 'drinking', 'deadly'].some((k) => typeof m.variants[k] !== 'string' || !m.variants[k])) {
    problems.push('meta.variants.standard, .drinking and .deadly (one line each) required');
  }
  if (m.options && !Array.isArray(m.options)) problems.push('meta.options must be an array');
  if (m.pitch !== undefined && (typeof m.pitch !== 'string' || !m.pitch || m.pitch.length > 60)) problems.push('meta.pitch must be a short line (60 characters at most)');
  if (m.minutes !== undefined && !(Array.isArray(m.minutes) && m.minutes.length === 2 && m.minutes.every(Number.isInteger) && m.minutes[0] >= 3 && m.minutes[0] <= m.minutes[1] && m.minutes[1] <= 120)) problems.push('meta.minutes must be [low, high] whole minutes');
  if (m.vibes !== undefined && (!Array.isArray(m.vibes) || m.vibes.some((v) => !VIBES.includes(v)))) problems.push(`meta.vibes must be a list of: ${VIBES.join(', ')}`);
  if (m.howto !== undefined && (!Array.isArray(m.howto) || m.howto.some((x) => typeof x !== 'string' || !x))) problems.push('meta.howto must be an array of short strings');
  for (const opt of m.options || []) {
    if (!opt.key || !opt.label) problems.push(`option missing key/label: ${JSON.stringify(opt)}`);
    if (!['stepper', 'choice', 'multi', 'toggle'].includes(opt.type)) problems.push(`option ${opt.key}: bad type ${opt.type}`);
    if (opt.default === undefined) problems.push(`option ${opt.key}: default required`);
  }
  for (const fn of REQUIRED_FNS) if (typeof engine[fn] !== 'function') problems.push(`export function ${fn} missing`);
  if (engine.pack) problems.push(...validatePackSchema(engine.pack).map((p) => `pack: ${p}`));
  return problems;
}

// packs/ holds the curated packs: they are served folded into one bundle,
// /games/<id>/packs.json (lib/curated.mjs), not file by file.
function listFiles(dir, base = '') {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || (!base && name === 'packs')) continue;
    const full = join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    if (statSync(full).isDirectory()) out.push(...listFiles(full, rel));
    else if (SERVABLE.has(extname(name)) && !/\.test\.m?js$/.test(name)) out.push(rel);
  }
  return out;
}

export async function loadGame(gamesDir, id) {
  const dir = join(gamesDir, id);
  const engine = await import(pathToFileURL(join(dir, 'engine.js')).href);
  const problems = validateEngine(id, engine);
  if (!existsSync(join(dir, 'client.js'))) problems.push('client.js missing');
  if (!existsSync(join(dir, 'rules.md'))) problems.push('rules.md missing');
  if (problems.length) throw new Error(`games/${id}: ${problems.join('; ')}`);
  const contentPath = join(dir, 'content.json');
  const content = existsSync(contentPath) ? JSON.parse(readFileSync(contentPath, 'utf8')) : {};
  if (engine.curated !== undefined) {
    const p = validateCuratedSchema(engine.curated, content);
    if (p.length) throw new Error(`games/${id}: ${p.join('; ')}`);
  }
  const { packs: curated, problems: curatedProblems } = loadCurated(dir, engine, content);
  const files = listFiles(dir);
  if (curated.size) files.push('packs.json');
  const game = {
    id,
    engine,
    content,
    rules: readFileSync(join(dir, 'rules.md'), 'utf8'),
    files,
    style: existsSync(join(dir, 'style.css')),
    curated,
    curatedProblems,
  };
  game.curatedJson = curated.size ? JSON.stringify(curatedBundle(game)) : null;
  return game;
}

// Returns Map<id, game>. A broken game is logged and skipped so one bad
// folder can't take the whole site down; test/contract.test.mjs fails on it.
export async function loadGames(gamesDir, { strict = false, include = [] } = {}) {
  const games = new Map();
  const ids = readdirSync(gamesDir)
    .filter((n) => (!n.startsWith('_') && !n.startsWith('.')) || include.includes(n))
    .filter((n) => statSync(join(gamesDir, n)).isDirectory());
  for (const id of ids) {
    try {
      const g = await loadGame(gamesDir, id);
      for (const p of g.curatedProblems) console.error(`[games] ${id}: skipped curated pack, ${p}`);
      games.set(id, g);
    } catch (err) {
      if (strict) throw err;
      console.error(`[games] skipped ${id}: ${err.message}`);
    }
  }
  return games;
}

// What the browser gets at /games/index.json: enough to draw the picker and
// set-up screens and to precache every game for offline pass-and-play.
export function publicIndex(games) {
  return [...games.values()]
    .map(({ id, engine, files, style, curated }) => {
      const m = engine.meta;
      return {
        id,
        name: m.name,
        emoji: m.emoji,
        tagline: m.tagline,
        blurb: m.blurb || '',
        pitch: m.pitch || m.tagline,
        minutes: Array.isArray(m.minutes) ? m.minutes : null,
        vibes: Array.isArray(m.vibes) ? m.vibes : [],
        minPlayers: m.minPlayers,
        maxPlayers: m.maxPlayers,
        modes: m.modes || ['pass', 'room'],
        variants: m.variants,
        options: m.options || [],
        teams: !!m.teams,
        audience: !!m.audience,
        order: Number.isFinite(m.order) ? m.order : 100,
        accent: m.accent || null,
        howto: Array.isArray(m.howto) ? m.howto.filter((x) => typeof x === 'string').slice(0, 4) : [],
        style,
        files: files.map((f) => `/games/${id}/${f}`),
        curated: curated ? curated.size : 0,
        packNoun: (engine.pack && engine.pack.itemLabel) || (engine.curated && engine.curated.itemLabel) || 'card',
        pack: engine.pack ? {
          label: engine.pack.label, itemLabel: engine.pack.itemLabel, fields: engine.pack.fields,
          minItems: engine.pack.minItems, maxItems: engine.pack.maxItems,
        } : null,
      };
    })
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}
