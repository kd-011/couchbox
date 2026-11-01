// Content packs: the curated packs every game with a deck ships with
// (games/<id>/packs/, served as one bundle at /games/<id>/packs.json and
// precached for offline play), plus custom and AI-made packs for games
// whose engine exports `pack` (lib/packs.mjs, lib/ai-packs.mjs). This is the
// small API client and the sheet a host picks a pack in, on the start
// screen, in one-phone set-up, in the room lobby and between Party Night games.
import * as ui from './ui.js';
import { fetchRetry } from './games.js';
import { withCurated } from '/games/_kit/runtime.js';

const API = '/api/packs';

async function readJson(res) {
  try { return await res.json(); } catch { return {}; }
}

export const hasPacks = (meta) => !!(meta && (meta.pack || meta.curated));
const noun = (meta, n) => `${n} ${meta.packNoun || 'card'}${n === 1 ? '' : 's'}`;
export const isCurated = (code) => typeof code === 'string' && code.startsWith('c:');

// The catalogue and content of a game's curated packs, one fetch per game
// per page load (retried; the service worker answers it offline).
const catalogues = new Map();
export function fetchCatalogue(gameId) {
  if (!catalogues.has(gameId)) {
    const p = fetchRetry(`/games/${gameId}/packs.json`).then((r) => r.json());
    p.catch(() => catalogues.delete(gameId));
    catalogues.set(gameId, p);
  }
  return catalogues.get(gameId);
}
export async function fetchPack(code) {
  const res = await fetch(`${API}/${encodeURIComponent(String(code || '').trim().toLowerCase())}`);
  const data = await readJson(res);
  if (!res.ok) throw new Error(res.status === 404 ? 'No pack with that code. Check it and try again.' : (data.error || 'Could not load that pack.'));
  return data.pack;
}

export async function createPack({ gameId, title, items }) {
  const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gameId, title, items }) });
  const data = await readJson(res);
  if (!res.ok) throw new Error(data.error || 'Could not save that pack.');
  return data.pack;
}

export async function generateAiPack({ gameId, theme }) {
  const res = await fetch(`${API}/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gameId, theme }) });
  const data = await readJson(res);
  if (!res.ok) {
    const err = new Error(data.message || data.error || 'Could not generate a pack.');
    err.unavailable = data.error === 'unavailable';
    throw err;
  }
  return data.pack;
}

// Current pack choice per game, for the life of this tab (sessionStorage,
// so a refresh or a Party Night's next game keeps it): a curated pick
// { code: 'c:<id>', title, emoji, count, curated: true }, a custom one
// { code, title, items }, or nothing for the built-in deck.
const STORE = 'games.packs';
const chosen = new Map(Object.entries((() => {
  try { return JSON.parse(sessionStorage.getItem(STORE) || '{}') || {}; } catch { return {}; }
})()));
function persistChoices() {
  try { sessionStorage.setItem(STORE, JSON.stringify(Object.fromEntries(chosen))); } catch { /* private mode: tab memory only */ }
}
export function packFor(gameId) { return chosen.get(gameId) || null; }
export function setPackFor(gameId, pack) {
  if (pack) {
    const { content, ...lean } = pack; // curated content comes back from the bundle when needed
    chosen.set(gameId, lean);
  } else chosen.delete(gameId);
  persistChoices();
}

// The content a one-phone game plays with for this choice: the pack over
// the built-in deck (curated), the pack's own deck (custom), or the
// built-in deck. A curated pack that no longer exists falls back quietly.
export async function packContent(g, choice) {
  if (!choice) return g.content;
  if (choice.curated || isCurated(choice.code)) {
    const cat = await fetchCatalogue(g.id);
    const p = cat.packs.find((x) => x.code === choice.code);
    return p ? withCurated(g.engine, g.content, p.content) : g.content;
  }
  return g.engine.pack && Array.isArray(choice.items) ? g.engine.pack.apply(g.content, choice.items, choice.title) : g.content;
}

// One line for a settings row: what is in play and how big it is.
export function packSummary(meta, choice) {
  if (!choice) return { title: 'Built-in deck', sub: meta.curated ? `${meta.curated} themed packs to pick from` : 'Or make your own pack' };
  const n = choice.curated ? choice.count : Array.isArray(choice.items) ? choice.items.length : choice.count;
  return { title: choice.title, sub: Number.isInteger(n) ? `${noun(meta, n)} · tap to change` : 'Tap to change', emoji: choice.emoji || null };
}

function fieldRowHtml(schema, i, values = {}) {
  const { html, esc } = ui;
  return html`<div class="pack-item" data-i="${i}">
    ${schema.fields.map((f) => html`<label class="pack-field">
      <span>${f.label}${f.optional ? '' : ' *'}</span>
      ${f.type === 'textarea'
        ? html`<textarea data-key="${f.key}" maxlength="${f.maxLength || 60}" placeholder="${f.placeholder || ''}" rows="2">${values[f.key] || ''}</textarea>`
        : html`<input type="text" data-key="${f.key}" maxlength="${f.maxLength || 60}" placeholder="${f.placeholder || ''}" value="${values[f.key] || ''}">`}
    </label>`)}
    <button type="button" class="icon-btn pack-rm" data-rm="${i}" aria-label="Remove this ${esc(schema.itemLabel)}" title="Remove">${ui.icon('close', 16)}</button>
  </div>`;
}

function readItems(root, schema) {
  return [...root.querySelectorAll('.pack-item')].map((row) => Object.fromEntries(
    schema.fields.map((f) => [f.key, row.querySelector(`[data-key="${f.key}"]`).value]),
  ));
}

/* ---------- the pack browser ---------- */

const SKELETONS = 6;
const TOOLS_FROM = 7; // search and filter chips once a game has this many packs

function cardHtml({ pick, on, art, title, blurb, count, spicy = false, i = 0 }) {
  const { html } = ui;
  return html`<button type="button" class="pk-card${on ? ' on' : ''}" data-pick="${pick}" aria-pressed="${on ? 'true' : 'false'}" style="--i:${Math.min(i, 12)}">
    <span class="pk-art" aria-hidden="true">${art}</span>
    <span class="pk-text"><b>${title}</b><small>${blurb}</small></span>
    <span class="pk-foot"><span class="pk-count">${count}</span>${spicy ? html`<span class="pill pill-amber pk-spicy">Spicy extras</span>` : ''}${on ? html`<span class="pk-check">${ui.icon('check', 18)}</span>` : ''}</span>
  </button>`;
}

function builtinCard(meta, current, builtinCount) {
  return cardHtml({
    pick: 'builtin',
    on: !current,
    art: ui.raw(ui.icon('star', 26)),
    title: 'Built-in deck',
    blurb: 'A mix of everything. The classic.',
    count: Number.isInteger(builtinCount) ? noun(meta, builtinCount) : 'Always available',
  });
}

function customCard(meta, current) {
  const n = Array.isArray(current.items) ? current.items.length : current.count;
  return cardHtml({
    pick: 'custom',
    on: true,
    art: ui.raw(ui.icon('edit', 24)),
    title: current.title,
    blurb: current.code ? `Your pack, code ${current.code}` : 'Your pack',
    count: Number.isInteger(n) ? noun(meta, n) : '',
  });
}

function gridHtml(meta, current, cat, { q = '', tag = 'all' } = {}) {
  const { html } = ui;
  const custom = current && !current.curated && !isCurated(current.code) ? current : null;
  const needle = q.trim().toLowerCase();
  const packs = cat.packs.filter((p) => {
    if (tag === 'spicy' && !p.spicy) return false;
    if (tag === 'clean' && p.spicy) return false;
    if (!['all', 'spicy', 'clean'].includes(tag) && !p.tags.includes(tag)) return false;
    return !needle || `${p.title} ${p.blurb} ${p.tags.join(' ')}`.toLowerCase().includes(needle);
  });
  const filtering = needle || tag !== 'all';
  const cards = [
    ...(filtering ? [] : [builtinCard(meta, current, cat.builtinCount)]),
    ...(custom && !filtering ? [customCard(meta, custom)] : []),
    ...packs.map((p, i) => cardHtml({
      pick: p.code, on: !!current && current.code === p.code, art: p.emoji, title: p.title, blurb: p.blurb,
      count: noun(meta, p.count), spicy: p.spicy, i: i + 1,
    })),
  ];
  if (!cards.length) {
    return html`<div class="state-card pk-empty">${ui.icon('search', 32)}<h3>No packs match${needle ? html` "${q.trim()}"` : ''}</h3>
      <p>Try another word, or see every pack.</p>
      <button type="button" class="btn btn-secondary" data-clear>Show all packs</button></div>`;
  }
  return html`${cards}`;
}

function toolsHtml(cat) {
  const { html } = ui;
  const freq = new Map();
  for (const p of cat.packs) for (const t of p.tags) freq.set(t, (freq.get(t) || 0) + 1);
  const tags = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6).map(([t]) => t);
  const chips = [['all', 'All'], ...(cat.packs.some((p) => p.spicy) ? [['clean', 'Clean'], ['spicy', 'Spicy extras']] : []), ...tags.map((t) => [t, t[0].toUpperCase() + t.slice(1)])];
  return html`<div class="pk-tools">
    <label class="pk-search">${ui.icon('search', 18)}<span class="visually-hidden">Search packs</span>
      <input type="search" id="pk-q" class="input" placeholder="Search ${cat.packs.length} packs" autocomplete="off" enterkeyhint="search"></label>
    <div class="chips pk-chips" role="group" aria-label="Filter packs">${chips.map(([v, label], i) => html`<button type="button" class="chip${i === 0 ? ' on' : ''}" data-tag="${v}" aria-pressed="${i === 0 ? 'true' : 'false'}">${label}</button>`)}</div>
  </div>`;
}

function skeletonHtml() {
  return Array.from({ length: SKELETONS }, () => '<div class="pk-card pk-skel" aria-hidden="true"></div>').join('');
}

function ownHtml(schema) {
  if (!schema) return '';
  const { html, esc } = ui;
  return html`<h3 class="sec pk-own-h">Your own pack</h3>
    <div class="pk-own">
      <button type="button" class="settings-row" data-go="code">${ui.icon('qr', 20)}<span><b>Load by code</b><small>A pack a mate shared with you</small></span>${ui.icon('back', 18)}</button>
      <button type="button" class="settings-row" data-go="build">${ui.icon('edit', 20)}<span><b>Make your own</b><small>Write your own ${esc(schema.label.toLowerCase())}</small></span>${ui.icon('back', 18)}</button>
      <button type="button" class="settings-row pk-ai" data-go="ai">${ui.icon('smile', 20)}<span><b>AI pack maker</b><small>Name a theme, get a pack</small></span>${ui.icon('back', 18)}</button>
    </div>`;
}

function menuHtml(meta, cat) {
  const { html } = ui;
  return html`<div class="pk" aria-busy="${cat ? 'false' : 'true'}">
    ${cat && cat.packs.length >= TOOLS_FROM ? toolsHtml(cat) : ''}
    <div class="pk-grid" id="pk-grid">${ui.raw(cat ? '' : skeletonHtml())}</div>
    <p class="pk-loading" id="pk-loading" ${cat ? 'hidden' : ''}><span class="spinner sm"></span> Loading packs…</p>
    ${ownHtml(meta.pack)}
  </div>`;
}

function codeHtml() {
  return ui.html`<form class="setup pack-code-form" id="pack-code-form" novalidate>
    <label for="pack-code-input">Pack code</label>
    <input id="pack-code-input" class="input input-xl" maxlength="12" autocapitalize="none" autocomplete="off" spellcheck="false" placeholder="e.g. 7k2n9dqf" enterkeyhint="go">
    <p class="field-error" id="pack-code-err" role="alert"></p>
    <button class="btn btn-primary btn-xl" type="submit">Load pack</button>
    <button class="btn btn-ghost" type="button" data-back>Back</button>
  </form>`;
}

function previewHtml(schema, pack) {
  const { html, esc } = ui;
  const sample = pack.items.slice(0, 5).map((it) => schema.fields.map((f) => it[f.key]).filter(Boolean).join(' / '));
  return html`<div class="pack-preview">
    <h3>${esc(pack.title)}</h3>
    <p class="sheet-text">${pack.items.length} ${esc(schema.itemLabel)}${pack.items.length === 1 ? '' : 's'}</p>
    <ul class="pack-sample">${sample.map((s) => html`<li>${s}</li>`)}</ul>
    ${pack.items.length > 5 ? html`<p class="sheet-text">…and ${pack.items.length - 5} more.</p>` : ''}
    <button class="btn btn-primary btn-xl" data-use type="button">Use this pack</button>
    <button class="btn btn-ghost" type="button" data-back>Back</button>
  </div>`;
}

function buildHtml(schema) {
  const { html, esc } = ui;
  const starter = Array.from({ length: Math.max(3, schema.minItems) }, (_, i) => fieldRowHtml(schema, i));
  return html`<form class="setup pack-build-form" id="pack-build-form" novalidate>
    <label for="pack-title-input">Pack name</label>
    <input id="pack-title-input" class="input" maxlength="60" placeholder="${esc(schema.label)}" autocapitalize="words">
    <div class="pack-items" id="pack-items">${starter}</div>
    <button type="button" class="btn btn-ghost add-player" id="pack-add">${ui.icon('plus', 18)} Add ${esc(schema.itemLabel)}</button>
    <p class="field-error" id="pack-build-err" role="alert"></p>
    <button class="btn btn-primary btn-xl" type="submit">Save and use</button>
    <button class="btn btn-ghost" type="button" data-back>Back</button>
  </form>`;
}

function aiHtml() {
  return ui.html`<form class="setup pack-ai-form" id="pack-ai-form" novalidate>
    <label for="pack-theme-input">Theme</label>
    <input id="pack-theme-input" class="input input-xl" maxlength="120" placeholder="e.g. 90s AFL, inside jokes about Sam" autocapitalize="sentences" enterkeyhint="go">
    <p class="field-error" id="pack-ai-err" role="alert"></p>
    <button class="btn btn-amber btn-xl" type="submit">${ui.icon('smile', 18)} Generate</button>
    <button class="btn btn-ghost" type="button" data-back>Back</button>
  </form>`;
}

function aiLoadingHtml(theme) {
  return ui.html`<div class="state-card pack-ai-loading"><div class="spinner"></div><p>Writing a pack for "${theme}"…</p></div>`;
}

// Returns the pack to use ({ code, title, ... }), null for the built-in
// deck (explicit), or undefined if the sheet was dismissed with no change.
// `current` overrides the tab-local choice (a room lobby knows the room's
// actual pack, which may have been set from a different tab or device).
export function pickPackSheet(meta, current = packFor(meta.id)) {
  const schema = meta.pack;
  const sheetTitle = `Packs: ${meta.name}`;
  return ui.sheet({
    title: sheetTitle,
    className: 'sheet-pack',
    body: String(menuHtml(meta, meta.curated ? null : { builtinCount: null, packs: [] })),
    actions: [],
    onOpen(wrap, done) {
      const body = wrap.querySelector('.sheet-body');
      const titleEl = wrap.querySelector('.sheet-title');
      // The sheet lives on <body>, outside the game's screen: wear its colour.
      if (ui.themeVars) wrap.querySelector('.sheet').setAttribute('style', ui.themeVars(meta));
      let cat = meta.curated ? null : { builtinCount: null, packs: [] };
      let loadErr = null;
      const filter = { q: '', tag: 'all' };
      let slowTimer = null;

      function show(html, title) {
        clearTimeout(slowTimer);
        body.innerHTML = String(html);
        if (titleEl && title) titleEl.textContent = title;
        wire();
      }

      function drawGrid() {
        const grid = body.querySelector('#pk-grid');
        if (!grid) return;
        if (loadErr) {
          grid.innerHTML = String(ui.html`<div class="state-card pk-error">${ui.icon('wifiOff', 32)}<h3>Couldn't load the packs</h3>
            <p class="err-detail">${loadErr}</p>
            <button type="button" class="btn btn-primary" data-retry>${ui.icon('refresh', 18)} Try again</button></div>
            ${builtinCard(meta, current, null)}`);
        } else if (cat) {
          grid.innerHTML = String(gridHtml(meta, current, cat, filter));
        }
      }

      function showMenu() {
        filter.q = ''; filter.tag = 'all';
        show(menuHtml(meta, cat), sheetTitle);
        drawGrid();
      }

      async function load() {
        if (cat) return;
        loadErr = null;
        slowTimer = setTimeout(() => {
          const l = body.querySelector('#pk-loading');
          if (l) l.innerHTML = String(ui.html`<span class="spinner sm"></span> Still loading packs. A slow connection the first time; after that they work offline.`);
        }, 4000);
        try {
          cat = await fetchCatalogue(meta.id);
        } catch (err) {
          loadErr = navigator.onLine ? (err.message || 'The server did not answer.') : "You're offline and the packs aren't saved on this phone yet.";
        }
        clearTimeout(slowTimer);
        if (!wrap.isConnected || !body.querySelector('#pk-grid')) return;
        if (cat) showMenu(); else { body.querySelector('#pk-loading').hidden = true; drawGrid(); }
      }

      function pick(code) {
        ui.haptic('success');
        if (code === 'builtin') return done(null);
        if (code === 'custom') return done(current);
        const p = cat && cat.packs.find((x) => x.code === code);
        if (p) done({ code: p.code, title: p.title, emoji: p.emoji, count: p.count, curated: true });
      }

      function wire() {
        const back = body.querySelector('[data-back]');
        if (back) back.addEventListener('click', showMenu);

        body.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => {
          const go = b.dataset.go;
          if (go === 'code') show(codeHtml(), 'Pack code');
          if (go === 'build') show(buildHtml(schema), `Build a ${schema.label.toLowerCase()}`);
          if (go === 'ai') show(aiHtml(), 'AI pack maker');
        }));

        const grid = body.querySelector('#pk-grid');
        if (grid) grid.addEventListener('click', (e) => {
          if (e.target.closest('[data-retry]')) { body.querySelector('#pk-loading').hidden = false; grid.innerHTML = skeletonHtml(); load(); return; }
          if (e.target.closest('[data-clear]')) {
            filter.q = ''; filter.tag = 'all';
            const q = body.querySelector('#pk-q'); if (q) q.value = '';
            body.querySelectorAll('[data-tag]').forEach((c) => { c.classList.toggle('on', c.dataset.tag === 'all'); c.setAttribute('aria-pressed', String(c.dataset.tag === 'all')); });
            drawGrid();
            return;
          }
          const card = e.target.closest('[data-pick]');
          if (card) pick(card.dataset.pick);
        });
        const q = body.querySelector('#pk-q');
        if (q) q.addEventListener('input', () => { filter.q = q.value; drawGrid(); });
        body.querySelectorAll('[data-tag]').forEach((c) => c.addEventListener('click', () => {
          filter.tag = c.dataset.tag;
          body.querySelectorAll('[data-tag]').forEach((x) => { x.classList.toggle('on', x === c); x.setAttribute('aria-pressed', String(x === c)); });
          ui.haptic('tap');
          drawGrid();
        }));

        const codeForm = body.querySelector('#pack-code-form');
        if (codeForm) codeForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const input = codeForm.querySelector('#pack-code-input');
          const err = codeForm.querySelector('#pack-code-err');
          const code = input.value.trim();
          if (!code) { err.textContent = 'Type the pack code first.'; return; }
          err.textContent = '';
          const btn = codeForm.querySelector('button[type="submit"]');
          btn.disabled = true; btn.textContent = 'Loading…';
          try {
            const pack = await fetchPack(code);
            if (pack.gameId !== meta.id) throw new Error(`That pack is for a different game.`);
            show(previewHtml(schema, pack), 'Preview');
            body.querySelector('[data-use]').addEventListener('click', () => done(pack));
          } catch (err2) {
            err.textContent = err2.message;
            btn.disabled = false; btn.textContent = 'Load pack';
          }
        });

        const buildForm = body.querySelector('#pack-build-form');
        if (buildForm) {
          buildForm.querySelector('#pack-add').addEventListener('click', () => {
            const list = buildForm.querySelector('#pack-items');
            if (list.children.length >= schema.maxItems) return;
            list.insertAdjacentHTML('beforeend', String(fieldRowHtml(schema, list.children.length)));
          });
          buildForm.querySelector('#pack-items').addEventListener('click', (e) => {
            const rm = e.target.closest('[data-rm]');
            if (!rm) return;
            if (buildForm.querySelectorAll('.pack-item').length <= 1) return;
            rm.closest('.pack-item').remove();
          });
          buildForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const err = buildForm.querySelector('#pack-build-err');
            err.textContent = '';
            const title = buildForm.querySelector('#pack-title-input').value.trim();
            const items = readItems(buildForm, schema);
            const btn = buildForm.querySelector('button[type="submit"]');
            btn.disabled = true; btn.textContent = 'Saving…';
            try {
              const pack = await createPack({ gameId: meta.id, title, items });
              done(pack);
            } catch (err2) {
              err.textContent = err2.message;
              btn.disabled = false; btn.textContent = 'Save and use';
            }
          });
        }

        const aiForm = body.querySelector('#pack-ai-form');
        if (aiForm) aiForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const theme = aiForm.querySelector('#pack-theme-input').value.trim();
          const err = aiForm.querySelector('#pack-ai-err');
          if (!theme) { err.textContent = 'Type a theme first.'; return; }
          err.textContent = '';
          show(aiLoadingHtml(ui.esc(theme)), 'AI pack maker');
          try {
            const pack = await generateAiPack({ gameId: meta.id, theme });
            show(previewHtml(schema, pack), 'Preview');
            body.querySelector('[data-use]').addEventListener('click', () => done(pack));
          } catch (err3) {
            show(aiHtml(), 'AI pack maker');
            body.querySelector('#pack-theme-input').value = theme;
            body.querySelector('#pack-ai-err').textContent = err3.message;
          }
        });
      }

      wire();
      if (cat) drawGrid(); else load();
    },
  });
}
