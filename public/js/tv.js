// /tv/CODE: the big screen. No identity, no secrets: it only ever receives
// the engine's tvView. The lobby is a show of its own (the game, how to
// play, the code and QR huge, faces popping in as people join); in game a
// slim bar keeps the game and the join code pinned while the game's tv
// renderer fills the stage. Works with nothing but a TV remote: OK turns
// the sound on, F or the fullscreen key goes full screen, the cursor hides.
import * as ui from './ui.js';
import { RoomSocket } from './net.js';
import { createNetBar } from './netbar.js';
import { createSurface, makeApi } from './surface.js';
import { loadGame, gameIcon, gameIndex } from './games.js';
import { stepsHTML } from './howto.js';
import * as drinkui from './drinkui.js';
import * as nightui from './nightui.js';
import * as sfx from './sfx.js';
import * as fx from './fx.js';
import { floatReaction } from './reactui.js';

export function runTv(root, code) {
  let last = null;
  let game = null;
  let ended = false;
  let surface = null;
  let lobbyKey = '';
  let nightKey = '';
  let firstMsg = true;
  let stopCeremony = null;
  let seenPlayers = null;
  let wasOver = null;
  let metas = new Map();
  gameIndex().then((list) => { metas = new Map(list.map((g) => [g.id, g])); if (last) { lobbyKey = ''; render(); } }).catch(() => {});
  document.body.classList.add('tv-mode');
  document.body.dataset.awake = '1';
  document.body.dataset.stage = '1';
  ui.keepAwake(true);

  root.innerHTML = `<div class="tv">
    <div id="tv-net" class="netbar" hidden></div>
    <main id="tv-main" class="tv-main"><div class="state-card"><span class="spinner"></span><p>Connecting to room ${ui.esc(code)}...</p><p class="slow-note">Still connecting. The server may be slow; this keeps retrying.</p></div></main>
    <footer id="tv-foot" class="tv-foot" hidden></footer>
    <div class="tv-tools">
      <button class="icon-btn" id="tv-sound" aria-label="Sound" title="Sound"></button>
      <button class="icon-btn" id="tv-fs" aria-label="Full screen" title="Full screen">${ui.icon('expand')}</button>
    </div>
    <p class="tv-remote" id="tv-remote" hidden></p>
  </div>`;
  const tvEl = root.querySelector('.tv');
  const soundBtn = root.querySelector('#tv-sound');
  const remote = root.querySelector('#tv-remote');
  const drawSound = () => {
    const on = sfx.soundOn() && sfx.unlocked();
    const needsTap = sfx.soundOn() && !sfx.unlocked();
    soundBtn.innerHTML = String(ui.html`${ui.icon(on ? 'sound' : 'mute')}${needsTap ? ui.html`<span>Turn sound on</span>` : ''}`);
    soundBtn.classList.toggle('wide', needsTap);
    remote.hidden = !needsTap;
    remote.innerHTML = String(ui.html`Press <kbd>OK</kbd> on the remote for sound · <kbd>F</kbd> full screen`);
  };
  soundBtn.addEventListener('click', () => {
    if (sfx.soundOn() && !sfx.unlocked()) { sfx.unlock(); setTimeout(() => sfx.chime(), 80); } else sfx.setSound(!sfx.soundOn());
    setTimeout(drawSound, 120);
  });
  drawSound();
  // The remote hint has said its piece after half a minute.
  const hintTimer = setTimeout(() => { remote.hidden = true; remote.remove(); }, 30_000);
  // A remote's OK lands on the focused sound button; give it focus.
  setTimeout(() => soundBtn.focus({ preventScroll: true }), 300);
  const fullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };
  root.querySelector('#tv-fs').addEventListener('click', fullscreen);
  const onKey = (e) => {
    // Any key is a user gesture: wake the sound up on the first one.
    if (sfx.soundOn() && !sfx.unlocked()) { sfx.unlock(); setTimeout(drawSound, 120); }
    if (e.key === 'f' || e.key === 'F') fullscreen();
  };
  document.addEventListener('keydown', onKey);
  const onPointer = () => setTimeout(drawSound, 120);
  document.addEventListener('pointerdown', onPointer, { once: true });
  // Hide the cursor once nobody's touching the mouse.
  let idleTimer = null;
  const wake = () => {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    clearTimeout(hintTimer);
    idleTimer = setTimeout(() => document.body.classList.add('idle'), 3000);
  };
  document.addEventListener('mousemove', wake);
  wake();

  const main = root.querySelector('#tv-main');
  const foot = root.querySelector('#tv-foot');
  const netbar = createNetBar(root.querySelector('#tv-net'));
  const host = location.host;

  function ended_(reason) {
    ended = true;
    sock.close();
    foot.hidden = true;
    main.innerHTML = String(ui.html`<div class="state-card tv-ended"><div class="ended-mark">${ui.icon('leave', 40)}</div><h2>Room ${code} is over</h2><p>${reason}</p><a class="btn btn-primary" href="/tv">Enter another code</a></div>`);
  }

  // The TV cannot scroll. Screens are sized by width, so a 16:10 TV (or a
  // results screen with drinks and scores stacked up) can run out of height:
  // then the stage zooms down just enough to fit, never below 60%.
  function fit() {
    const stage = main.querySelector('#tv-surface, .tv-night, .tv-lobby');
    if (!stage) return;
    stage.style.zoom = '';
    let z = 1;
    for (let i = 0; i < 4; i++) {
      const over = document.documentElement.scrollHeight - innerHeight;
      if (over <= 1 || z <= 0.6) break;
      const h = stage.getBoundingClientRect().height;
      if (!h) break;
      z = Math.max(0.6, z * (1 - over / h) - 0.005);
      stage.style.zoom = z.toFixed(3);
    }
  }
  // Again a beat later: late images and fonts can still change the height.
  const refit = () => { requestAnimationFrame(fit); setTimeout(fit, 700); };
  addEventListener('resize', refit);

  const sock = new RoomSocket({
    onStatus(s) {
      if (s === 'open' || ended) return netbar.hide();
      netbar.show('Reconnecting...');
    },
    async onOpen() {
      const r = await sock.request({ t: 'tv', code }, { subscribe: true });
      if (r.error) return ended_(r.error);
      sock.markReady();
    },
    onMessage(msg) {
      if (msg.t === 'tv') {
        ui.syncClock(msg.now);
        last = msg;
        drinkui.handleDrink(msg.drink, { players: msg.room.players, me: null, surface: 'tv', first: firstMsg });
        render().then(refit);
        firstMsg = false;
      } else if (msg.t === 'reaction') floatReaction(msg.emoji);
      else if (msg.t === 'closed') ended_(msg.reason || 'This room has closed.');
    },
  });
  sock.connect();

  // The slim bar over the stage: the game on the left, the way in on the right.
  function stageBar(room, m) {
    return ui.html`<div class="tv-bar">
      ${m ? ui.html`<div class="tv-bar-game"><span class="game-row-ico">${ui.raw(gameIcon(m, 34))}</span><span>${m.name}</span>${room.variant === 'standard' ? '' : ui.tierPill(room.variant, 14)}</div>` : ui.html`<div class="tv-bar-game">${ui.icon('trophy', 28)}<span>Party Night</span></div>`}
      <div class="tv-bar-code"><span>Join at ${host}</span><strong>${room.code}</strong><img src="/qr/${room.code}.svg" alt=""></div>
    </div>`;
  }

  function footPlayers(room) {
    const players = room.players.map((p) => ui.html`<li class="${p.connected ? '' : 'offline'}">${ui.avatar(p, 34)}${p.host ? ui.html`<span class="crown">${ui.icon('crown', 14)}</span>` : ''}<span>${p.name}</span></li>`);
    const audience = room.audienceIds && room.audienceIds.length
      ? ui.html`<span class="foot-audience">${ui.icon('users', 16)} ${room.audienceIds.length} watching</span>` : '';
    return ui.html`<ul class="foot-players">${players}</ul>${audience}`;
  }

  // New faces since the last message: a pop each.
  function noticeJoins(room) {
    const ids = room.players.map((p) => p.id);
    if (seenPlayers && ids.some((id) => !seenPlayers.has(id))) sfx.pop();
    seenPlayers = new Set(ids);
  }

  async function render() {
    const room = last.room;
    if (!game || game.id !== room.gameId) {
      try { game = await loadGame(room.gameId); } catch (err) {
        main.innerHTML = String(ui.html`<div class="state-card"><h2>Couldn't load the game</h2><p class="err-detail">${err.message}</p><button class="btn btn-primary" id="retry">Try again</button></div>`);
        main.querySelector('#retry').addEventListener('click', () => render());
        return;
      }
    }
    noticeJoins(room);
    // The remote hint belongs to the lobby; in play it would sit on the code bar.
    remote.classList.toggle('off', room.phase !== 'lobby');
    const night = room.phase === 'between' || room.phase === 'recap';
    ui.applyTheme(tvEl, night ? null : game.meta);
    if (room.phase !== 'recap' && stopCeremony) { stopCeremony(); stopCeremony = null; }
    if (night) {
      surface = null;
      lobbyKey = '';
      wasOver = null;
      foot.hidden = true;
      const d = { night: room.night, players: room.players, drink: last.drink, metaOf: (id) => metas.get(id) || null };
      const key = JSON.stringify([room.phase, room.night, room.players.map((p) => [p.id, p.name, p.color, p.avatar]), last.drink && last.drink.tally, metas.size]);
      if (key === nightKey) return;
      const fresh = !nightKey.startsWith(`["${room.phase}"`);
      nightKey = key;
      if (room.phase === 'recap') {
        // A refresh of a screen already up never replays its entrance.
        main.innerHTML = String(ui.html`${stageBar(room, null)}<div class="tv-night">${nightui.recapHTML(d, { big: true, ceremony: fresh, still: !fresh })}</div>`);
        if (fresh) {
          if (stopCeremony) stopCeremony();
          stopCeremony = nightui.playCeremony(nightui.awardsOf(d).length);
        }
      } else {
        main.innerHTML = String(ui.html`${stageBar(room, null)}<div class="tv-night">${nightui.standingsHTML(d, { big: true, still: !fresh })}</div>`);
        if (fresh && !firstMsg) { sfx.chime(); fx.wipe('#ffb347'); }
      }
      return;
    }
    nightKey = '';
    if (room.phase === 'lobby') {
      surface = null;
      wasOver = null;
      foot.hidden = true;
      const key = JSON.stringify([room.gameId, room.variant, room.players, room.night.queue, room.night.played.length, metas.size]);
      if (key === lobbyKey) return;
      const first = !lobbyKey;
      lobbyKey = key;
      const m = metas.get(room.gameId) || game.meta;
      const need = Math.max(0, m.minPlayers - room.players.length);
      const ready = room.players.filter((p) => p.ready || p.host).length;
      main.innerHTML = String(ui.html`<div class="tv-lobby">
        <div class="tv-lobby-left">
          <div class="tv-game"><span class="game-row-ico">${ui.raw(gameIcon(m, 80))}</span><div><h1>${m.name}</h1>${room.variant === 'standard' ? ui.html`<span class="pill">${ui.icon('star', 16)} Standard</span>` : ui.tierPill(room.variant, 16)}${room.night.queue.length ? ui.html` <span class="pill">${ui.icon('list', 16)} Party Night: ${room.night.queue.length + 1} games</span>` : ''}</div></div>
          ${room.night.queue.length ? ui.html`<ol class="tv-tonight"><li class="on">${m.name}</li>${room.night.queue.map((id) => ui.html`<li>${(metas.get(id) || { name: id }).name}</li>`)}</ol>` : ''}
          ${stepsHTML(m, 'tv-howto')}
        </div>
        <div class="tv-join">
          <p class="tv-join-at">On your phone, go to <b>${host}</b></p>
          <div class="code-tiles xl ${first ? 'deal' : ''}">${[...room.code].map((ch, i) => ui.html`<span style="--i:${i}">${ch}</span>`)}</div>
          <div class="tv-qr"><img src="/qr/${room.code}.svg" alt="QR code to join room ${room.code}"><span>Or scan<br>with your camera</span></div>
        </div>
        <p class="tv-count"><b>${ui.plural(room.players.length, 'player')}</b> in${need ? ` · need ${need} more` : ` · ${ready} ready`}</p>
        <ul class="tv-players">${room.players.map((p, i) => ui.html`<li class="${p.connected ? '' : 'offline'}" style="--i:${i}">${ui.avatar(p, 90)}${p.host ? ui.html`<span class="crown">${ui.icon('crown', 22, 'Host')}</span>` : ''}${p.ready && !p.host ? ui.html`<span class="tick">${ui.icon('check', 18)}</span>` : ''}<span class="nm">${p.name}</span></li>`)}${Array.from({ length: need }, () => ui.html`<li class="empty"><span class="av" style="--s:90px"></span><span class="nm">Join in</span></li>`)}</ul>
      </div>`);
      return;
    }
    lobbyKey = '';
    foot.hidden = false;
    foot.innerHTML = String(footPlayers(room));
    if (!surface || !main.querySelector('#tv-surface')) {
      main.innerHTML = '<div id="tv-bar"></div><div class="tv-surface surface" id="tv-surface"></div>';
      surface = createSurface(main.querySelector('#tv-surface'), {
        act: async () => ({ error: 'The TV is view only.' }),
        onPhase: () => { sfx.whoosh(); fx.wipe(); },
      });
    }
    main.querySelector('#tv-bar').innerHTML = String(stageBar(room, game.meta));
    if (last.viewError) {
      main.querySelector('#tv-surface').innerHTML = String(ui.html`<div class="state-card"><h2>The game hit a snag</h2><p class="err-detail">${last.viewError}</p></div>`);
      return;
    }
    const api = makeApi({ surface: 'tv', me: null, players: room.players, hostId: room.hostId, isHost: false, mode: 'room', variant: room.variant });
    surface.render(game.client, 'tv', last.view, api);
    if (wasOver === false && room.over) {
      fx.confetti({ colors: [game.meta.accent || '#9d7bff', '#ffb347', '#f7f3ff', ...room.players.map((p) => p.color)], count: 220 });
      sfx.fanfare();
    }
    wasOver = !!room.over;
  }

  return () => {
    if (stopCeremony) stopCeremony();
    sock.close();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('mousemove', wake);
    document.removeEventListener('pointerdown', onPointer);
    removeEventListener('resize', refit);
    clearTimeout(idleTimer);
    document.body.classList.remove('tv-mode', 'idle');
    delete document.body.dataset.awake;
    delete document.body.dataset.stage;
    ui.keepAwake(false);
  };
}
