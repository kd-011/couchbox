import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { WebSocketServer } from 'ws';
import qrcode from 'qrcode-generator';
import { loadGames, publicIndex, SERVABLE } from './lib/registry.mjs';
import { RoomManager } from './lib/rooms.mjs';
import { makeTts } from './lib/tts.mjs';
import { makePacks } from './lib/packs.mjs';
import { makeAiPackMaker } from './lib/ai-packs.mjs';
import { makeTestHooks } from './lib/testhooks.mjs';
import { lanAddress, lanBanner, isLoopbackHost, isPlainHttpHost } from './lib/lan.mjs';
import { renderMarkdown } from './public/js/markdown.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');
const GAMES = join(ROOT, 'games');

// Normally we only listen on 127.0.0.1, so every request comes through cloudflared, which sets
// CF-Connecting-IP to the real client address. With --lan the socket address is the real one.
function clientIp(req) {
  return String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '?');
}

const envFile = join(ROOT, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const PORT = Number(process.env.GAMES_PORT || 8969);
// --lan (and the party-games command) listens on the network so phones in the room can join.
const LAN = process.argv.includes('--lan');
const HOST = process.env.GAMES_HOST || (LAN ? '0.0.0.0' : '127.0.0.1');
// Public URL of this site, used for canonical links, the sitemap, share
// cards and QR codes. Unset, it is read off each request's Host header, so a
// fresh clone and any host it is deployed to just work.
const SITE_URL = String(process.env.GAMES_SITE_URL || '').replace(/\/+$/, '');
// A browser on this computer has to move to the network address, or its QR codes and links say
// localhost and no phone can open them.
const LAN_ADDRESS = LAN ? lanAddress() : null;
// Shown on the privacy and credits pages. Set it to your own address if you host a copy.
const CONTACT_EMAIL = process.env.GAMES_CONTACT_EMAIL || 'games@example.com';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

// No PIN, no login, no database: a public, no-accounts party game site.
// Pass-and-play lives entirely in the browser. Own-device rooms live in this
// process's memory only (lib/rooms.mjs) and vanish on restart or expiry.

// GAMES_EXAMPLE=1 also lists the High Card example from games/_example
// (local development and e2e only; never set in production).
const games = await loadGames(GAMES, { include: process.env.GAMES_EXAMPLE === '1' ? ['_example'] : [] });
const gameIndex = JSON.stringify({ games: publicIndex(games) });
const VOICE_DIR = join(ROOT, 'data', 'hostbox-voice');
const tts = makeTts({ cacheDir: VOICE_DIR, log: (m) => console.log(m) });

// Custom/AI content packs: saved outside the repo (never git, never part of
// a deploy), so they survive restarts without ever becoming a database.
const PACKS_DIR = process.env.GAMES_PACKS_DIR || join(homedir(), '.local', 'share', 'games-packs');
const packs = makePacks({ dir: PACKS_DIR, games, log: (m) => console.log(`[packs] ${m}`) });
const aiPacks = makeAiPackMaker({
  spendFile: join(PACKS_DIR, 'ai-pack-spend.json'),
  apiKey: process.env.OPENROUTER_API_KEY || '',
  model: process.env.GAMES_AI_PACK_MODEL || 'google/gemini-3.8-flash',
  dailyCapUsd: Number(process.env.GAMES_AI_PACK_DAILY_CAP_USD) || 0.5,
  // Sent to OpenRouter as HTTP-Referer for app attribution, when set.
  referer: process.env.GAMES_AI_REFERER ?? '',
  games, packs, log: (m) => console.log(`[ai-packs] ${m}`),
});

const rooms = new RoomManager({
  games, packs, log: (m) => console.log(`[rooms] ${m}`),
  speak: (text) => tts.say(text).then((file) => (file ? `/hostbox/voice/${file}` : null)),
});
setInterval(() => rooms.sweep(), 60_000).unref();
// QA only (e2e/matrix.mjs): never set in production, see lib/testhooks.mjs.
const testHooks = process.env.GAMES_TEST_HOOKS === '1' ? makeTestHooks({ rooms, games }) : null;

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
function sendJson(res, status, body) { send(res, status, JSON.stringify(body), JSON_HEADERS); }

// Small, size-capped JSON body reader for the packs API. No streaming
// uploads anywhere else in this app, so this is the only place that needs it.
function readJsonBody(req, maxBytes, cb) {
  let size = 0;
  const chunks = [];
  let failed = false;
  req.on('data', (chunk) => {
    if (failed) return;
    size += chunk.length;
    if (size > maxBytes) { failed = true; cb(new Error('too large')); req.destroy(); return; }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (failed) return;
    try { cb(null, JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (err) { cb(err); }
  });
  req.on('error', (err) => { if (!failed) { failed = true; cb(err); } });
}

function packsApi(req, res, pathname) {
  if (pathname === '/api/packs') {
    readJsonBody(req, 80 * 1024, (err, body) => {
      if (err || !body || typeof body.gameId !== 'string') return sendJson(res, 400, { error: 'Bad request.' });
      const r = packs.create({ ip: clientIp(req), gameId: body.gameId, title: body.title, items: body.items });
      if (r.error) return sendJson(res, 400, { error: r.error });
      sendJson(res, 200, { pack: r.pack });
    });
    return true;
  }
  if (pathname === '/api/packs/ai') {
    readJsonBody(req, 4 * 1024, (err, body) => {
      if (err || !body || typeof body.gameId !== 'string') return sendJson(res, 400, { error: 'Bad request.' });
      aiPacks.generate({ ip: clientIp(req), gameId: body.gameId, theme: body.theme })
        .then((r) => {
          if (r.error) return sendJson(res, r.error === 'unavailable' ? 503 : 400, { error: r.error, message: r.message });
          sendJson(res, 200, { pack: r.pack });
        })
        .catch((e) => { console.error('[ai-packs] generate threw', e); sendJson(res, 500, { error: 'bad', message: 'Something went wrong. Try again.' }); });
    });
    return true;
  }
  const getOne = /^\/api\/packs\/([a-z0-9]{4,12})$/.exec(pathname);
  if (getOne && req.method === 'GET') {
    const rec = packs.get(getOne[1]);
    sendJson(res, rec ? 200 : 404, rec ? { pack: rec } : { error: 'Not found.' });
    return true;
  }
  return false;
}

const ROOM_ROUTE = /^\/(r|tv)\/([A-Za-z]{4})\/?$/;

function safeJoin(base, requestPath) {
  let decoded;
  try { decoded = decodeURIComponent(requestPath); } catch { return null; }
  const normalized = normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, '');
  const full = join(base, normalized);
  if (!full.startsWith(base + sep) && full !== base) return null;
  return full;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function cacheHeaders(ext) {
  // Static code is fetched by plain URL; never let an edge or browser serve
  // a stale script or stylesheet across a deploy.
  if (['.js', '.css', '.json', '.md', '.html', '.webmanifest'].includes(ext)) return { 'Cache-Control': 'no-cache' };
  if (['.png', '.svg', '.webp', '.jpg', '.woff2'].includes(ext)) return { 'Cache-Control': 'public, max-age=86400' };
  return {};
}

// Pages and robots.txt carry {{origin}}, {{host}} and {{contact}} placeholders
// instead of a hard-coded domain, filled in here for each request.
function brand(req, text) {
  const origin = publicOrigin(req);
  return text.replaceAll('{{origin}}', origin).replaceAll('{{host}}', origin.replace(/^https?:\/\//, '')).replaceAll('{{contact}}', CONTACT_EMAIL);
}

function sendFile(req, res, filePath, status = 200, transform = null) {
  const ext = extname(filePath);
  let body = readFileSync(filePath);
  if (ext === '.html' || ext === '.txt') body = brand(req, body.toString('utf8'));
  if (transform) body = transform(typeof body === 'string' ? body : body.toString('utf8'));
  send(res, status, req.method === 'HEAD' ? null : body, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    ...cacheHeaders(ext),
  });
}

function notFound(req, res) {
  const p = join(PUBLIC, '404.html');
  if (existsSync(p)) return sendFile(req, res, p, 404);
  return send(res, 404, 'Not found');
}

function publicOrigin(req) {
  if (SITE_URL) return SITE_URL;
  const host = String(req.headers.host || `localhost:${PORT}`).replace(/[^A-Za-z0-9.:-]/g, '');
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  if (proto === 'http' || proto === 'https') return `${proto}://${host}`;
  return `${isPlainHttpHost(host) ? 'http' : 'https'}://${host}`;
}

function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  }
  const size = n + quiet * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR code to join the room"><rect width="${size}" height="${size}" fill="#fff"/><path fill="#0e0a16" d="${d}"/></svg>`;
}

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Static, crawlable rules page per game: /games/<id>. Built once per game at
// startup from its meta + rules.md, the same content the in-app rules sheet
// shows, so there is one source of truth for how to play.
const BACK_ICON = '<svg class="i" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';

// Readable text on a game's colour: ink or white (same rule as ui.inkFor).
function inkFor(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return '#140c1f';
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (L + 0.05) / 0.0573 >= 1.05 / (L + 0.05) ? '#140c1f' : '#ffffff';
}

function gamePageHtml(origin, game) {
  const m = game.engine.meta;
  const accent = /^#[0-9a-f]{6}$/i.test(m.accent || '') ? m.accent : '#9d7bff';
  const url = `${origin}/games/${game.id}`;
  const title = `${escHtml(m.name)}: how to play | Games`;
  const desc = escHtml(m.blurb || m.tagline);
  const icon = game.files.includes('icon.svg')
    ? `<img class="game-ico" src="/games/${game.id}/icon.svg" width="50" height="50" alt="">`
    : `<span class="game-emoji" style="font-size:44px" aria-hidden="true">${m.emoji}</span>`;
  const modeChips = [
    m.modes.includes('pass') ? '<span class="pill">One phone</span>' : '',
    m.modes.includes('room') ? '<span class="pill">Everyone’s phone + TV</span>' : '',
  ].join('');
  const ld = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Game',
    name: m.name,
    description: m.blurb || m.tagline,
    genre: 'Party game',
    numberOfPlayers: `${m.minPlayers}-${m.maxPlayers}`,
    url,
  });
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${desc}">
<meta name="robots" content="index,follow">
<meta name="theme-color" content="#0b0812">
<link rel="canonical" href="${url}">

<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${origin}/og-image.png">
<meta property="og:image:alt" content="Games: ${escHtml(m.name)}">
<meta property="og:site_name" content="Games">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${origin}/og-image.png">

<link rel="preload" href="/fonts/bricolage.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/style.css">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<script type="application/ld+json">${ld}</script>
</head>
<body>
<div id="app">
  <div class="screen prose" style="--accent:${accent};--accent-ink:${inkFor(accent)}">
    <header class="topbar"><a class="icon-btn" href="/" aria-label="Back to games" title="Back to games">${BACK_ICON}</a></header>
    <div class="seo-hero">
      <span class="game-row-ico">${icon}</span>
      <div><h1>${escHtml(m.name)}</h1><p>${escHtml(m.tagline)}</p></div>
    </div>
    <p>${desc}</p>
    <div class="chips seo-meta">
      <span class="pill">${m.minPlayers}-${m.maxPlayers} players</span>
      ${modeChips}
    </div>
    <a class="btn btn-primary btn-xl seo-cta" href="/#/new/${game.id}">Play ${escHtml(m.name)} free</a>
    <h2>Standard</h2>
    <p>${escHtml(m.variants.standard)}</p>
    <h2>Drinking</h2>
    <p>${escHtml(m.variants.drinking)}</p>
    <h2>Deadly (shots)</h2>
    <p>${escHtml(m.variants.deadly || '')} Shots are rare, announced moments with a per-player hourly cap, and anyone can swap their drinks for forfeits.</p>
    <h2>How to play</h2>
    <div class="rules">${renderMarkdown(game.rules.replace(/^#[^\n]*\n/, ''), escHtml)}</div>
    <div class="seo-foot">
      <a class="btn btn-secondary" href="/">Browse all games</a>
    </div>
  </div>
</div>
</body>
</html>
`;
}

function sitemapXml(origin) {
  const entry = (path, freq, prio) => `  <url><loc>${origin}${path}</loc><changefreq>${freq}</changefreq><priority>${prio}</priority></url>\n`;
  const pages = [
    entry('/', 'monthly', '1.0'),
    entry('/credits', 'yearly', '0.3'),
    entry('/privacy', 'yearly', '0.3'),
    ...[...games.keys()].sort().map((id) => entry(`/games/${id}`, 'monthly', '0.6')),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.join('')}</urlset>\n`;
}

const REMOVED_GAMES = new Set(['kings', 'higher-lower']);

const handler = (req, res) => {
  const pathname = req.url.split('?')[0];
  if (LAN_ADDRESS && !SITE_URL && pathname !== '/healthz' && isLoopbackHost(req.headers.host)) {
    return send(res, 302, '', { Location: `http://${LAN_ADDRESS}:${PORT}${req.url}` });
  }
  if (testHooks && pathname.startsWith('/__test/') && testHooks(req, res, pathname, sendJson, readJsonBody)) return;

  // The only JSON API on the site: creating, fetching and AI-generating
  // content packs. Everything else here is GET/HEAD only.
  if (pathname.startsWith('/api/packs')) {
    if (req.method !== 'POST' && req.method !== 'GET') return send(res, 405, 'Method not allowed');
    if (packsApi(req, res, pathname)) return;
    return send(res, 404, 'Not found');
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');

  if (pathname === '/' || pathname === '/join') return sendFile(req, res, join(PUBLIC, 'index.html'));

  // Shareable room links: the join link /r/CODE and the big screen /tv/CODE.
  // Same app shell, routed client-side; never indexed.
  if (ROOM_ROUTE.test(pathname) || pathname === '/tv' || pathname === '/tv/') {
    return sendFile(req, res, join(PUBLIC, 'index.html'), 200, (html) =>
      html.replace('<meta name="robots" content="index,follow">', '<meta name="robots" content="noindex">'));
  }

  if (pathname === '/privacy') return sendFile(req, res, join(PUBLIC, 'privacy.html'));
  if (pathname === '/credits') return sendFile(req, res, join(PUBLIC, 'credits.html'));

  // The virtual Host Box: a browser stand-in for the hardware, same device
  // protocol (docs/HOSTBOX-PROTOCOL.md). Not a room/TV page, not indexed.
  if (pathname === '/hostbox' || pathname === '/hostbox.html') {
    return sendFile(req, res, join(PUBLIC, 'hostbox.html'));
  }

  // Cached, pre-rendered Host Box voice lines (lib/tts.mjs). The filename is
  // a content hash, so this is safe to cache forever.
  const voiceClip = /^\/hostbox\/voice\/([a-f0-9]{40})\.wav$/.exec(pathname);
  if (voiceClip) {
    const filePath = join(VOICE_DIR, `${voiceClip[1]}.wav`);
    if (!existsSync(filePath) || !statSync(filePath).isFile()) return notFound(req, res);
    return send(res, 200, req.method === 'HEAD' ? null : readFileSync(filePath), {
      'Content-Type': 'audio/wav', 'Cache-Control': 'public, max-age=31536000, immutable',
    });
  }

  if (pathname === '/sitemap.xml') {
    return send(res, 200, req.method === 'HEAD' ? null : sitemapXml(publicOrigin(req)), { 'Content-Type': MIME['.xml'], 'Cache-Control': 'no-cache' });
  }

  // SEO rules page for a game, e.g. /games/imposter (no trailing file means
  // this, not the file-serving route below).
  const gamePage = /^\/games\/([a-z0-9-]+)\/?$/.exec(pathname);
  if (gamePage) {
    if (REMOVED_GAMES.has(gamePage[1])) {
      return send(res, 301, '', { 'Location': publicOrigin(req) });
    }
    if (games.has(gamePage[1])) {
      return send(res, 200, req.method === 'HEAD' ? null : gamePageHtml(publicOrigin(req), games.get(gamePage[1])), {
        'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache',
      });
    }
  }

  if (pathname === '/healthz') {
    return send(res, 200, JSON.stringify({ ok: true, games: games.size, ...rooms.stats() }), {
      'Content-Type': MIME['.json'], 'Cache-Control': 'no-store',
    });
  }

  if (pathname === '/games/index.json') {
    return send(res, 200, req.method === 'HEAD' ? null : gameIndex, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-cache' });
  }

  // /qr/CODE.svg joins the room; /qr/tv/CODE.svg opens its TV screen.
  const qr = /^\/qr\/(tv\/)?([A-Za-z]{4})\.svg$/.exec(pathname);
  if (qr) {
    const svg = qrSvg(`${publicOrigin(req)}/${qr[1] ? 'tv' : 'r'}/${qr[2].toUpperCase()}`);
    return send(res, 200, req.method === 'HEAD' ? null : svg, { 'Content-Type': MIME['.svg'], 'Cache-Control': 'public, max-age=3600' });
  }

  // A game's curated packs, folded into one bundle (lib/curated.mjs) that the
  // service worker precaches with the rest of the game's files.
  const bundle = /^\/games\/([a-z0-9-]+)\/packs\.json$/.exec(pathname);
  if (bundle) {
    const g = games.get(bundle[1]);
    if (!g || !g.curatedJson) return notFound(req, res);
    return send(res, 200, req.method === 'HEAD' ? null : g.curatedJson, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-cache' });
  }

  // Game module files: only the shared kit and discovered games, only
  // servable file types. Server-only secrets never live in these folders.
  const gm = /^\/games\/([a-z0-9_-]+)\/(.+)$/.exec(pathname);
  if (gm) {
    const [, id, rest] = gm;
    if (id !== '_kit' && !games.has(id)) return notFound(req, res);
    const filePath = safeJoin(join(GAMES, id), rest);
    if (!filePath || !SERVABLE.has(extname(filePath)) || /\.test\.m?js$/.test(filePath)
      || !existsSync(filePath) || !statSync(filePath).isFile()) return notFound(req, res);
    return sendFile(req, res, filePath);
  }

  const filePath = safeJoin(PUBLIC, pathname);
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    return notFound(req, res);
  }
  try {
    return sendFile(req, res, filePath);
  } catch {
    return send(res, 500, 'Server error');
  }
};

const server = createServer(handler);

/* WebSockets: /ws */

const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 });
const MAX_SOCKETS = 4000;
const MAX_PER_IP = 30;
const perIp = new Map();

server.on('upgrade', (req, socket, head) => {
  const pathname = req.url.split('?')[0];
  const origin = req.headers.origin;
  let originOk = true;
  if (origin) {
    try { originOk = new URL(origin).host === req.headers.host; } catch { originOk = false; }
  }
  const ip = clientIp(req);
  if (pathname !== '/ws' || !originOk || wss.clients.size >= MAX_SOCKETS || (perIp.get(ip) || 0) >= MAX_PER_IP) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    perIp.set(ip, (perIp.get(ip) || 0) + 1);
    ws.once('close', () => {
      const n = (perIp.get(ip) || 1) - 1;
      if (n > 0) perIp.set(ip, n); else perIp.delete(ip);
    });
    wss.emit('connection', ws);
  });
});

wss.on('connection', (ws) => {
  ws.isAlive = true;
  const handle = rooms.connect({
    send(obj) {
      if (ws.readyState !== 1) return;
      if (ws.bufferedAmount > 1_000_000) return ws.terminate();
      ws.send(JSON.stringify(obj));
    },
    close() { ws.close(); },
  });
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    let msg;
    try { msg = JSON.parse(data.toString('utf8')); } catch { return; }
    try { handle.message(msg); } catch (err) { console.error('[ws] handler error', err); }
  });
  ws.on('close', () => handle.close());
  ws.on('error', () => {});
});

// Ping every 20s: keeps the cloudflared tunnel from idling the socket out and
// drops dead connections, which is what starts host failover.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 20_000).unref();

server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') throw err;
  console.error(`Port ${PORT} is already in use. Stop whatever has it, or pick another with GAMES_PORT=${PORT + 1}.`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`games on http://${HOST}:${PORT} (${[...games.keys()].join(', ')})`);
  if (LAN) console.log(lanBanner({ address: LAN_ADDRESS, port: PORT }));
  else if (isLoopbackHost(HOST)) console.log('Only this computer can reach that. To let phones join, run: npm run lan');
});
