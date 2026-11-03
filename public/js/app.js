// Games app shell: router, home, a game's start screen, set-up,
// join, menus.
//   /            home            #/new/<id>                a game's start screen
//   #/new/<id>/pass/<tier>       one-phone set-up (who's playing)
//   #/new/<id>/room/<tier>       host set-up (only when there's no saved name)
//   #/host/<id>/<tier>           create the room
//   #/play       pass-and-play game in progress (offline)
//   /r/CODE      room (join link)  /tv/CODE  big screen   /tv  enter a code on a TV
//   /join        enter a code
import * as ui from './ui.js';
import { gameIndex, gameMeta, gameIcon, loadRules, renderMarkdown, loadGame } from './games.js';
import { optionsForm, wireOptionsForm } from './options.js';
import { pickPackSheet, packFor, setPackFor, hasPacks, packSummary } from './packs.js';
import { runPassGame, startPassGame, savedPassGame, clearPassGame } from './pass.js';
import { runRoom, recentRoom, NAME_KEY, FACE_KEY } from './room.js';
import * as nightui from './nightui.js';
import { runTv } from './tv.js';
import { showOnTv } from './tvcast.js';
import './install.js'; // captures beforeinstallprompt from the first load
import * as sfx from './sfx.js';
import { COLORS, AVATARS } from '/games/_kit/palette.js';
import { normaliseOptions } from '/games/_kit/runtime.js';
import { clampCap, DEFAULT_SHOT_CAP, MAX_SHOT_CAP } from '/games/_kit/drinks.js';

const CAP_OPT = { key: 'shotCap', label: 'Shot cap per player, per hour', type: 'stepper', min: 0, max: MAX_SHOT_CAP, step: 1, default: DEFAULT_SHOT_CAP };
const TIER_KEY = 'games.tier';
const TIERS = ['standard', 'drinking', 'deadly'];

const app = document.getElementById('app');
let cleanup = null;

export function navigate(url) {
  if (url.startsWith('#')) {
    if (location.pathname === '/' && location.hash !== url && `#${location.hash.replace(/^#/, '')}` !== url) {
      location.hash = url; // hashchange routes
      return;
    }
    history.pushState({}, '', `/${url}`);
  } else {
    history.pushState({}, '', url);
  }
  route();
}

function screen(markup) {
  const boot = document.getElementById('boot');
  app.innerHTML = markup;
  // Taking over from the static boot header: it is already on screen, so
  // the new screen must not fade in over it again.
  if (boot && !boot.hidden) { const s = app.querySelector('.screen'); if (s) s.style.animation = 'none'; }
  window.scrollTo(0, 0);
}

// A fragment change fires both popstate and hashchange; route once per URL.
let routedUrl = null;
function onNav() {
  if (location.pathname + location.hash !== routedUrl) route();
}

async function route() {
  routedUrl = location.pathname + location.hash;
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  document.body.classList.remove('tv-mode', 'idle');
  delete document.body.dataset.stage;
  const path = location.pathname;
  let m;
  if ((m = /^\/tv\/([A-Za-z]{4})\/?$/.exec(path))) {
    document.title = `TV: room ${m[1].toUpperCase()}`;
    cleanup = runTv(app, m[1].toUpperCase());
    return;
  }
  if (/^\/tv\/?$/.test(path)) return renderTvEnter();
  if ((m = /^\/r\/([A-Za-z]{4})\/?$/.exec(path))) {
    document.title = `Room ${m[1].toUpperCase()}: Games`;
    cleanup = runRoom(app, { code: m[1].toUpperCase() }, { navigate, menu: gameMenu, rules: rulesSheet });
    return;
  }
  if (path === '/join') return renderJoin();
  const hash = location.hash.replace(/^#\/?/, '');
  const parts = hash.split('/').filter(Boolean);
  if (parts[0] === 'play') {
    document.title = 'Games';
    cleanup = await runPassGame(app, { onExit: () => navigate('#/'), menu: gameMenu, rules: rulesSheet });
    return;
  }
  if (parts[0] === 'new' && parts[1]) return renderStart(parts[1], parts[2], parts[3]);
  if (parts[0] === 'host' && parts[1]) return renderCreating(parts[1], parts[2]);
  document.title = 'Games: Free party and drinking games for one phone or everyone';
  return renderHome();
}

window.addEventListener('popstate', onNav);
window.addEventListener('hashchange', onNav);
document.addEventListener('click', (e) => {
  // Same-origin app links route in place instead of reloading.
  const a = e.target.closest('a[href]');
  if (!a || a.target || e.metaKey || e.ctrlKey || e.shiftKey) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin) return;
  if (!/^\/($|join$|tv$|r\/|tv\/|#)/.test(url.pathname + url.hash) && url.pathname !== '/') return;
  e.preventDefault();
  navigate(url.pathname === '/' && url.hash ? url.hash : url.pathname + url.hash);
});

/* the room-code field: one input under four drawn slots */

function codeField(id, { autofocus = false } = {}) {
  return `<div class="code-field" id="${id}-field">
    <input id="${id}" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text" enterkeyhint="go" aria-label="Room code, 4 letters" ${autofocus ? 'autofocus' : ''}>
    <span class="slot cur" aria-hidden="true"></span><span class="slot" aria-hidden="true"></span><span class="slot" aria-hidden="true"></span><span class="slot" aria-hidden="true"></span>
  </div>`;
}

// onDone(code) when 4 letters are in and submitted. Returns the input.
function wireCodeForm(form, onDone, { auto = false } = {}) {
  const input = form.querySelector('.code-field input');
  const field = form.querySelector('.code-field');
  const slots = [...field.querySelectorAll('.slot')];
  const btn = form.querySelector('[type=submit]');
  const err = form.querySelector('.field-error');
  const draw = () => {
    const v = input.value;
    slots.forEach((s, i) => {
      const ch = v[i] || '';
      if (s.textContent !== ch) { s.textContent = ch; s.classList.toggle('filled', !!ch); }
      s.classList.toggle('cur', i === Math.min(v.length, 3));
    });
    if (btn) btn.setAttribute('aria-disabled', String(v.length !== 4));
  };
  input.addEventListener('input', () => {
    input.value = input.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    field.classList.remove('invalid');
    if (err) err.textContent = '';
    draw();
    if (input.value.length) ui.haptic('tap');
    if (auto && input.value.length === 4) onDone(input.value);
  });
  field.addEventListener('click', () => input.focus());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (input.value.length !== 4) {
      if (err) err.textContent = 'Room codes are 4 letters.';
      field.classList.add('invalid');
      ui.haptic('warn');
      input.focus();
      return;
    }
    onDone(input.value);
  });
  draw();
  return input;
}

/* home */

const FILTERS = [
  { id: 'all', label: 'Any', fits: () => true },
  { id: '2', label: '2', fits: (g) => g.minPlayers <= 2 },
  { id: '3-4', label: '3-4', fits: (g) => g.minPlayers <= 4 && g.maxPlayers >= 3 },
  { id: '5-8', label: '5-8', fits: (g) => g.minPlayers <= 8 && g.maxPlayers >= 5 },
  { id: '9+', label: '9+', fits: (g) => g.maxPlayers >= 9 },
];
// What kind of night: derived from the game's own meta, so a new game that
// fills in minutes / vibes / teams lands under the right chips by itself.
const VIBE_CHIPS = [
  { id: 'quick', label: 'Quick', fits: (g) => !!g.minutes && g.minutes[1] <= 20 },
  { id: 'teams', label: 'Teams', fits: (g) => g.teams },
  { id: 'bluff', label: 'Bluffing', fits: (g) => g.vibes.includes('bluff') },
  { id: 'brain', label: 'Brainy', fits: (g) => g.vibes.includes('brain') },
  { id: 'silly', label: 'Silly', fits: (g) => g.vibes.includes('silly') },
];
const LAST_KEY = 'games.last';

const lenText = (g) => (g.minutes ? `${g.minutes[0] === g.minutes[1] ? g.minutes[0] : `${g.minutes[0]}-${g.minutes[1]}`} min` : '');

function factsHTML(g) {
  const bits = [
    `<span>${ui.icon('users', 14)}${g.minPlayers}-${g.maxPlayers}</span>`,
    g.minutes ? `<span>${ui.icon('clock', 14)}${lenText(g)}</span>` : '',
    g.teams ? '<span>Teams</span>' : '',
  ];
  return bits.join('');
}

function deckHTML(g, i) {
  return `<a class="deck" href="/#/new/${ui.esc(g.id)}" data-game="${ui.esc(g.id)}" style="${ui.themeVars(g)};--i:${i}">
    <span class="deck-art" aria-hidden="true">${gameIcon(g, 64)}</span>
    <strong class="deck-name">${ui.esc(g.name)}</strong>
    <span class="deck-pitch">${ui.esc(g.pitch || g.tagline)}</span>
    <span class="deck-meta">${factsHTML(g)}</span>
  </a>`;
}

const skeletonDecks = () => '<div class="deck skel" aria-hidden="true"></div>'.repeat(6);

async function renderHome() {
  const count = localStorage.getItem('games.homeFilter') || 'all';
  const vibe = sessionStorage.getItem('games.homeVibe') || '';
  const chip = (attr, id, label, on, role = 'radio') => `<button type="button" class="chip ${on ? 'on' : ''}" ${role === 'radio' ? `role="radio" aria-checked="${on}"` : `aria-pressed="${on}"`} data-${attr}="${id}">${label}</button>`;
  screen(`<div class="screen home">
    <header class="home-top">
      <div>
        <h1 class="wordmark">Games</h1>
        <p class="home-pitch">Party and drinking games for one phone, or everyone's.</p>
      </div>
      ${ui.soundButton()}
    </header>
    <main>
    <section class="home-hero" aria-label="Start playing">
      <div class="home-go">
        <button type="button" class="btn btn-amber btn-xl" id="surprise">${ui.icon('shuffle', 22)}<span>Surprise me<small id="surprise-for"></small></span></button>
        <button type="button" class="btn btn-secondary btn-xl" id="night">${ui.icon('trophy', 22)}<span>Party Night</span></button>
      </div>
      <form class="join-panel" id="join-inline" novalidate>
        <div class="join-head"><label for="join-code" class="join-label">Join a room</label><a class="join-tv" href="/tv">${ui.icon('tv', 16)} Show it on a TV</a></div>
        <div class="join-row">
          ${codeField('join-code')}
          <button class="btn btn-primary" type="submit" id="join-go" aria-disabled="true">Join</button>
        </div>
        <p class="field-error" id="join-err" role="alert"></p>
      </form>
    </section>
    <div id="resume"></div>
    <div class="home-tools">
      <div class="home-search">${ui.icon('search', 20)}<input id="home-search" type="search" class="input" placeholder="Search games" aria-label="Search games" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search"></div>
      <div class="home-filters">
        <div class="home-filter" role="radiogroup" aria-label="How many players">
          <span class="home-filter-label">${ui.icon('users', 16)}</span>
          ${FILTERS.map((f) => chip('filter', f.id, f.label, f.id === count)).join('')}
        </div>
        <div class="home-filter" role="group" aria-label="What kind of game">
          ${VIBE_CHIPS.map((v) => chip('vibe', v.id, v.label, v.id === vibe, 'toggle')).join('')}
        </div>
      </div>
    </div>
    <p class="visually-hidden" id="home-count" role="status" aria-live="polite"></p>
    <section class="decks" aria-label="Games" id="games" aria-busy="true">${skeletonDecks()}</section>
    </main>
    <footer class="home-foot">
      <span>Free. No sign-up, no tracking.</span>
      <a href="/credits">Credits</a>
      <a href="/privacy">Privacy</a>
    </footer>
  </div>`);
  wireCodeForm(document.getElementById('join-inline'), (code) => navigate(`/r/${code}`), { auto: true });
  const surprise = document.getElementById('surprise');
  const early = () => ui.toast('Still loading the games', 'info');
  surprise.addEventListener('click', early);
  renderResume(null); // from localStorage alone, so the strip never shifts the page when the list lands
  const box = document.getElementById('games');
  let list;
  try {
    list = await gameIndex();
  } catch (err) {
    box.outerHTML = String(ui.html`<div class="state-card" id="games">${ui.icon('wifiOff', 36)}<h2>Couldn't load the games</h2><p class="err-detail">${err.message}</p><button class="btn btn-primary" id="retry">${ui.icon('refresh', 18)} Try again</button></div>`);
    document.getElementById('retry').addEventListener('click', renderHome);
    return;
  }
  renderResume(list);

  const state = { count, vibe, q: '' };
  const shownList = () => {
    const c = FILTERS.find((x) => x.id === state.count) || FILTERS[0];
    const v = VIBE_CHIPS.find((x) => x.id === state.vibe);
    const q = state.q.trim().toLowerCase();
    return list.filter((g) => c.fits(g) && (!v || v.fits(g)) && (!q || `${g.name} ${g.pitch} ${g.tagline}`.toLowerCase().includes(q)));
  };
  surprise.removeEventListener('click', early);
  const draw = () => {
    const shown = shownList();
    box.removeAttribute('aria-busy');
    box.innerHTML = shown.length ? shown.map(deckHTML).join('') : String(ui.html`<div class="home-empty">${ui.icon('search', 28)}<h2>No game fits that</h2><p>${state.q.trim() ? `Nothing matches "${state.q.trim()}" with those filters.` : 'Nothing fits that count and kind of game.'}</p><button type="button" class="btn btn-secondary" id="home-clear">${ui.icon('refresh', 18)} Clear filters</button></div>`);
    document.getElementById('home-count').textContent = `${shown.length} ${shown.length === 1 ? 'game' : 'games'}`;
    surprise.setAttribute('aria-disabled', String(!shown.length));
    surprise.title = shown.length ? '' : 'No game fits the filters. Clear them first.';
    const f = FILTERS.find((x) => x.id === state.count);
    document.getElementById('surprise-for').textContent = f && f.id !== 'all' ? `for ${f.label} players` : '';
  };
  draw();
  // Back from a game lands where you were in the grid.
  const y = Number(sessionStorage.getItem('games.homeScroll') || 0);
  if (y) requestAnimationFrame(() => window.scrollTo(0, y));
  box.addEventListener('click', (e) => {
    if (e.target.closest('.deck')) sessionStorage.setItem('games.homeScroll', String(window.scrollY));
    if (e.target.closest('#home-clear')) {
      state.count = 'all'; state.vibe = ''; state.q = '';
      localStorage.setItem('games.homeFilter', 'all');
      sessionStorage.removeItem('games.homeVibe');
      document.getElementById('home-search').value = '';
      syncChips();
      draw();
    }
  });
  const syncChips = () => {
    for (const c of document.querySelectorAll('[data-filter]')) { const on = c.dataset.filter === state.count; c.classList.toggle('on', on); c.setAttribute('aria-checked', String(on)); }
    for (const c of document.querySelectorAll('[data-vibe]')) { const on = c.dataset.vibe === state.vibe; c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on)); }
  };
  document.querySelector('.home-filters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter], [data-vibe]');
    if (!b) return;
    if (b.dataset.filter) {
      state.count = b.dataset.filter;
      localStorage.setItem('games.homeFilter', state.count);
    } else {
      state.vibe = state.vibe === b.dataset.vibe ? '' : b.dataset.vibe;
      if (state.vibe) sessionStorage.setItem('games.homeVibe', state.vibe); else sessionStorage.removeItem('games.homeVibe');
    }
    syncChips();
    ui.haptic('tap');
    draw();
  });
  // Arrow keys move through the player-count radios.
  document.querySelector('[role=radiogroup].home-filter').addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowLeft'].includes(e.key)) return;
    const all = [...e.currentTarget.querySelectorAll('[data-filter]')];
    const next = all[(all.indexOf(document.activeElement) + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length];
    e.preventDefault();
    next.focus();
    next.click();
  });
  const search = document.getElementById('home-search');
  search.addEventListener('input', () => { state.q = search.value; draw(); });
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    const only = shownList();
    if (only.length === 1) navigate(`#/new/${only[0].id}`);
  });

  surprise.addEventListener('click', async () => {
    if (surprise.getAttribute('aria-disabled') === 'true') { ui.toast('No game fits those filters', 'info', 'Clear them to get a surprise.'); ui.haptic('warn'); return; }
    ui.haptic('tap');
    const pool = shownList();
    let g = null;
    for (;;) {
      const others = pool.filter((x) => x !== g);
      g = others.length ? others[Math.floor(Math.random() * others.length)] : g;
      const v = await ui.sheet({ title: 'Tonight, how about', className: 'sheet-surprise', body: surpriseHTML(g, pool.length > 1) });
      if (v === 'again') continue;
      if (v === 'play') navigate(`#/new/${g.id}`);
      return;
    }
  });
  document.getElementById('night').addEventListener('click', async () => {
    ui.haptic('tap');
    const v = await ui.sheet({ title: 'Party Night', className: 'sheet-night', body: nightHTML() });
    if (v !== 'pick') return;
    const id = await nightui.pickGameSheet('Start the night with', list);
    if (id) navigate(`#/new/${id}`);
  });
}

function surpriseHTML(g, more) {
  return `<div class="surprise" data-game-id="${ui.esc(g.id)}" style="${ui.themeVars(g)}">
    <div class="surprise-card"><span class="surprise-art" aria-hidden="true">${gameIcon(g, 72)}</span><strong>${ui.esc(g.name)}</strong><p>${ui.esc(g.pitch || g.tagline)}</p><span class="deck-meta">${factsHTML(g)}</span></div>
    <div class="sheet-actions">
      <button type="button" class="btn btn-primary btn-xl" data-value="play">${ui.icon('play', 22)} Play ${ui.esc(g.name)}</button>
      ${more ? `<button type="button" class="btn btn-secondary" data-value="again">${ui.icon('shuffle', 18)} Another one</button>` : ''}
    </div>
  </div>`;
}

function nightHTML() {
  return `<p class="sheet-text">Play a few games in a row and keep one running score. Sips, shots and wins carry across every game.</p>
    <ol class="night-steps">
      <li><span><b>Start any game</b> on one phone or in a room.</span></li>
      <li><span><b>Line up the next ones</b> from the lobby, or pick between games on one phone.</span></li>
      <li><span><b>Standings after each game</b>, then awards and a shareable recap at the end.</span></li>
    </ol>
    <div class="sheet-actions"><button type="button" class="btn btn-primary btn-xl" data-value="pick">${ui.icon('play', 22)} Pick the first game</button></div>`;
}

// "Jump back in": a one-phone game to resume, the room you were in, and
// the last game you opened, one tap away.
function renderResume(list) {
  const box = document.getElementById('resume');
  const pass = savedPassGame();
  const room = recentRoom();
  const lastId = localStorage.getItem(LAST_KEY);
  const find = (id) => (list ? list.find((g) => g.id === id) : null);
  const ico = (g, size) => (g ? gameIcon(g, size) : '<span class="game-emoji" aria-hidden="true"></span>');
  const last = lastId && (list ? find(lastId) : { id: lastId, name: localStorage.getItem(`${LAST_KEY}.name`) || 'Last game' });
  const passGame = pass && find(pass.gameId);
  const cards = [];
  if (pass) {
    cards.push(`<div class="jump-item"><a class="jump-main" href="/#/play">${ico(passGame, 28)}<span><b>Back to your one-phone game</b><small>${passGame ? `${ui.esc(passGame.name)}, where you left off` : 'Where you left off'}</small></span></a>
      <button class="icon-btn" id="resume-x" aria-label="Discard that game" title="Discard that game">${ui.icon('close', 18)}</button></div>`);
  }
  if (room) cards.push(`<div class="jump-item"><a class="jump-main" href="/r/${ui.esc(room.code)}">${ui.icon('phones', 24)}<span><b>Back to room ${ui.esc(room.code)}</b><small>Still open</small></span></a></div>`);
  if (last && !(pass && pass.gameId === last.id)) cards.push(`<div class="jump-item"><a class="jump-main" href="/#/new/${ui.esc(last.id)}" style="${list ? ui.themeVars(last) : ''}">${ico(list ? last : null, 28)}<span><b>${ui.esc(last.name)}</b><small>Play again</small></span></a></div>`);
  box.className = cards.length ? 'jump' : '';
  box.innerHTML = cards.length ? `<h2 class="visually-hidden">Jump back in</h2>${cards.join('')}` : '';
  const x = box.querySelector('#resume-x');
  if (x) x.addEventListener('click', async () => {
    if (await ui.confirm('Discard your one-phone game?', { ok: 'Discard', danger: true })) {
      clearPassGame();
      renderResume(list);
    }
  });
}

function renderJoin() {
  document.title = 'Join a room: Games';
  screen(`<div class="screen">
    <header class="topbar"><a class="icon-btn" href="/" aria-label="Back to games" title="Back to games">${ui.icon('back')}</a><span class="topbar-fill"></span>${ui.soundButton()}</header>
    <main class="join-page">
      <h1 class="q">Room code</h1>
      <form class="join-inline big" id="join-inline" novalidate>
        ${codeField('join-code', { autofocus: true })}
        <button class="btn btn-primary btn-xl" type="submit" id="join-go" aria-disabled="true">Join</button>
        <p class="field-error" id="join-err" role="alert"></p>
      </form>
    </main>
  </div>`);
  const input = wireCodeForm(document.getElementById('join-inline'), (code) => navigate(`/r/${code}`), { auto: true });
  setTimeout(() => input.focus(), 50);
}

// /tv with no code: a TV-sized code entry that works with a remote's OK.
function renderTvEnter() {
  document.title = 'TV screen: Games';
  document.body.classList.add('tv-mode');
  screen(`<div class="tv">
    <main class="tv-main">
      <form class="tv-enter" id="tv-enter" novalidate>
        <h1>Room code</h1>
        ${codeField('tv-code', { autofocus: true })}
        <p class="field-error" role="alert"></p>
        <p>It's on the host's phone, under the players.</p>
        <button type="submit" class="visually-hidden">Open</button>
      </form>
    </main>
  </div>`);
  const input = wireCodeForm(document.getElementById('tv-enter'), (code) => navigate(`/tv/${code}`), { auto: true });
  setTimeout(() => input.focus(), 50);
}

/* a game's start screen: tier, then one tap */

function savedTier() {
  const t = localStorage.getItem(TIER_KEY);
  if (t === 'deadly' && localStorage.getItem('games.deadlyok') !== '1') return 'standard';
  if (t === 'drinking' && localStorage.getItem('games.18ok') !== '1') return 'standard';
  return TIERS.includes(t) ? t : 'standard';
}

export function savedFace() {
  const f = localStorage.getItem(FACE_KEY);
  return AVATARS.includes(f) ? f : null;
}

// The "Pack" row, for every game with curated packs (meta.curated) or
// custom ones (meta.pack). The choice lives in packs.js for the tab; it is
// read at Start/Create time by renderPassSetup/renderCreating below.
function packButtonHtml(meta) {
  if (!hasPacks(meta)) return '';
  const s = packSummary(meta, packFor(meta.id));
  return `<button type="button" class="settings-row pack-btn" id="pack-btn" aria-haspopup="dialog">
    ${s.emoji ? `<span class="pk-art" aria-hidden="true">${ui.esc(s.emoji)}</span>` : ui.icon('list', 20)}<span><b>${ui.esc(s.title)}</b><small>${ui.esc(s.sub)}</small></span>${ui.icon('back', 18)}
  </button>`;
}

function wirePackButton(root, meta) {
  const btn = root.querySelector('#pack-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const result = await pickPackSheet(meta);
    if (result === undefined) return; // dismissed: no change
    setPackFor(meta.id, result);
    const fresh = root.querySelector('#pack-btn');
    if (fresh) {
      fresh.outerHTML = packButtonHtml(meta);
      wirePackButton(root, meta);
    }
    ui.toast(result ? `Playing with ${result.title}` : 'Playing with the built-in deck', 'info');
  });
}

function loadError(err) {
  screen(String(ui.html`<div class="screen"><div class="state-card">${ui.icon('wifiOff', 36)}<h2>Couldn't load that game</h2><p class="err-detail">${err.message}</p><button class="btn btn-primary" id="retry">${ui.icon('refresh', 18)} Try again</button><a class="btn btn-secondary" href="/">Back to games</a></div></div>`));
  document.getElementById('retry').addEventListener('click', route);
}

async function renderStart(id, mode, variant) {
  let meta;
  try { meta = await gameMeta(id); } catch (err) { return loadError(err); }
  if (!meta) return navigate('#/');
  document.title = `${meta.name}: Games`;
  localStorage.setItem(LAST_KEY, id);
  localStorage.setItem(`${LAST_KEY}.name`, meta.name);
  if (variant && !TIERS.includes(variant)) return navigate(`#/new/${id}`);
  if (mode && variant && ['pass', 'room'].includes(mode)) {
    if (variant !== 'standard' && !(await ui.ageGate(variant))) return navigate(`#/new/${id}`);
    return mode === 'room' ? renderRoomSetup(meta, variant) : renderPassSetup(meta, variant);
  }

  let tier = savedTier();
  const name = localStorage.getItem(NAME_KEY) || '';
  const roomOk = meta.modes.includes('room');
  const passOk = meta.modes.includes('pass');
  const tierBtn = (t, ic, label) => `<button type="button" class="tier t-${t}" role="radio" id="tier-${t}" data-tier="${t}" aria-checked="${tier === t}">
    ${ui.icon(ic, 30)}<span>${label}</span>${t === 'standard' ? '' : '<em>18+</em>'}</button>`;
  screen(`<div class="screen game-screen" style="${ui.themeVars(meta)}">
    <header class="topbar">
      <a class="icon-btn" href="/" aria-label="Back to games" title="Back to games">${ui.icon('back')}</a>
      <span class="topbar-fill"></span>
      ${ui.soundButton()}
    </header>
    <main>
    <section class="gs-hero">
      <span class="gs-art" aria-hidden="true">${gameIcon(meta, 96)}</span>
      <h1 class="gs-name">${ui.esc(meta.name)}</h1>
      <p class="gs-tag">${ui.esc(meta.tagline)}</p>
      <div class="gs-facts">
        <span class="gs-fact">${ui.icon('users', 16)} ${meta.minPlayers}-${meta.maxPlayers} players</span>
        <button type="button" class="gs-how" id="rules">${ui.icon('book', 16)} How to play</button>
      </div>
    </section>
    <div class="tiers" role="radiogroup" aria-label="How hard tonight">
      ${tierBtn('standard', 'star', 'Standard')}${tierBtn('drinking', 'glass', 'Drinking')}${tierBtn('deadly', 'skull', 'Deadly')}
    </div>
    <p class="tier-line" id="tier-line">${ui.esc(meta.variants[tier])}</p>
    ${packButtonHtml(meta)}
    ${roomOk ? `<div class="gs-who" id="gs-who">${name
      ? `<button type="button" class="gs-as" id="gs-as">${ui.avatar({ name, color: COLORS[0], avatar: savedFace() }, 40)}<span>Hosting as <b>${ui.esc(name)}</b></span>${ui.icon('edit', 16)}</button>`
      : `<label for="host-name" class="visually-hidden">Your name</label><input id="host-name" class="input" maxlength="20" autocomplete="nickname" autocapitalize="words" enterkeyhint="go" placeholder="Your name, to host">`}</div>
      <p class="field-error" id="host-err" role="alert"></p>` : ''}
    <div class="setup-spacer"></div>
    <div class="gs-go">
      ${roomOk ? `<button class="btn btn-primary btn-xl" id="go-room" ${navigator.onLine ? '' : 'aria-disabled="true"'}>${ui.icon('phones', 24)} Play on everyone's phones</button>` : ''}
      ${passOk ? `<button class="btn btn-secondary btn-xl" id="go-pass">${ui.icon('phone', 22)} Pass one phone round</button>` : ''}
    </div>
    </main>
  </div>`);

  document.getElementById('rules').addEventListener('click', () => rulesSheet(id, meta.name));
  wirePackButton(app, meta);
  const line = document.getElementById('tier-line');
  document.querySelector('.tiers').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-tier]');
    if (!b || b.dataset.tier === tier) return;
    const t = b.dataset.tier;
    if (t !== 'standard' && !(await ui.ageGate(t))) return;
    tier = t;
    localStorage.setItem(TIER_KEY, t);
    for (const x of document.querySelectorAll('[data-tier]')) x.setAttribute('aria-checked', String(x.dataset.tier === t));
    line.textContent = meta.variants[t];
    ui.haptic(t === 'deadly' ? 'warn' : 'tap');
    if (t === 'deadly') sfx.land(); else sfx.blip();
  });
  const asBtn = document.getElementById('gs-as');
  asBtn?.addEventListener('click', () => {
    document.getElementById('gs-who').innerHTML = `<label for="host-name" class="visually-hidden">Your name</label><input id="host-name" class="input" maxlength="20" autocomplete="nickname" autocapitalize="words" enterkeyhint="go" value="${ui.esc(localStorage.getItem(NAME_KEY) || '')}">`;
    const i = document.getElementById('host-name');
    i.focus();
    i.select();
    wireName(i);
  });
  const err = document.getElementById('host-err');
  function wireName(i) {
    i.addEventListener('input', () => { if (err) err.textContent = ''; i.removeAttribute('aria-invalid'); });
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); document.getElementById('go-room').click(); } });
  }
  if (document.getElementById('host-name')) wireName(document.getElementById('host-name'));

  document.getElementById('go-room')?.addEventListener('click', (e) => {
    if (!navigator.onLine) { ui.toast("You're offline", 'error', 'Everyone\'s phones needs a connection. One phone works offline.'); ui.haptic('warn'); return; }
    const i = document.getElementById('host-name');
    const n = i ? i.value.trim() : name;
    if (!n) {
      err.textContent = 'Type your name so your mates know who is hosting.';
      i.setAttribute('aria-invalid', 'true');
      ui.haptic('warn');
      i.focus();
      return;
    }
    localStorage.setItem(NAME_KEY, n);
    e.currentTarget.classList.add('busy');
    ui.haptic('success');
    navigate(`#/host/${meta.id}/${tier}`);
  });
  document.getElementById('go-pass')?.addEventListener('click', () => {
    ui.haptic('tap');
    navigate(`#/new/${meta.id}/pass/${tier}`);
  });
}

function subShell(meta, inner, backHref) {
  return `<div class="screen wizard" style="${ui.themeVars(meta)}">
    <header class="topbar">
      <a class="icon-btn" href="${backHref}" aria-label="Back" title="Back">${ui.icon('back')}</a>
      <div class="playbar-title">${gameIcon(meta, 26)}<span>${ui.esc(meta.name)}</span></div>
      ${ui.soundButton()}
    </header>
    <main>${inner}</main>
  </div>`;
}

// Deep link #/new/<id>/room/<tier>: just the name, then create.
function renderRoomSetup(meta, variant) {
  const name = localStorage.getItem(NAME_KEY) || '';
  screen(subShell(meta, `<form id="room-form" class="setup" novalidate>
      <h1 class="q">Your name</h1>
      <input id="host-name" class="input input-xl" maxlength="20" autocomplete="nickname" autocapitalize="words" enterkeyhint="go" value="${ui.esc(name)}">
      <p class="field-error" id="host-err" role="alert"></p>
      ${hasPacks(meta) ? `<h2 class="sec">Pack</h2>${packButtonHtml(meta)}` : ''}
      <div class="setup-spacer"></div>
      <button class="btn btn-primary btn-xl" type="submit" id="create">${ui.icon('phones', 22)} Create room</button>
    </form>`, `/#/new/${meta.id}`));
  const input = document.getElementById('host-name');
  const err = document.getElementById('host-err');
  setTimeout(() => { if (!input.value) input.focus(); }, 50);
  input.addEventListener('input', () => { err.textContent = ''; input.removeAttribute('aria-invalid'); });
  wirePackButton(app, meta);
  document.getElementById('room-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const n = input.value.trim();
    if (!n) { err.textContent = 'Type your name so your mates know who is hosting.'; input.setAttribute('aria-invalid', 'true'); ui.haptic('warn'); input.focus(); return; }
    localStorage.setItem(NAME_KEY, n);
    navigate(`#/host/${meta.id}/${variant}`);
  });
}

// #/host/<id>/<variant>: create the room. A refresh here creates a fresh
// room rather than resubmitting, so it sends you back if there's no name.
function renderCreating(id, variant) {
  const name = localStorage.getItem(NAME_KEY);
  if (!name || !TIERS.includes(variant)) return navigate(`#/new/${id}`);
  const pack = packFor(id);
  cleanup = runRoom(app, { create: { gameId: id, variant, name, avatar: savedFace(), options: {}, shotCap: shotCapPref(), packCode: pack ? pack.code : null } }, { navigate, menu: gameMenu, rules: rulesSheet });
}

/* pass-and-play set-up */

function shotCapPref() {
  const n = Number(localStorage.getItem('games.shotCap'));
  return Number.isFinite(n) && localStorage.getItem('games.shotCap') !== null ? clampCap(n) : DEFAULT_SHOT_CAP;
}

function loadPassPlayers(meta) {
  let list = [];
  let faces = [];
  try { list = JSON.parse(localStorage.getItem('games.passPlayers') || '[]'); } catch { /* reset */ }
  try { faces = JSON.parse(localStorage.getItem('games.passFaces') || '[]'); } catch { /* reset */ }
  if (!Array.isArray(list)) list = [];
  if (!Array.isArray(faces)) faces = [];
  list = list.filter((n) => typeof n === 'string').slice(0, meta.maxPlayers);
  while (list.length < Math.max(meta.minPlayers, 3)) list.push('');
  faces = list.map((_, i) => (AVATARS.includes(faces[i]) ? faces[i] : AVATARS[i % AVATARS.length]));
  return { names: list, faces };
}

function renderPassSetup(meta, variant) {
  let { names, faces } = loadPassPlayers(meta);
  let opts = normaliseOptions(meta.options, JSON.parse(localStorage.getItem(`games.opts.${meta.id}`) || '{}'));

  screen(subShell(meta, `<form id="pass-form" class="setup" novalidate>
      <h1 class="q">Who's playing?</h1>
      <ul class="name-list" id="names"></ul>
      <button type="button" class="btn btn-ghost add-player" id="add">${ui.icon('plus', 18)} Add player</button>
      <p class="field-error" id="names-err" role="alert"></p>
      ${meta.options.length || variant === 'deadly' ? `<h2 class="sec">Settings</h2>` : ''}
      ${variant === 'deadly' ? optionsForm([CAP_OPT], { shotCap: shotCapPref() }, { id: 'pass-cap' }) : ''}
      ${meta.options.length ? optionsForm(meta.options, opts, { id: 'pass-opts' }) : ''}
      ${hasPacks(meta) ? `<h2 class="sec">Pack</h2>${packButtonHtml(meta)}` : ''}
      <div class="setup-spacer"></div>
      <div class="gs-go"><button class="btn btn-primary btn-xl" type="submit" id="start">${ui.icon('play', 22)} Start ${ui.esc(meta.name)}</button></div>
    </form>`, `/#/new/${meta.id}`));

  const list = document.getElementById('names');
  const err = document.getElementById('names-err');
  const addBtn = document.getElementById('add');

  function persist() {
    localStorage.setItem('games.passPlayers', JSON.stringify(names));
    localStorage.setItem('games.passFaces', JSON.stringify(faces));
  }
  const faceOf = (i) => ({ name: names[i] || String(i + 1), color: COLORS[i % COLORS.length], avatar: faces[i] });
  function drawNames(focusIdx = -1) {
    list.innerHTML = names.map((n, i) => `<li>
      <button type="button" class="face-btn" data-face="${i}" aria-label="Change ${ui.esc(n || `player ${i + 1}`)}'s face" title="Change face">${ui.avatar(faceOf(i), 48)}</button>
      <input class="input" data-i="${i}" maxlength="20" value="${ui.esc(n)}" placeholder="Player ${i + 1}" aria-label="Player ${i + 1} name" autocapitalize="words" enterkeyhint="next">
      <button type="button" class="icon-btn" data-rm="${i}" aria-label="Remove player ${i + 1}" title="${names.length <= meta.minPlayers ? `${meta.name} needs at least ${meta.minPlayers}` : 'Remove'}" ${names.length <= meta.minPlayers ? 'aria-disabled="true"' : ''}>${ui.icon('close', 18)}</button>
    </li>`).join('');
    addBtn.hidden = names.length >= meta.maxPlayers;
    if (focusIdx >= 0) list.querySelector(`[data-i="${focusIdx}"]`)?.focus();
  }
  drawNames();
  list.addEventListener('input', (e) => {
    const i = Number(e.target.dataset.i);
    if (Number.isNaN(i)) return;
    names[i] = e.target.value;
    err.textContent = '';
    persist();
  });
  list.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    const i = Number(e.target.dataset.i);
    const next = list.querySelector(`[data-i="${i + 1}"]`);
    if (next) next.focus();
    else if (names.length < meta.maxPlayers) { names.push(''); faces.push(nextFace(-1)); persist(); drawNames(i + 1); }
  });
  const nextFace = (i) => {
    const used = new Set(faces.filter((_, j) => j !== i));
    const start = i >= 0 ? AVATARS.indexOf(faces[i]) : -1;
    for (let k = 1; k <= AVATARS.length; k++) {
      const f = AVATARS[(start + k + AVATARS.length) % AVATARS.length];
      if (!used.has(f)) return f;
    }
    return AVATARS[0];
  };
  list.addEventListener('click', (e) => {
    const f = e.target.closest('[data-face]');
    if (f) {
      const i = Number(f.dataset.face);
      faces[i] = nextFace(i);
      persist();
      f.innerHTML = String(ui.avatar(faceOf(i), 48));
      ui.haptic('tap');
      sfx.pop();
      return;
    }
    const b = e.target.closest('[data-rm]');
    if (!b) return;
    if (names.length <= meta.minPlayers) {
      err.textContent = `${meta.name} needs at least ${meta.minPlayers} players.`;
      ui.haptic('warn');
      return;
    }
    const i = Number(b.dataset.rm);
    names.splice(i, 1);
    faces.splice(i, 1);
    persist();
    drawNames();
    ui.haptic('tap');
  });
  addBtn.addEventListener('click', () => {
    if (names.length >= meta.maxPlayers) return;
    names.push('');
    faces.push(nextFace(-1));
    persist();
    drawNames(names.length - 1);
  });
  const capEl = document.getElementById('pass-cap');
  if (capEl) wireOptionsForm(capEl, [CAP_OPT], { shotCap: shotCapPref() }, (v) => localStorage.setItem('games.shotCap', String(v.shotCap)));
  const optsEl = document.getElementById('pass-opts');
  if (optsEl) wireOptionsForm(optsEl, meta.options, opts, (v) => { opts = v; localStorage.setItem(`games.opts.${meta.id}`, JSON.stringify(v)); });
  wirePackButton(app, meta);

  document.getElementById('pass-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const finalNames = names.map((n, i) => n.trim() || `Player ${i + 1}`);
    const lower = finalNames.map((n) => n.toLowerCase());
    const dupe = lower.findIndex((n, i) => lower.indexOf(n) !== i);
    if (dupe >= 0) {
      err.textContent = `Two players are called ${finalNames[dupe]}. Give one a different name.`;
      list.querySelector(`[data-i="${dupe}"]`)?.focus();
      ui.haptic('warn');
      return;
    }
    const btn = document.getElementById('start');
    btn.classList.add('busy');
    btn.innerHTML = 'Dealing';
    const players = finalNames.map((name, i) => ({ id: `p${i + 1}`, name, color: COLORS[i % COLORS.length], avatar: faces[i] }));
    let r;
    try {
      r = await startPassGame({ gameId: meta.id, variant, players, options: opts, shotCap: shotCapPref(), pack: packFor(meta.id) });
    } catch (ex) {
      r = { error: `Couldn't load the game: ${ex.message}` };
    }
    if (r.error) {
      btn.classList.remove('busy');
      btn.innerHTML = String(ui.html`${ui.icon('play', 22)} Start ${meta.name}`);
      err.textContent = r.error;
      ui.haptic('warn');
      return;
    }
    ui.haptic('success');
    navigate('#/play');
  });
}

/* shared menus */

async function rulesSheet(id, name) {
  const p = ui.sheet({ title: `How to play ${name}`, className: 'sheet-rules', body: '<div class="rules"><span class="spinner"></span></div>' });
  try {
    const md = await loadRules(id);
    const el = document.querySelector('.sheet-rules .rules');
    if (el) el.innerHTML = renderMarkdown(md.replace(/^#[^\n]*\n/, ''), ui.esc);
  } catch (err) {
    const el = document.querySelector('.sheet-rules .rules');
    if (el) el.innerHTML = String(ui.html`<p class="err-detail">Couldn't load the rules: ${err.message}</p>`);
  }
  return p;
}

// The ••• menu in a running game, one phone or a room. Returns the choice.
async function gameMenu(ctx) {
  const items = [];
  if (ctx.inRoom) {
    items.push(['share', 'share', 'Invite players']);
    items.push(['tv', 'tv', 'Show on TV']);
    items.push(['players', 'users', 'Players and host']);
    items.push(['react', 'smile', 'React']);
    if (ctx.isHost && ctx.inGame) {
      items.push(['restart', 'refresh', 'Restart game']);
      items.push(['lobby', 'back', 'Back to lobby']);
    }
  }
  if (ctx.drinking) items.unshift(['drinks', 'glass', "Drinks, I'm out, tier"]);
  if (ctx.inGame && (ctx.isHost || ctx.inPass)) items.push(['standings', 'trophy', ctx.over ? 'Standings' : 'End game, show standings']);
  if (ctx.isHost && ctx.inRoom && !ctx.inGame && ctx.played) items.push(['awards', 'trophy', 'Finish the night: awards']);
  if (ctx.inPass) items.push(['restart', 'refresh', 'Restart game']);
  items.push(['rules', 'book', 'How to play']);
  const on = sfx.soundOn();
  items.push(['sound', on ? 'sound' : 'mute', on ? 'Sound on' : 'Sound off', false, on ? 'Tap to mute' : 'Tap to unmute']);
  if (ctx.inRoom) items.push(['leave', 'leave', 'Leave room', true]);
  if (ctx.inPass) items.push(['end', 'leave', 'End game', true]);
  const v = await ui.sheet({
    body: `<ul class="menu">${items.map(([val, ic, label, danger, note]) => `<li><button class="menu-item ${danger ? 'danger' : ''}" data-value="${val}">${ui.icon(ic, 20)}<span>${ui.esc(label)}</span>${note ? `<small>${ui.esc(note)}</small>` : ''}</button></li>`).join('')}</ul>`,
  });
  if (v === 'rules') { await rulesSheet(ctx.gameId, ctx.name); return null; }
  if (v === 'sound') {
    sfx.setSound(!on);
    for (const el of document.querySelectorAll('[data-sound-toggle]')) {
      el.setAttribute('aria-pressed', String(!on));
      el.innerHTML = String(ui.icon(!on ? 'sound' : 'mute'));
    }
    ui.toast(on ? 'Sound off' : 'Sound on', 'info');
    if (!on) sfx.blip();
    return null;
  }
  if (v === 'tv') { await showOnTv(ctx.code); return null; }
  if (v === 'end') return (await ui.confirm('End this game?', { ok: 'End game', danger: true })) ? 'end' : null;
  return v || null;
}

/* boot */

route();
// Warm every game's modules for an instant start, once the first screen is up
// and the page has gone idle: started any earlier, the 50-odd requests sit in
// front of the home page's first paint. (The service worker precaches the
// same files for offline play on its own.)
const warm = () => gameIndex().then((list) => Promise.all(list.map((g) => loadGame(g.id).catch(() => {})))).catch(() => {});
const whenIdle = (fn) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 1500));
if (document.readyState === 'complete') whenIdle(warm);
else addEventListener('load', () => whenIdle(warm), { once: true });

if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  // After load: its install precaches every game (100-odd files), which
  // would otherwise race the first screen for the connection.
  if (document.readyState === 'complete') navigator.serviceWorker.register('/sw.js');
  else addEventListener('load', () => navigator.serviceWorker.register('/sw.js'), { once: true });
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // A new version took over. Reload, unless someone is mid-room (a reload
    // there is harmless but jarring; they get it next navigation).
    if (hadController && !reloaded && !/^\/(r|tv)\//.test(location.pathname)) { reloaded = true; location.reload(); }
  });
}

function offlineBadge() {
  let el = document.getElementById('offline');
  if (!el) {
    el = document.createElement('div');
    el.id = 'offline';
    el.className = 'offline-badge';
    el.setAttribute('role', 'status');
    el.innerHTML = `${ui.icon('wifiOff', 14)}<span>Offline: one-phone games still work</span>`;
    document.body.prepend(el);
  }
  el.hidden = navigator.onLine;
}
window.addEventListener('online', offlineBadge);
window.addEventListener('offline', offlineBadge);
offlineBadge();
