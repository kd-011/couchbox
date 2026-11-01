// Own-device room: join form, lobby, in-game player view with host
// controls, host hand-over, reconnect. Server protocol: lib/rooms.mjs.
import * as ui from './ui.js';
import * as sfx from './sfx.js';
import * as fx from './fx.js';
import * as install from './install.js';
import { createNetBar } from './netbar.js';
import { RoomSocket } from './net.js';
import { createSurface, makeApi } from './surface.js';
import { gameIndex, loadGame, gameIcon } from './games.js';
import { optionsForm, wireOptionsForm } from './options.js';
import { pickPackSheet, hasPacks, packSummary } from './packs.js';
import { showOnTv } from './tvcast.js';
import { maybeHowto, stepsHTML } from './howto.js';
import { COLORS, TEAM_COLORS, AVATARS } from '/games/_kit/palette.js';
import { MAX_SHOT_CAP } from '/games/_kit/drinks.js';
import * as drinkui from './drinkui.js';
import * as nightui from './nightui.js';
import { floatReaction, reactionSheet } from './reactui.js';

const CREDS = 'games.rooms';
export const NAME_KEY = 'games.name';
export const FACE_KEY = 'games.face';

export function roomCreds(code) {
  try { return (JSON.parse(localStorage.getItem(CREDS) || '{}'))[code] || null; } catch { return null; }
}
function saveCreds(code, c) {
  let all = {};
  try { all = JSON.parse(localStorage.getItem(CREDS) || '{}'); } catch { /* reset */ }
  if (c) all[code] = { ...c, at: Date.now() };
  else delete all[code];
  // Keep only the 5 most recent rooms.
  const keep = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, 5);
  localStorage.setItem(CREDS, JSON.stringify(Object.fromEntries(keep)));
}
export function recentRoom() {
  try {
    const all = Object.entries(JSON.parse(localStorage.getItem(CREDS) || '{}'));
    const [code, c] = all.sort((a, b) => b[1].at - a[1].at)[0] || [];
    return code && Date.now() - c.at < 3 * 60 * 60_000 ? { code, ...c } : null;
  } catch { return null; }
}

const savedFace = () => { const f = localStorage.getItem(FACE_KEY); return AVATARS.includes(f) ? f : null; };

// opts: { code } to join/rejoin, or { create: { gameId, variant, name, avatar, options } }
export function runRoom(root, opts, { navigate, menu, rules }) {
  let code = opts.code || null;
  let sock = null;
  let last = null; // last { t:'state' } message
  let game = null; // loaded module for last.room.gameId
  let status = 'connecting';
  let ended = null;
  let joining = false;
  let lastHostId = null;
  let mounted = false;
  let surface = null;
  let firstState = true;
  let nightKey = '';
  let lastPhase = null;
  let wasOver = null;
  let playerCount = null;
  let howtoFor = null;
  let peeked = null;
  let metas = new Map();
  gameIndex().then((list) => { metas = new Map(list.map((g) => [g.id, g])); }).catch(() => {});

  root.innerHTML = `<div class="screen room-screen">
    <div id="net" class="netbar" hidden></div>
    <div id="room-body" class="room-body"></div>
  </div>`;
  const screenEl = root.querySelector('.room-screen');
  const body = root.querySelector('#room-body');
  const net = root.querySelector('#net');

  let formUp = false;
  const netbar = createNetBar(net, { onRetry: () => sock && sock.reconnectNow() });
  function setStatus(s) {
    status = s;
    // The join form is already usable once connected: no "Connecting" over it.
    if (s === 'open' || ended || (formUp && s === 'connecting')) return netbar.hide();
    netbar.show(s === 'connecting' ? 'Connecting...' : 'Reconnecting...');
  }

  async function subscribe() {
    if (ended) return;
    if (opts.create && !code) {
      const r = await sock.request({ t: 'create', ...opts.create }, { subscribe: true });
      if (r.error) return showCreateError(r);
      sock.markReady();
      return;
    }
    const creds = roomCreds(code);
    if (!creds) return showJoinForm();
    const r = await sock.request({ t: 'join', code, token: creds.token }, { subscribe: true });
    if (r.error) {
      if (r.code === 'gone') { saveCreds(code, null); return showJoinForm(r.error); }
      if (r.code === 'noroom') { saveCreds(code, null); return showEnded(r.error); }
      return showJoinForm(r.error);
    }
    sock.markReady();
  }

  function onMessage(msg) {
    if (msg.t === 'joined') {
      code = msg.code;
      const name = last?.room?.players?.find((p) => p.id === msg.playerId)?.name || localStorage.getItem(NAME_KEY) || '';
      saveCreds(code, { playerId: msg.playerId, token: msg.token, name });
      if (location.pathname !== `/r/${code}`) history.replaceState({}, '', `/r/${code}`);
      return;
    }
    if (msg.t === 'peeked') { peeked = msg; return drawPeek(); }
    if (msg.t === 'state') {
      // A late or repeated state (a re-join answers with the current one) is
      // dropped before it can touch the clock or the screen.
      if (last && msg.seq <= last.seq && msg.room.code === last.room.code) return;
      ui.syncClock(msg.now);
      last = msg;
      drinkui.handleDrink(msg.drink, { players: msg.room.players, me: msg.room.you, surface: 'player', first: firstState });
      return renderState();
    }
    if (msg.t === 'reaction') return floatReaction(msg.emoji);
    if (msg.t === 'kicked') {
      saveCreds(code, null);
      return showEnded('The host removed you from this room.');
    }
    if (msg.t === 'closed') {
      saveCreds(code, null);
      return showEnded(msg.reason || 'This room has closed.');
    }
  }

  function connect() {
    sock = new RoomSocket({ onMessage, onStatus: setStatus, onOpen: subscribe });
    sock.connect();
  }

  /* ---------- non-room states ---------- */

  function showCreateError(r) {
    body.innerHTML = String(ui.html`<div class="state-card">${ui.icon('wifiOff', 36)}<h2>Couldn't create the room</h2>
      <p class="err-detail">${r.error}</p>
      <button class="btn btn-primary" id="retry">${ui.icon('refresh', 18)} Try again</button>
      <a class="btn btn-secondary" href="/">Back to games</a></div>`);
    body.querySelector('#retry').addEventListener('click', () => { body.innerHTML = loadingCard('Creating your room...'); subscribe(); });
  }

  function showEnded(reason) {
    ended = reason;
    netbar.hide();
    if (sock) sock.close();
    ui.keepAwake(false);
    body.innerHTML = String(ui.html`<div class="state-card">
      <div class="ended-mark">${ui.icon('leave', 40)}</div>
      <h2>Room ${code || ''} is over</h2>
      <p>${reason}</p>
      <a class="btn btn-primary" href="/">Start a new game</a>
      <a class="btn btn-secondary" href="/join">Join another room</a>
    </div>`);
  }

  // What the link leads to, drawn once the server answers the peek.
  function drawPeek() {
    const box = body.querySelector('#join-peek');
    if (!box || !peeked) return;
    const m = metas.get(peeked.gameId);
    if (!m) { gameIndex().then(() => setTimeout(drawPeek, 0)).catch(() => {}); return; }
    ui.applyTheme(screenEl, m);
    box.hidden = false;
    box.innerHTML = String(ui.html`<span class="game-row-ico">${ui.raw(gameIcon(m, 36))}</span>
      <span><strong>${m.name}</strong><span>${peeked.host ? `${peeked.host} is hosting` : 'Waiting for a host'} · ${ui.plural(peeked.players, 'player')}${peeked.variant !== 'standard' ? ` · ${ui.TIER_LABEL[peeked.variant]}` : ''}</span></span>`);
  }

  async function showJoinForm(error = '') {
    formUp = true;
    netbar.hide();
    mounted = false;
    surface = null;
    const name = localStorage.getItem(NAME_KEY) || '';
    let face = savedFace() || AVATARS[Math.floor(Math.random() * AVATARS.length)];
    const faceBtn = () => ui.avatar({ name: name || '?', color: COLORS[0], avatar: face }, 60);
    body.innerHTML = String(ui.html`<form class="join-card" id="join-form" novalidate>
      <div class="code-tiles sm" aria-label="Room code ${code}">${[...code].map((ch, i) => ui.html`<span style="--i:${i}">${ch}</span>`)}</div>
      <div class="join-peek" id="join-peek" hidden></div>
      <div class="join-face">
        <button type="button" class="face-btn" id="join-face" aria-label="Change your face" title="Change face">${faceBtn()}</button>
        <div style="flex:1">
          <label class="field-label" for="join-name">Your name</label>
          <input id="join-name" name="name" class="input input-xl" maxlength="20" autocomplete="nickname" autocapitalize="words" enterkeyhint="go" value="${name}" required>
        </div>
      </div>
      <p class="field-error" id="join-err" role="alert">${error}</p>
      <button class="btn btn-primary btn-xl" type="submit" id="join-go">${name ? `Join as ${name}` : 'Join room'}</button>
      <a class="btn btn-ghost" href="/">Back to games</a>
    </form>`);
    const form = body.querySelector('#join-form');
    const input = form.querySelector('#join-name');
    const err = form.querySelector('#join-err');
    const go = form.querySelector('#join-go');
    if (!name) setTimeout(() => input.focus(), 50);
    form.querySelector('#join-face').addEventListener('click', (e) => {
      face = AVATARS[(AVATARS.indexOf(face) + 1) % AVATARS.length];
      e.currentTarget.innerHTML = String(faceBtn());
      ui.haptic('tap');
      sfx.pop();
    });
    input.addEventListener('input', () => {
      err.textContent = '';
      input.removeAttribute('aria-invalid');
      const n = input.value.trim();
      go.textContent = n ? `Join as ${n}` : 'Join room';
    });
    sock.request({ t: 'peek', code }, { subscribe: true }).then((r) => {
      if (r.error && r.code === 'noroom') { saveCreds(code, null); showEnded(r.error); }
    });
    drawPeek();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (joining) return;
      const n = input.value.trim();
      if (!n) { err.textContent = 'Type your name first.'; input.setAttribute('aria-invalid', 'true'); input.focus(); ui.haptic('warn'); return; }
      joining = true;
      go.classList.add('busy');
      go.textContent = 'Joining';
      localStorage.setItem(NAME_KEY, n);
      localStorage.setItem(FACE_KEY, face);
      const r = await sock.request({ t: 'join', code, name: n, avatar: face }, { subscribe: true });
      joining = false;
      if (r.error) {
        go.classList.remove('busy');
        go.textContent = `Join as ${n}`;
        if (r.code === 'noroom') { saveCreds(code, null); return showEnded(r.error); }
        err.textContent = r.error;
        input.setAttribute('aria-invalid', 'true');
        ui.haptic('warn');
        return;
      }
      ui.haptic('success');
      sfx.pop();
      sock.markReady();
    });
  }

  const loadingCard = (text) => `<div class="state-card"><span class="spinner"></span><p>${ui.esc(text)}</p><p class="slow-note">Still working. The connection or server may be slow; this keeps retrying.</p></div>`;

  /* ---------- room states ---------- */

  async function renderState() {
    formUp = false;
    const room = last.room;
    if (!game || game.id !== room.gameId) {
      try {
        game = await loadGame(room.gameId);
      } catch (err) {
        body.innerHTML = String(ui.html`<div class="state-card"><h2>Couldn't load ${room.gameId}</h2><p class="err-detail">${err.message}</p><button class="btn btn-primary" id="retry">Try again</button></div>`);
        body.querySelector('#retry').addEventListener('click', () => { game = null; renderState(); });
        return;
      }
    }
    ui.applyTheme(screenEl, room.phase === 'between' || room.phase === 'recap' ? null : game.meta);
    const me = room.players.find((p) => p.id === room.you);
    if (me) {
      saveCreds(room.code, { ...roomCreds(room.code), name: me.name });
      if (me.avatar) localStorage.setItem(FACE_KEY, me.avatar);
    }
    if (lastHostId && room.hostId !== lastHostId) {
      const h = room.players.find((p) => p.id === room.hostId);
      if (h) ui.toast(h.id === room.you ? 'You are the host now' : `${h.name} is the host now`, 'info');
      if (h && h.id === room.you) ui.haptic('success');
    }
    lastHostId = room.hostId;
    // Someone new walked in: a pop on the host's phone.
    if (playerCount !== null && room.players.length > playerCount && room.hostId === room.you && room.phase === 'lobby') sfx.pop();
    playerCount = room.players.length;
    // A game just finished: celebrate, and offer the home-screen install.
    const over = room.phase === 'game' && room.over;
    if (wasOver === false && over) {
      fx.confetti({ colors: [getComputedStyle(screenEl).getPropertyValue('--accent').trim(), '#ffb347', '#f7f3ff', ...room.players.map((p) => p.color)] });
      sfx.fanfare();
      install.afterGame();
    }
    if ((lastPhase === 'game' && room.phase === 'between')) install.afterGame();
    wasOver = room.phase === 'game' ? over : null;
    lastPhase = room.phase;
    if (room.phase === 'lobby') renderLobby();
    else if (room.phase === 'between' || room.phase === 'recap') renderNight();
    else renderGame();
    firstState = false;
  }

  function shell() {
    if (mounted) return;
    mounted = true;
    body.innerHTML = `<header class="playbar">
        <button class="icon-btn" id="rm-menu" aria-label="Room menu" title="Room menu">${ui.icon('more')}</button>
        <div class="playbar-title" id="rm-title"></div>
        <button class="code-chip" id="rm-code" aria-label="Share the room code" title="Share the room code"></button>
      </header>
      <div id="rm-now" class="now" role="status" aria-live="polite"></div>
      <main id="rm-main" class="surface"></main>
      <div id="rm-host" class="hostbar"></div>`;
    surface = createSurface(body.querySelector('#rm-main'), {
      act: (type, payload) => sock.request({ t: 'act', type, payload }, { queue: true, timeout: 60_000 }),
    });
    body.querySelector('#rm-menu').addEventListener('click', openMenu);
    body.querySelector('#rm-code').addEventListener('click', () => shareSheet());
    body.querySelector('#rm-title').addEventListener('click', (e) => { if (e.target.closest('#drink-chip')) openDrinks(); });
  }

  function setHTML(el, html) {
    if (el.dataset.html === html) return;
    el.dataset.html = html;
    el.innerHTML = html;
  }

  function header() {
    const room = last.room;
    const night = room.phase === 'between' || room.phase === 'recap';
    const title = night ? 'Party Night' : game.meta.name;
    const chip = drinkui.chip(last.drink, room.you);
    const audience = room.audienceIds && room.audienceIds.length
      ? String(ui.html`<span class="pill" title="Watching from the crowd">${ui.icon('users', 14)} ${room.audienceIds.length}</span>`)
      : '';
    // Only touch the bar when it changed: most states (someone answered) leave it as is.
    setHTML(body.querySelector('#rm-title'), `${night ? '' : gameIcon(game.meta, 26)}<span>${ui.esc(title)}</span>${chip || ui.tierPill(room.variant)}${audience}`);
    setHTML(body.querySelector('#rm-code'), `${ui.icon('share', 16)}<span>${ui.esc(room.code)}</span>`);
  }

  const nowEl = () => body.querySelector('#rm-now');

  function openDrinks() {
    const room = last.room;
    if (!last.drink) return;
    drinkui.drinkSheet({
      drink: last.drink, players: room.players, me: room.you, isHost: room.hostId === room.you, mode: 'room',
      onOut: (id, on) => sock.request({ t: 'drink', out: on }).then((r) => { if (r.error) ui.toast(r.error, 'error'); }),
      onTier: (t) => hostOp('setVariant', { variant: t }),
      onCap: (n) => hostOp('setShotCap', { shotCap: n }),
    });
  }

  function hostBar(actions, extra = '', platform = []) {
    const el = body.querySelector('#rm-host');
    // Once the game is over the platform's "Standings" is the next step, so
    // the game's own buttons step back.
    const tone = (a) => (platform.length && a.tone === 'primary' ? 'secondary' : a.tone || 'secondary');
    el.innerHTML = (actions || []).map((a, i) => `<button class="btn btn-${ui.esc(tone(a))}" data-i="${i}">${ui.esc(a.label)}</button>`).join('')
      + platform.map((a, i) => `<button class="btn btn-${ui.esc(a.tone || 'secondary')}" data-op="${i}">${ui.esc(a.label)}</button>`).join('') + extra;
    el.classList.toggle('empty', !el.innerHTML);
    el.querySelectorAll('[data-op]').forEach((b) => b.addEventListener('click', async () => {
      const a = platform[Number(b.dataset.op)];
      ui.haptic('tap');
      sfx.blip();
      const r = await hostOp(a.op, a.extra || {}, b);
      if (!r.error) ui.haptic('success');
    }));
    el.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', async () => {
      const a = actions[Number(b.dataset.i)];
      if (a.confirm && !(await ui.confirm(a.confirm, { ok: a.label, danger: a.tone === 'danger' }))) return;
      b.classList.add('busy');
      ui.haptic('tap');
      sfx.blip();
      const r = await sock.request({ t: 'act', type: a.type, payload: a.payload ?? null }, { queue: true, timeout: 60_000 });
      b.classList.remove('busy');
      if (r.error) { ui.toast(r.error, 'error'); ui.haptic('warn'); }
    }));
    return el;
  }

  async function hostOp(op, extra = {}, btn = null) {
    if (btn) btn.classList.add('busy');
    const r = await sock.request({ t: 'host', op, ...extra });
    if (btn && btn.isConnected) btn.classList.remove('busy');
    if (r.error) { ui.toast(r.error, 'error'); ui.haptic('warn'); }
    return r;
  }

  // One line under the game card: tier, the options that differ from
  // their defaults, pack and teams. Tapping it opens the settings sheet.
  function settingsSummary(room, meta) {
    const bits = [];
    for (const o of meta.options) {
      const v = room.options[o.key];
      if (o.type === 'stepper') bits.push(`${v}${o.suffix || ''} ${o.label.toLowerCase()}`);
      else if (o.type === 'choice') bits.push((o.choices.find((c) => c.value === v) || {}).label || String(v));
      else if (o.type === 'toggle' && v) bits.push(o.label);
      else if (o.type === 'multi') bits.push(`${(v || []).length} ${o.label.toLowerCase()}`);
    }
    if (room.variant === 'deadly' && last.drink) bits.push(`shot cap ${last.drink.shotCap}`);
    // A picked pack goes first: a game with four options would otherwise push it past the cut below.
    if (hasPacks(meta)) { if (room.pack) bits.unshift(room.pack.title); else bits.push('built-in deck'); }
    if (meta.teams) bits.push(room.teams ? ui.plural(room.teams.length, 'team') : 'no teams');
    if (meta.audience && room.forcedAudience && room.forcedAudience.length) bits.push(`${ui.plural(room.forcedAudience.length, 'player')} watching`);
    return bits.slice(0, 4).join(' · ');
  }

  async function settingsSheet() {
    const room = last.room;
    const meta = game.meta;
    await ui.sheet({
      title: `${meta.name} settings`,
      className: 'sheet-settings',
      body: ui.html`
        ${room.variant === 'deadly' ? ui.html`<div class="opt opt-stepper shotcap"><span class="opt-label">Shot cap<small>per player, per hour</small></span>
          <div class="stepper"><button type="button" data-cap="-1" aria-label="Lower the shot cap" ${last.drink && last.drink.shotCap <= 0 ? 'disabled' : ''}>&minus;</button><output>${last.drink ? last.drink.shotCap : 2}</output><button type="button" data-cap="1" aria-label="Raise the shot cap" ${last.drink && last.drink.shotCap >= MAX_SHOT_CAP ? 'disabled' : ''}>+</button></div></div>` : ''}
        ${meta.options.length ? ui.raw(optionsForm(meta.options, room.options, { id: 'st-opts' })) : ''}
        <h2 class="sec">More</h2>
        <div class="plist">
        ${hasPacks(meta) ? (() => { const p = packSummary(meta, room.pack); return ui.html`<button type="button" class="settings-row pack-btn" id="st-pack" aria-haspopup="dialog">${p.emoji ? ui.html`<span class="pk-art" aria-hidden="true">${p.emoji}</span>` : ui.icon('list', 20)}<span><b>Pack: ${p.title}</b><small>${p.sub}</small></span>${ui.icon('back', 18)}</button>`; })() : ''}
        ${meta.teams ? ui.html`<button type="button" class="settings-row" id="st-teams">${ui.icon('users', 20)}<span><b>Teams</b><small>${room.teams ? room.teams.map((t) => t.name).join(', ') : 'Everyone solo'}</small></span>${ui.icon('back', 18)}</button>` : ''}
        ${meta.audience ? ui.html`<button type="button" class="settings-row" id="st-crowd">${ui.icon('eye', 20)}<span><b>Crowd</b><small>${room.forcedAudience && room.forcedAudience.length ? `${ui.plural(room.forcedAudience.length, 'player')} watching` : 'Everyone plays'}</small></span>${ui.icon('back', 18)}</button>` : ''}
        <button type="button" class="settings-row" id="st-box">${ui.icon('hostbox', 20)}<span><b>Host Box</b><small>${room.box ? (room.box.connected ? 'Connected' : 'Offline') : 'Not paired'}</small></span>${ui.icon('back', 18)}</button>
        </div>`,
      actions: [{ label: 'Done', tone: 'primary', value: 'done' }],
      onOpen(wrap, done) {
        const form = wrap.querySelector('#st-opts');
        if (form) wireOptionsForm(form, meta.options, room.options, (o) => hostOp('setOptions', { options: o }));
        let cap = last.drink ? last.drink.shotCap : 2;
        wrap.querySelectorAll('[data-cap]').forEach((b) => b.addEventListener('click', async () => {
          cap = Math.max(0, Math.min(MAX_SHOT_CAP, cap + Number(b.dataset.cap)));
          wrap.querySelector('.shotcap output').textContent = String(cap);
          wrap.querySelector('[data-cap="-1"]').disabled = cap <= 0;
          wrap.querySelector('[data-cap="1"]').disabled = cap >= MAX_SHOT_CAP;
          ui.haptic('tap');
          hostOp('setShotCap', { shotCap: cap });
        }));
        wrap.querySelector('#st-pack')?.addEventListener('click', async () => {
          done('pack');
          const result = await pickPackSheet(meta, room.pack || null);
          if (result === undefined) return;
          const r = await hostOp('setPack', { packCode: result ? result.code : null });
          if (!r.error) ui.toast(result ? `Playing with ${result.title}` : 'Playing with the built-in deck', 'info');
        });
        wrap.querySelector('#st-teams')?.addEventListener('click', () => { done('teams'); teamsSheet(); });
        wrap.querySelector('#st-crowd')?.addEventListener('click', () => { done('crowd'); crowdSheet(); });
        wrap.querySelector('#st-box')?.addEventListener('click', () => { done('box'); boxSheet(); });
      },
    });
  }

  async function renderLobby() {
    shell();
    header();
    surface.reset();
    ui.keepAwake(false);
    const room = last.room;
    const isHost = room.hostId === room.you;
    const meta = game.meta;
    const count = room.players.length;
    const need = Math.max(0, meta.minPlayers - count);
    const host = room.players.find((p) => p.host);
    const me = room.players.find((p) => p.id === room.you);
    const ready = room.players.filter((p) => p.ready || p.host).length;
    const main = body.querySelector('#rm-main');
    const seats = room.players.map((p, i) => {
      const team = room.teams && room.teams.find((t) => t.memberIds.includes(p.id));
      const mine = p.id === room.you;
      const tag = p.host ? 'Host' : !p.connected ? 'Offline' : p.ready ? 'Ready' : mine ? 'You' : 'Joined';
      return ui.html`<li class="seat ${mine ? 'me' : ''} ${p.ready ? 'ready' : ''} ${p.connected ? '' : 'offline'}" style="--i:${i};animation-delay:${i * 40}ms">
        <button class="seat-btn" data-player="${p.id}" ${isHost || mine ? '' : 'disabled'} aria-label="${p.name}${mine ? ' (you)' : ''}${p.host ? ', host' : ''}${p.ready ? ', ready' : ''}">
          ${ui.avatar(p, 58)}
          <span class="seat-name">${p.name}</span>
          <span class="seat-tag">${tag}</span>
        </button>
        ${p.host ? ui.html`<span class="crown" title="Host">${ui.icon('crown', 18, 'Host')}</span>` : ''}
        ${p.ready && !p.host ? ui.html`<span class="badge-ready" aria-hidden="true">${ui.icon('check', 14)}</span>` : ''}
        ${team ? ui.html`<span class="team-dot" style="--c:${team.color}" title="${team.name}"></span>` : ''}
        ${isHost && !mine ? ui.html`<button class="seat-kick" data-kick="${p.id}" aria-label="Remove ${p.name}" title="Remove ${p.name}">${ui.icon('close', 16)}</button>` : ''}
      </li>`;
    });
    const empties = Array.from({ length: need }, (_, i) => ui.html`<li class="seat seat-empty"><button class="seat-btn" data-invite aria-label="Invite a player">
      <span class="av" style="--s:58px">${ui.icon('plus', 22)}</span><span class="seat-name">Waiting</span><span class="seat-tag">Need ${need - i === 1 && i === 0 ? '1 more' : 'more'}</span></button></li>`);

    main.innerHTML = String(ui.html`<div class="lobby">
      <section class="lobby-code">
        <div class="code-tiles" aria-label="Room code ${room.code}">${[...room.code].map((ch, i) => ui.html`<span style="--i:${i}">${ch}</span>`)}</div>
        <div class="code-actions">
          <button class="btn btn-secondary" id="lb-share">${ui.icon('share', 18)} Invite</button>
          <button class="btn btn-secondary" id="lb-qr">${ui.icon('qr', 18)} QR code</button>
          <button class="btn btn-secondary" id="lb-tv">${ui.icon('tv', 18)} Show on TV</button>
        </div>
      </section>

      <section class="lobby-players">
        <div class="lobby-head"><h2 class="sec">Players</h2><span class="lobby-count"><b>${ready}</b> of ${count} ready${need ? ` · need ${need} more` : ''}</span></div>
        <ul class="seats">${seats}${empties}</ul>
      </section>

      <section class="lobby-game">
        <button class="game-row ${isHost ? '' : 'static'}" id="lb-game" ${isHost ? '' : 'disabled'}>
          <span class="game-row-ico">${ui.raw(gameIcon(meta, 36))}</span>
          <span class="game-row-text"><strong>${meta.name}</strong><span>${meta.minPlayers}-${meta.maxPlayers} players</span></span>
          ${isHost ? ui.html`<span class="chev">Change ${ui.icon('back', 14)}</span>` : ''}
        </button>
        ${isHost ? ui.html`
          <div class="seg seg-3" role="radiogroup" aria-label="Drinking tier">
            <button role="radio" aria-checked="${room.variant === 'standard'}" class="seg-btn ${room.variant === 'standard' ? 'on' : ''}" data-variant="standard">${ui.icon('star', 16)} Standard</button>
            <button role="radio" aria-checked="${room.variant === 'drinking'}" class="seg-btn amber ${room.variant === 'drinking' ? 'on' : ''}" data-variant="drinking">${ui.icon('glass', 16)} Drinking</button>
            <button role="radio" aria-checked="${room.variant === 'deadly'}" class="seg-btn deadly ${room.variant === 'deadly' ? 'on' : ''}" data-variant="deadly">${ui.icon('skull', 16)} Deadly</button>
          </div>
          <p class="variant-line">${meta.variants[room.variant] || meta.variants.drinking}</p>
          <button class="settings-row" id="lb-settings">${ui.icon('edit', 20)}<span><b>Settings</b><small>${settingsSummary(room, meta) || 'Defaults'}</small></span>${ui.icon('back', 18)}</button>`
        : ui.html`<div class="lobby-howto">
            <h2>${ui.tierPill(room.variant, 16)}</h2>
            ${stepsHTML(meta)}
            <p class="variant-line">${meta.variants[room.variant] || ''}</p>
            <button class="btn btn-ghost" id="lb-rules">${ui.icon('book', 18)} Full rules</button>
          </div>`}
      </section>

      ${isHost || room.night.queue.length || room.night.played.length ? ui.html`<section class="lobby-night">
        <h2 class="sec">Party Night</h2>
        ${room.night.queue.length || room.night.played.length
          ? ui.html`<ol class="queue">
              ${room.night.played.length ? ui.html`<li class="q-done">${ui.icon('check', 16)}<span>${ui.plural(room.night.played.length, 'game')} played tonight</span></li>` : ''}
              <li class="q-now">${ui.raw(gameIcon(meta, 24))}<span>${meta.name}</span><em>${room.night.played.length ? 'next up' : 'first up'}</em></li>
              ${room.night.queue.map((id, i) => {
                const m = metas.get(id) || { id, name: id, emoji: '' };
                return ui.html`<li>${ui.raw(gameIcon(m, 24))}<span>${m.name}</span>${isHost ? ui.html`<button class="icon-btn" data-unqueue="${i}" aria-label="Take ${m.name} out of the night" title="Remove">${ui.icon('close', 16)}</button>` : ''}</li>`;
              })}
            </ol>`
          : ui.html`<p class="night-empty">${ui.icon('list', 18)}<span>Line up a few games and scores, sips and shots carry across them, with standings in between and awards at the end.</span></p>`}
        ${isHost ? ui.html`<button class="btn btn-secondary" id="lb-queue">${ui.icon('plus', 18)} Add a game to the night</button>` : ''}
      </section>` : ''}
    </div>`);

    if (isHost) {
      const allReady = ready === count;
      ui.setNow(nowEl(), need > 0
        ? { text: `Get ${need} more ${need === 1 ? 'player' : 'players'} in: share the code`, tone: 'act' }
        : allReady ? { text: 'Everyone is ready. Start when you like', tone: 'act' } : { text: `${count - ready} not ready yet. You can start anyway`, tone: 'wait' }, { first: firstState });
      const label = need > 0 ? `Need ${need} more player${need === 1 ? '' : 's'}` : `Start ${meta.name}`;
      const el = hostBar([], `<button class="btn btn-primary btn-xl" id="lb-start" ${need > 0 ? 'aria-disabled="true"' : ''}>${ui.icon('play', 22)} ${ui.esc(label)}</button>`);
      el.querySelector('#lb-start').addEventListener('click', async (e) => {
        if (need > 0) { ui.toast(`Need ${need} more. Share the code or QR.`, 'info'); ui.haptic('warn'); return; }
        const r = await hostOp('start', {}, e.currentTarget);
        if (!r.error) { ui.haptic('success'); sfx.whoosh(); }
      });
    } else {
      const imReady = me && me.ready;
      ui.setNow(nowEl(), imReady
        ? { text: `Waiting for ${host ? host.name : 'the host'} to start`, tone: 'wait' }
        : { text: 'Tap Ready when you are', tone: 'act' }, { first: firstState });
      const el = hostBar([], `<button class="btn btn-xl ready-btn ${imReady ? 'on btn-good' : 'btn-primary'}" id="lb-ready" aria-pressed="${!!imReady}">${ui.icon('check', 22)} ${imReady ? "I'm ready" : 'Ready'}</button>`);
      el.querySelector('#lb-ready').addEventListener('click', async (e) => {
        const b = e.currentTarget;
        b.classList.add('busy');
        const r = await sock.request({ t: 'ready', on: !imReady });
        if (b.isConnected) b.classList.remove('busy');
        if (r.error) { ui.toast(r.error, 'error'); ui.haptic('warn'); return; }
        ui.haptic(imReady ? 'tap' : 'success');
        if (!imReady) sfx.good();
      });
    }

    main.querySelector('#lb-share').addEventListener('click', () => shareSheet());
    main.querySelector('#lb-qr').addEventListener('click', () => shareSheet(true));
    main.querySelector('#lb-tv').addEventListener('click', () => showOnTv(room.code));
    main.querySelector('#lb-rules')?.addEventListener('click', () => rules(meta.id, meta.name));
    main.querySelectorAll('[data-invite]').forEach((b) => b.addEventListener('click', () => shareSheet(true)));
    if (isHost) {
      main.querySelector('#lb-game').addEventListener('click', pickGame);
      main.querySelectorAll('[data-variant]').forEach((b) => b.addEventListener('click', async () => {
        const v = b.dataset.variant;
        if (v === room.variant) return;
        if (v !== 'standard' && !(await ui.ageGate(v))) return;
        localStorage.setItem('games.tier', v);
        hostOp('setVariant', { variant: v }, b);
        if (v === 'deadly') sfx.land(); else sfx.blip();
      }));
      main.querySelector('#lb-settings').addEventListener('click', settingsSheet);
      main.querySelector('#lb-queue')?.addEventListener('click', addToNight);
      main.querySelectorAll('[data-unqueue]').forEach((b) => b.addEventListener('click', () => {
        ui.haptic('tap');
        hostOp('queueRemove', { index: Number(b.dataset.unqueue) }, b);
      }));
      main.querySelectorAll('[data-kick]').forEach((b) => b.addEventListener('click', () => kick(b.dataset.kick)));
    }
    main.querySelectorAll('[data-player]').forEach((b) => b.addEventListener('click', () => playerSheet(b.dataset.player)));
    if (room.variant !== 'standard' && !isHost) ui.ageGate(room.variant).then((ok) => { if (!ok) leave(true); });
  }

  async function kick(pid) {
    const p = last.room.players.find((x) => x.id === pid);
    if (!p) return;
    if (!(await ui.confirm(`Remove ${p.name} from the room?`, { ok: `Remove ${p.name}`, danger: true, title: `Remove ${p.name}?` }))) return;
    ui.haptic('danger');
    const r = await hostOp('kick', { playerId: pid });
    if (!r.error) ui.toast(`${p.name} removed. They can rejoin with the code.`, 'info');
  }

  async function addToNight() {
    const list = (await gameIndex()).filter((g) => g.modes.includes('room'));
    const id = await nightui.pickGameSheet('Add to the night', list, { players: last.room.players.length });
    if (id) {
      const r = await hostOp('queueAdd', { gameId: id });
      if (!r.error) { ui.toast(`${(metas.get(id) || {}).name || 'Game'} added to the night`, 'info'); ui.haptic('success'); }
    }
  }

  // Between games (standings) and the end of the night (awards).
  function renderNight() {
    shell();
    header();
    ui.keepAwake(true);
    const room = last.room;
    const isHost = room.hostId === room.you;
    const d = { night: room.night, players: room.players, drink: last.drink, metaOf: (id) => metas.get(id) || null };
    const key = JSON.stringify([room.phase, room.night, room.players, last.drink && last.drink.tally, isHost, metas.size, room.gameId, room.options, room.teams, room.forcedAudience]);
    const host = room.players.find((p) => p.host);
    ui.setNow(nowEl(), room.phase === 'recap'
      ? { text: 'The awards are on. Look up at the TV', tone: 'watch' }
      : isHost ? { text: 'Pick the next game, or go to the awards', tone: 'act' } : { text: `${host ? host.name : 'The host'} picks what's next`, tone: 'wait' }, { first: firstState });
    if (key !== nightKey) {
      const still = nightKey.startsWith(`["${room.phase}"`);
      nightKey = key;
      surface.reset();
      const main = body.querySelector('#rm-main');
      main.innerHTML = String(room.phase === 'recap'
        ? ui.html`${nightui.recapHTML(d, { still })}<div class="nt-actions"><button class="btn btn-amber btn-xl" id="nt-share">${ui.icon('share', 20)} Share the recap image</button></div>`
        : nightui.standingsHTML(d, { still }));
      main.querySelector('#nt-share')?.addEventListener('click', (e) => nightui.shareRecap(d, e.currentTarget));
      // Settings for the next queued game (the room's game between games).
      const nm = room.phase === 'between' && room.night.queue[0] === room.gameId ? metas.get(room.gameId) : null;
      if (isHost && nm && (nm.options.length || nm.teams || nm.audience)) {
        const sec = document.createElement('section');
        sec.className = 'nt-opts';
        sec.innerHTML = `<h2 class="sec">${ui.esc(nm.name)} settings</h2>
          ${nm.options.length ? optionsForm(nm.options, room.options, { id: 'nt-opts' }) : ''}
          ${nm.teams || nm.audience ? ui.html`<div class="plist">
            ${nm.teams ? ui.html`<button type="button" class="settings-row" id="nt-teams">${ui.icon('users', 20)}<span><b>Teams</b><small>${room.teams ? room.teams.map((t) => t.name).join(', ') : 'Everyone solo'}</small></span>${ui.icon('back', 18)}</button>` : ''}
            ${nm.audience ? ui.html`<button type="button" class="settings-row" id="nt-crowd">${ui.icon('eye', 20)}<span><b>Crowd</b><small>${room.forcedAudience && room.forcedAudience.length ? `${ui.plural(room.forcedAudience.length, 'player')} watching` : 'Everyone plays'}</small></span>${ui.icon('back', 18)}</button>` : ''}
          </div>` : ''}`;
        main.appendChild(sec);
        if (nm.options.length) wireOptionsForm(sec.querySelector('#nt-opts'), nm.options, room.options, (opts) => hostOp('setOptions', { options: opts }));
        sec.querySelector('#nt-teams')?.addEventListener('click', teamsSheet);
        sec.querySelector('#nt-crowd')?.addEventListener('click', crowdSheet);
      }
    }
    if (!isHost) {
      hostBar([], `<div class="wait-host">${ui.avatar(host, 28)}<span>${room.phase === 'recap' ? 'Thanks for playing' : `${ui.esc(host ? host.name : 'The host')} picks what's next`}</span>${room.phase === 'recap' ? '' : '<span class="dots"><i></i><i></i><i></i></span>'}</div>`);
      return;
    }
    const next = room.night.queue[0] && metas.get(room.night.queue[0]);
    const platform = room.phase === 'recap'
      ? [{ op: 'newNight', label: 'New night', tone: 'primary' }]
      : [
        next ? { op: 'next', label: `Play ${next.name}`, tone: 'primary' } : null,
        { op: 'recap', label: 'Awards', tone: next ? 'secondary' : 'primary' },
      ].filter(Boolean);
    const el = hostBar([], `<button class="btn btn-secondary" id="nt-pick">${room.phase === 'recap' ? 'Back to lobby' : next ? 'Other game' : 'One more game'}</button>`, platform);
    el.querySelector('#nt-pick').addEventListener('click', async () => {
      if (room.phase === 'recap') return hostOp('end');
      const list = (await gameIndex()).filter((g) => g.modes.includes('room'));
      const id = await nightui.pickGameSheet('Next game', list, { players: room.players.length, current: room.night.queue[0] });
      if (id) hostOp('next', { gameId: id });
    });
  }

  function renderGame() {
    shell();
    header();
    ui.keepAwake(true);
    document.body.dataset.awake = '1';
    const room = last.room;
    const me = room.players.find((p) => p.id === room.you);
    const api = makeApi({
      surface: 'player', me, players: room.players, hostId: room.hostId,
      isHost: room.hostId === room.you, mode: 'room', variant: room.variant,
    });
    nightKey = '';
    if (last.viewError) {
      body.querySelector('#rm-main').innerHTML = String(ui.html`<div class="state-card"><h2>The game hit a snag</h2><p class="err-detail">${last.viewError}</p></div>`);
      ui.setNow(nowEl(), null);
    } else {
      surface.render(game.client, 'player', last.view, api);
      let line = null;
      try { line = typeof game.client.now === 'function' ? game.client.now(last.view, api) : null; } catch (err) { console.error(err); }
      ui.setNow(nowEl(), line, { first: firstState });
    }
    hostBar(last.actions, '', last.platform || []);
    if (room.variant !== 'standard' && room.hostId !== room.you) ui.ageGate(room.variant).then((ok) => { if (!ok) leave(true); });
    // First game of this kind on this phone: three steps before anyone's lost.
    if (howtoFor !== game.id) {
      howtoFor = game.id;
      maybeHowto(game.meta, room.variant, { onRules: () => rules(game.meta.id, game.meta.name) });
    }
  }

  /* ---------- sheets ---------- */

  async function shareSheet(qrFirst = false) {
    const c = last.room.code;
    const link = `${location.origin}/r/${c}`;
    const canShare = !!navigator.share;
    const p = ui.sheet({
      title: `Join room ${c}`,
      className: 'sheet-share',
      body: ui.html`<div class="share">
        <img class="qr ${qrFirst ? 'big' : ''}" src="/qr/${c}.svg" width="220" height="220" alt="QR code linking to ${link}">
        <div class="share-link"><span>${link.replace(/^https?:\/\//, '')}</span></div>
        <div class="share-actions">
          ${canShare ? ui.html`<button class="btn btn-primary" data-value="share">${ui.icon('share', 18)} Share link</button>` : ''}
          <button class="btn ${canShare ? 'btn-secondary' : 'btn-primary'}" data-value="copy">${ui.icon('copy', 18)} Copy link</button>
          <button class="btn btn-secondary" data-value="tv">${ui.icon('tv', 18)} Show on TV</button>
        </div>
      </div>`,
    });
    const v = await p;
    if (v === 'share') {
      try { await navigator.share({ title: `Join my ${game.meta.name} game`, text: `Room ${c}`, url: link }); } catch { /* cancelled */ }
    } else if (v === 'copy') {
      try {
        await navigator.clipboard.writeText(link);
        ui.toast('Link copied', 'info');
        ui.haptic('success');
      } catch (err) {
        ui.toast('Could not copy the link', 'error', String(err.message || err));
      }
    } else if (v === 'tv') {
      showOnTv(c);
    }
  }

  const TEAM_NAMES = ['Team Red', 'Team Blue', 'Team Green', 'Team Amber', 'Team Violet', 'Team Teal'];

  async function teamsSheet() {
    const room = last.room;
    const current = room.teams || [];
    let n = Math.max(2, current.length || 2);
    const assign = {};
    for (const p of room.players) assign[p.id] = current.findIndex((t) => t.memberIds.includes(p.id));

    function draw(wrap) {
      wrap.querySelector('#tm-body').innerHTML = String(ui.html`
        <div class="opt opt-stepper">
          <span class="opt-label">${ui.plural(n, 'team')}</span>
          <div class="stepper">
            <button type="button" data-n="-1" aria-label="Fewer teams" ${n <= 2 ? 'disabled' : ''}>&minus;</button>
            <output>${n}</output>
            <button type="button" data-n="1" aria-label="More teams" ${n >= TEAM_COLORS.length ? 'disabled' : ''}>+</button>
          </div>
        </div>
        <ul class="tm-players">${room.players.map((p) => ui.html`<li>
          <button type="button" class="tm-chip" data-id="${p.id}" style="--c:${assign[p.id] >= 0 ? TEAM_COLORS[assign[p.id]] : 'var(--surface-3)'}">
            ${ui.avatar(p, 32)}<span>${p.name}</span><em>${assign[p.id] >= 0 ? TEAM_NAMES[assign[p.id]] : 'Unassigned'}</em>
          </button></li>`)}</ul>
        <button type="button" class="btn btn-secondary" id="tm-auto">${ui.icon('refresh', 18)} Auto-balance</button>
      `);
      wrap.querySelector('#tm-auto').addEventListener('click', () => {
        const shuffled = room.players.map((p) => p.id).sort(() => Math.random() - 0.5);
        shuffled.forEach((id, i) => { assign[id] = i % n; });
        ui.haptic('tap');
        draw(wrap);
      });
      wrap.querySelectorAll('[data-n]').forEach((b) => b.addEventListener('click', () => {
        n = Math.max(2, Math.min(TEAM_COLORS.length, n + Number(b.dataset.n)));
        for (const id in assign) if (assign[id] >= n) assign[id] = -1;
        ui.haptic('tap');
        draw(wrap);
      }));
      wrap.querySelectorAll('.tm-chip').forEach((b) => b.addEventListener('click', () => {
        const id = b.dataset.id;
        assign[id] = assign[id] + 1 >= n ? -1 : assign[id] + 1;
        ui.haptic('tap');
        draw(wrap);
      }));
    }

    const v = await ui.sheet({
      title: 'Teams',
      className: 'sheet-teams',
      body: ui.html`<div id="tm-body"></div>`,
      actions: [
        ...(current.length ? [{ label: 'No teams', value: 'off' }] : []),
        { label: 'Save teams', tone: 'primary', value: 'save' },
      ],
      onOpen(wrap) { draw(wrap); },
    });
    if (v === 'off') return hostOp('setTeams', { teams: null });
    if (v === 'save') {
      const teams = Array.from({ length: n }, (_, i) => ({
        name: TEAM_NAMES[i],
        memberIds: Object.keys(assign).filter((id) => assign[id] === i),
      }));
      const r = await hostOp('setTeams', { teams });
      if (!r.error) ui.haptic('success');
    }
  }

  // Send a player to the crowd: they watch and bet from their own phone
  // instead of playing, same seat as an overflow joiner past the cap.
  async function crowdSheet() {
    const room = last.room;
    const forced = new Set(room.forcedAudience || []);

    function draw(wrap) {
      wrap.querySelector('#cw-body').innerHTML = String(ui.html`
        <p class="sheet-text">Tap a player to send them to the crowd: they watch and bet from their phone instead of playing this game.</p>
        <ul class="tm-players">${room.players.map((p) => ui.html`<li>
          <button type="button" class="tm-chip" data-id="${p.id}" style="--c:${forced.has(p.id) ? 'var(--amber)' : 'var(--surface-3)'}">
            ${ui.avatar(p, 32)}<span>${p.name}</span><em>${forced.has(p.id) ? 'Watching' : 'Playing'}</em>
          </button></li>`)}</ul>
      `);
      wrap.querySelectorAll('.tm-chip').forEach((b) => b.addEventListener('click', () => {
        const id = b.dataset.id;
        if (forced.has(id)) forced.delete(id); else forced.add(id);
        ui.haptic('tap');
        draw(wrap);
      }));
    }

    const v = await ui.sheet({
      title: 'Crowd',
      className: 'sheet-teams',
      body: ui.html`<div id="cw-body"></div>`,
      actions: [{ label: 'Save', tone: 'primary', value: 'save' }],
      onOpen(wrap) { draw(wrap); },
    });
    if (v !== 'save') return;
    const prev = new Set(room.forcedAudience || []);
    const changed = room.players.filter((p) => prev.has(p.id) !== forced.has(p.id));
    for (const p of changed) await hostOp('setAudience', { playerId: p.id, audience: forced.has(p.id) });
    if (changed.length) ui.haptic('success');
  }

  const SLOT_LABELS = ['Glass 1', 'Glass 2', 'Glass 3', 'Glass 4', 'Glass 5', 'Glass 6'];

  async function boxSheet() {
    const room = last.room;
    const isHost = room.hostId === room.you;
    if (!isHost) {
      await ui.sheet({
        title: 'Host Box',
        body: ui.html`<div class="sheet-player"><span class="hb-dot ${room.box?.connected ? 'on' : 'off'}"></span><p>${room.box?.connected ? 'Connected' : 'Offline right now'}</p></div>`,
        actions: [{ label: 'Close', value: null }],
      });
      return;
    }
    if (!room.box) {
      const r = await ui.sheet({
        title: 'Add a Host Box',
        body: ui.html`<form id="hb-pair-form" novalidate>
          <label class="field-label" for="hb-box-id">Host Box ID</label>
          <input id="hb-box-id" class="input input-xl" maxlength="12" placeholder="e.g. 7F3KQZ" autocapitalize="characters" autocomplete="off">
          <p class="sheet-text">Shown on the box, or on the <a href="/hostbox" target="_blank" rel="noopener">virtual Host Box</a> if you are testing without hardware.</p>
        </form>`,
        actions: [{ label: 'Pair', tone: 'primary', value: 'pair' }, { label: 'Cancel', value: null }],
        collect: (wrap) => ({ boxId: wrap.querySelector('#hb-box-id').value.trim() }),
      });
      if (r && r.value === 'pair' && r.data.boxId) {
        const res = await hostOp('pairBox', { boxId: r.data.boxId });
        if (!res.error) { ui.toast('Host Box paired', 'info'); ui.haptic('success'); boxSheet(); }
      }
      return;
    }

    const slots = room.box.slots.slice();
    let asPlayerId = room.box.asPlayerId;

    function draw(wrap) {
      wrap.querySelector('#hb-seats').innerHTML = String(ui.html`<ul class="tm-players">${room.players.map((p) => {
        const slot = slots.indexOf(p.id);
        return ui.html`<li><button type="button" class="tm-chip" data-seat="${p.id}" style="--c:${slot >= 0 ? 'var(--accent)' : 'var(--surface-3)'}">
          ${ui.avatar(p, 32)}<span>${p.name}</span><em>${slot >= 0 ? SLOT_LABELS[slot] : 'No glass'}</em></button></li>`;
      })}</ul>`);
      wrap.querySelectorAll('[data-seat]').forEach((b) => b.addEventListener('click', () => {
        const pid = b.dataset.seat;
        const cur = slots.indexOf(pid);
        if (cur >= 0) {
          // Already seated: cycle to the next glass, or off the ring entirely.
          slots[cur] = null;
          if (cur + 1 < SLOT_LABELS.length) slots[cur + 1] = pid;
        } else {
          // Not seated: take the first free glass, never bumping someone else.
          const free = slots.indexOf(null);
          if (free >= 0) slots[free] = pid;
        }
        ui.haptic('tap');
        draw(wrap);
      }));
      wrap.querySelector('#hb-assign').innerHTML = String(ui.html`<div class="chips">
        ${room.players.filter((p) => p.connected).map((p) => ui.html`<button type="button" class="pill ${asPlayerId === p.id ? 'pill-amber' : ''}" data-assign="${p.id}">${p.name}</button>`)}
      </div>`);
      wrap.querySelectorAll('[data-assign]').forEach((b) => b.addEventListener('click', () => {
        asPlayerId = b.dataset.assign;
        ui.haptic('tap');
        draw(wrap);
      }));
    }

    const v = await ui.sheet({
      title: 'Host Box',
      className: 'sheet-box',
      body: ui.html`<div class="sheet-player"><span class="hb-dot ${room.box.connected ? 'on' : 'off'}"></span><p>${room.box.connected ? 'Connected' : 'Offline right now'}</p></div>
        <p class="field-label">Seats: which glass is whose</p>
        <div id="hb-seats"></div>
        <p class="field-label">The button acts as (for the buzzer and long-press)</p>
        <div id="hb-assign"></div>`,
      actions: [
        { label: 'Save', tone: 'primary', value: 'save' },
        { label: 'Unpair Host Box', tone: 'danger', value: 'unpair' },
        { label: 'Close', value: null },
      ],
      onOpen(wrap) { draw(wrap); },
    });
    if (v === 'save') {
      await hostOp('setBoxSlots', { slots });
      const r = await hostOp('assignBoxPlayer', { playerId: asPlayerId ?? null });
      if (!r.error) { ui.toast('Host Box updated', 'info'); ui.haptic('success'); }
    } else if (v === 'unpair' && (await ui.confirm('Unpair the Host Box from this room?', { ok: 'Unpair', danger: true }))) {
      const r = await hostOp('unpairBox');
      if (!r.error) ui.haptic('success');
    }
  }

  async function pickGame() {
    const list = (await gameIndex()).filter((g) => g.modes.includes('room'));
    const v = await ui.sheet({
      title: 'Pick a game',
      body: ui.html`<div class="pick-games">${list.map((g) => ui.html`<button class="game-row" data-value="${g.id}" style="${ui.themeVars(g)}">
        <span class="game-row-ico">${ui.raw(gameIcon(g, 28))}</span>
        <span class="game-row-text"><strong>${g.name}</strong><span>${g.minPlayers}-${g.maxPlayers} players</span></span>
        ${g.id === last.room.gameId ? ui.icon('check', 20) : ''}</button>`)}</div>`,
    });
    if (v && v !== last.room.gameId) hostOp('setGame', { gameId: v });
  }

  async function playerSheet(pid) {
    const room = last.room;
    const p = room.players.find((x) => x.id === pid);
    if (!p) return;
    const isHost = room.hostId === room.you;
    if (pid === room.you) {
      const taken = new Set(room.players.filter((x) => x.id !== pid).map((x) => x.avatar));
      const r = await ui.sheet({
        title: 'You',
        body: ui.html`<form id="me-form" class="me-form" novalidate>
          <label class="field-label" for="me-name">Name</label>
          <input id="me-name" class="input" maxlength="20" value="${p.name}" autocomplete="nickname">
          <p class="field-label">Face</p>
          <div class="faces">${AVATARS.map((f) => ui.html`<button type="button" class="face-pick ${f === p.avatar ? 'on' : ''}" data-face="${f}" aria-label="Face ${f}" aria-pressed="${f === p.avatar}" ${taken.has(f) ? 'disabled' : ''}>${f}</button>`)}</div>
          <p class="field-label">Colour</p>
          <div class="swatches">${COLORS.map((c) => ui.html`<button type="button" class="swatch ${c === p.color ? 'on' : ''}" style="--c:${c}" data-color="${c}" aria-label="Colour ${c}" aria-pressed="${c === p.color}"></button>`)}</div>
        </form>`,
        actions: [{ label: 'Save', tone: 'primary', value: 'save' }, { label: 'Cancel', value: null }],
        onOpen(wrap) {
          const pick = (sel, attr) => wrap.querySelectorAll(sel).forEach((b) => b.addEventListener('click', () => {
            wrap.querySelectorAll(sel).forEach((s) => { s.classList.toggle('on', s === b); s.setAttribute('aria-pressed', String(s === b)); });
            ui.haptic('tap');
            if (attr === 'face') sfx.pop();
          }));
          pick('.swatch', 'color');
          pick('.face-pick', 'face');
          wrap.querySelector('#me-form').addEventListener('submit', (e) => { e.preventDefault(); wrap.querySelector('[data-i="0"]').click(); });
        },
        collect: (wrap) => ({
          name: wrap.querySelector('#me-name').value.trim(),
          color: wrap.querySelector('.swatch.on')?.dataset.color,
          avatar: wrap.querySelector('.face-pick.on')?.dataset.face,
        }),
      });
      if (r && r.value === 'save' && r.data.name) {
        localStorage.setItem(NAME_KEY, r.data.name);
        if (r.data.avatar) localStorage.setItem(FACE_KEY, r.data.avatar);
        const res = await sock.request({ t: 'profile', name: r.data.name, color: r.data.color, avatar: r.data.avatar });
        if (res.error) ui.toast(res.error, 'error');
        else { ui.toast('Saved', 'info'); ui.haptic('success'); }
      }
      return;
    }
    if (!isHost) return;
    const v = await ui.sheet({
      title: p.name,
      body: ui.html`<div class="sheet-player">${ui.avatar(p, 64)}<p>${p.connected ? (p.ready ? 'Online and ready' : 'Online') : 'Offline right now'}</p></div>`,
      actions: [
        ...(p.connected ? [{ label: `Make ${p.name} host`, tone: 'primary', value: 'host' }] : []),
        { label: `Remove ${p.name}`, tone: 'danger', value: 'kick' },
        { label: 'Cancel', value: null },
      ],
    });
    if (v === 'host') {
      await hostOp('passHost', { to: pid });
    } else if (v === 'kick') {
      kick(pid);
    }
  }

  async function openMenu() {
    const room = last.room;
    const isHost = room.hostId === room.you;
    const v = await menu({
      gameId: room.gameId,
      name: game.meta.name,
      code: room.code,
      inRoom: true,
      isHost,
      inGame: room.phase === 'game',
      over: room.over,
      played: room.night.played.length,
      drinking: !!last.drink && last.drink.tier !== 'standard',
      players: room.players,
      you: room.you,
    });
    if (v === 'drinks') return openDrinks();
    if (v === 'react') return reactionSheet((emoji) => sock.request({ t: 'react', emoji }));
    if (v === 'standings' && (await ui.confirm('End this game now and show the standings? Its scores count as they are.', { ok: 'Show standings' }))) hostOp('standings');
    if (v === 'awards' && (await ui.confirm('Finish the night and go to the awards?', { ok: 'Awards' }))) hostOp('recap');
    if (v === 'players') return playersSheet();
    if (v === 'share') return shareSheet();
    if (v === 'lobby' && (await ui.confirm('End this game and go back to the lobby?', { ok: 'Back to lobby', danger: true }))) hostOp('end');
    if (v === 'restart' && (await ui.confirm('Deal a fresh game? Scores reset.', { ok: 'Restart' }))) hostOp('restart');
    if (v === 'leave' && (await ui.confirm('Leave this room?', { ok: 'Leave', danger: true }))) leave();
  }

  async function playersSheet() {
    const room = last.room;
    const v = await ui.sheet({
      title: 'Players',
      body: ui.html`<ul class="plist">${room.players.map((p) => ui.html`<li><button class="prow ${p.connected ? '' : 'offline'}" data-value="${p.id}">
        ${ui.avatar(p, 40)}<span class="prow-name">${p.name}${p.id === room.you ? ui.html` <em>you</em>` : ''}</span>
        ${p.host ? ui.html`<span class="crown">${ui.icon('crown', 18, 'Host')}</span>` : ''}${p.connected ? '' : ui.html`<span class="off">offline</span>`}</button></li>`)}</ul>`,
    });
    if (v) playerSheet(v);
  }

  async function leave(silent = false) {
    if (!silent) ui.haptic('danger');
    await sock.request({ t: 'leave' }).catch(() => {});
    saveCreds(code, null);
    sock.close();
    navigate('/');
  }

  body.innerHTML = loadingCard(opts.create ? 'Creating your room...' : `Connecting to room ${code}...`);
  connect();

  return () => {
    delete document.body.dataset.awake;
    ui.keepAwake(false);
    if (sock) sock.close();
  };
}
