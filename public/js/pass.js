// Pass-and-play runner: drives a game engine locally on one phone, offline.
// The engine's passTurn(state) says when a player needs a private look; the
// runner then shows a "hide and pass" screen before their view, and goes
// back to the shared screen (the engine's tv view) when nobody does.
// It also keeps the night: the drink ledger (tallies, who is out, the tier)
// and the Party Night (several games, standings between, awards at the end).
import * as rt from '/games/_kit/runtime.js';
import { newLedger, withLedger, publicDrink } from '/games/_kit/drinks.js';
import { newNight, archiveGame } from '/games/_kit/night.js';
import * as ui from './ui.js';
import * as sfx from './sfx.js';
import * as fx from './fx.js';
import * as install from './install.js';
import { maybeHowto } from './howto.js';
import { createSurface, makeApi } from './surface.js';
import { loadGame, gameIndex, gameIcon } from './games.js';
import * as drinkui from './drinkui.js';
import * as nightui from './nightui.js';
import { optionsForm, wireOptionsForm } from './options.js';
import { normaliseOptions } from '/games/_kit/runtime.js';
import { packFor, packContent, hasPacks, packSummary, pickPackSheet, setPackFor } from './packs.js';

const KEY = 'games.pass';

export function savedPassGame() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}

function save(s) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function clearPassGame() {
  localStorage.removeItem(KEY);
}

// pack: the host's choice from public/js/packs.js (curated or custom) or
// null. The resolved content is saved with the game, so it plays offline
// and survives a refresh.
export async function startPassGame({ gameId, variant, players, options, shotCap, pack = null }) {
  const g = await loadGame(gameId);
  const now = Date.now();
  const content = await packContent(g, pack);
  const r = rt.createGame(g.engine, { players, variant, mode: 'pass', options, content, now, shotCap });
  if (r.error) return r;
  save({
    gameId, variant, players, options: r.state.options, state: r.state, privateFor: null, startedAt: now,
    stage: 'game', night: newNight(now), ledger: r.state.$drink,
    packCode: pack ? pack.code : null, packTitle: pack ? pack.title : null, content: pack ? content : null,
  });
  return { ok: true };
}

// Renders into `root`; returns a cleanup function.
export async function runPassGame(root, { onExit, menu, rules }) {
  let saved = savedPassGame();
  if (!saved) { onExit(); return () => {}; }
  // Games saved before Party Night existed.
  saved.stage = saved.stage || 'game';
  saved.night = saved.night || newNight(saved.startedAt || Date.now());
  saved.ledger = saved.ledger || (saved.state && saved.state.$drink) || newLedger({ tier: saved.variant });
  root.innerHTML = '<div class="screen loading-screen"><div class="spinner"></div><p>Loading the game...</p><p class="slow-note">Still loading. A slow connection the first time; after that it works offline.</p></div>';
  let g;
  try {
    g = await loadGame(saved.gameId);
  } catch (err) {
    root.innerHTML = String(ui.html`<div class="screen"><div class="state-card">${ui.icon('wifiOff', 36)}<h2>Couldn't load this game</h2><p class="err-detail">${err.message}</p><button class="btn btn-primary" id="retry">Try again</button></div></div>`);
    root.querySelector('#retry').addEventListener('click', () => runPassGame(root, { onExit, menu, rules }));
    return () => {};
  }
  ui.syncClock(Date.now());
  document.body.dataset.awake = '1';
  ui.keepAwake(true);

  root.innerHTML = `<div class="screen play-screen pass-screen" data-game="${saved.gameId}">
    <header class="playbar">
      <button class="icon-btn" id="pp-menu" aria-label="Game menu" title="Game menu">${ui.icon('more')}</button>
      <div class="playbar-title" id="pp-title"></div>
      ${ui.soundButton()}
    </header>
    <div id="pp-now" class="now" role="status" aria-live="polite"></div>
    <main id="pp-main" class="surface"></main>
    <div id="pp-host" class="hostbar"></div>
  </div>`;
  const main = root.querySelector('#pp-main');
  const hostEl = root.querySelector('#pp-host');
  const titleEl = root.querySelector('#pp-title');
  const nowEl = root.querySelector('#pp-now');
  const screenEl = root.querySelector('.play-screen');
  let wasOver = !!(saved.state && saved.state.$over);
  let firstPaint = true;
  let deadlineTimer = null;
  let gate = null; // the hide-and-pass screen, if showing
  let firstDrink = true;
  let nightKey = '';

  const ctx = () => ({ players: saved.players, content: saved.content || g.content, rng: Math.random, now: Date.now() });
  const ledger = () => (saved.stage === 'game' && saved.state && saved.state.$drink) || saved.ledger;
  const drinkView = () => publicDrink(ledger(), Date.now());

  function persist() {
    if (saved.stage === 'game' && saved.state && saved.state.$drink) saved.ledger = saved.state.$drink;
    save(saved);
  }

  function header() {
    const inGame = saved.stage === 'game';
    ui.applyTheme(screenEl, inGame ? g.meta : null);
    titleEl.innerHTML = `${inGame ? gameIcon(g.meta, 26) : ''}<span>${ui.esc(inGame ? g.meta.name : 'Party Night')}</span>${drinkui.chip(drinkView(), null) || ui.tierPill(saved.variant)}`;
  }
  titleEl.addEventListener('click', (e) => { if (e.target.closest('#drink-chip')) openDrinks(); });

  function act(type, payload, from) {
    const r = rt.applyAction(g.engine, saved.state, { type, payload, from, host: from === null }, ctx());
    if (r.error) return { error: r.error, detail: r.detail };
    const before = rt.passTurnOf(g.engine, saved.state, ctx());
    saved.state = r.state;
    const after = rt.passTurnOf(g.engine, saved.state, ctx());
    if (after !== before || after === null) saved.privateFor = null;
    persist();
    render();
    return { ok: true };
  }

  let privateFor = null;
  // A new phase on the table screen: the stage wipe and a whoosh.
  const surface = createSurface(main, {
    act: async (type, payload) => act(type, payload, privateFor),
    onPhase: () => { if (!privateFor) { sfx.whoosh(); fx.wipe(); } },
  });

  function schedule() {
    clearTimeout(deadlineTimer);
    if (saved.stage !== 'game') return;
    const d = rt.deadlineOf(g.engine, saved.state);
    if (!d) return;
    deadlineTimer = setTimeout(() => {
      saved.state = rt.runDeadlines(g.engine, saved.state, ctx());
      saved.privateFor = null;
      persist();
      render();
    }, Math.max(0, d.at - Date.now()) + 30);
  }

  // buttons: [{ label, tone, run() }]
  function bar(buttons) {
    hostEl.innerHTML = buttons.map((b, i) => `<button class="btn btn-${ui.esc(b.tone || 'secondary')}" data-i="${i}">${ui.esc(b.label)}</button>`).join('');
    hostEl.classList.toggle('empty', !buttons.length);
    hostEl.querySelectorAll('[data-i]').forEach((el) => el.addEventListener('click', async () => {
      const b = buttons[Number(el.dataset.i)];
      if (b.confirm && !(await ui.confirm(b.confirm, { ok: b.label, danger: b.tone === 'danger' }))) return;
      ui.haptic('tap');
      const r = await b.run(el);
      if (r && r.error) ui.toast(r.error, 'error');
    }));
  }

  function renderHostBar(actions) {
    const over = !!saved.state.$over;
    const list = actions.map((a) => ({
      label: a.label, confirm: a.confirm,
      tone: over && a.tone === 'primary' ? 'secondary' : a.tone,
      run: () => act(a.type, a.payload ?? null, null),
    }));
    if (over) list.push({ label: 'Standings', tone: 'primary', run: () => toStandings() });
    bar(list);
  }

  function showGate(pid) {
    const p = saved.players.find((x) => x.id === pid);
    surface.reset();
    hostEl.innerHTML = '';
    hostEl.classList.add('empty');
    main.innerHTML = String(ui.html`<div class="gate" style="--c:${p.color}">
      <div class="gate-glow" aria-hidden="true"></div>
      ${ui.avatar(p, 136, 'gate-av')}
      <h2 class="gate-title">Pass to ${p.name}</h2>
      <button class="btn btn-primary btn-xl" id="gate-go">${ui.icon('eye', 20)} I'm ${p.name}, show me</button>
    </div>`);
    ui.setNow(nowEl, { text: `Hand the phone to ${p.name}`, tone: 'act' }, { first: true });
    delete document.body.dataset.stage;
    main.querySelector('#gate-go').addEventListener('click', () => {
      ui.haptic('tap');
      sfx.blip();
      saved.privateFor = pid;
      save(saved);
      render();
    });
    gate = pid;
  }

  function render() {
    header();
    drinkui.handleDrink(drinkView(), { players: saved.players, me: null, surface: 'shared', first: firstDrink });
    firstDrink = false;
    if (saved.stage !== 'game') return renderNight();
    nightKey = '';
    schedule();
    const turn = rt.passTurnOf(g.engine, saved.state, ctx());
    if (turn && saved.privateFor !== turn) {
      privateFor = null;
      if (gate !== turn) showGate(turn);
      return;
    }
    gate = null;
    const base = { players: saved.players, hostId: null, mode: 'pass', variant: saved.state.variant };
    celebrate();
    if (turn) {
      privateFor = turn;
      delete document.body.dataset.stage;
      const me = saved.players.find((x) => x.id === turn);
      const view = rt.playerViewOf(g.engine, saved.state, turn, ctx());
      const api = makeApi({ ...base, surface: 'player', me, isHost: false });
      surface.render(g.client, 'player', view, api);
      showNow(view, api);
      hostEl.innerHTML = `<button class="btn btn-secondary" id="pp-hide">${ui.icon('eyeOff', 18)} Hide</button>`;
      hostEl.classList.remove('empty');
      hostEl.querySelector('#pp-hide').addEventListener('click', () => {
        saved.privateFor = null;
        save(saved);
        gate = null;
        render();
      });
      return;
    }
    privateFor = null;
    document.body.dataset.stage = '1';
    const view = rt.tvViewOf(g.engine, saved.state, ctx());
    const api = makeApi({ ...base, surface: 'shared', me: null, isHost: true });
    surface.render(g.client, 'tv', view, api);
    showNow(view, api);
    renderHostBar(rt.hostActionsOf(g.engine, saved.state, ctx()));
  }

  function showNow(view, api) {
    let line = null;
    try { line = typeof g.client.now === 'function' ? g.client.now(view, api) : null; } catch (err) { console.error(err); }
    if (!line && saved.state.$over) line = { text: 'Game over. Tap Standings when you are ready', tone: 'act' };
    ui.setNow(nowEl, line, { first: firstPaint });
    firstPaint = false;
  }

  // The game just ended: confetti, a fanfare, and (once) the install offer.
  function celebrate() {
    const over = !!saved.state.$over;
    if (over && !wasOver) {
      fx.confetti({ colors: [g.meta.accent || '#9d7bff', '#ffb347', '#f7f3ff', ...saved.players.map((p) => p.color)] });
      sfx.fanfare();
      install.afterGame();
    }
    wasOver = over;
  }

  /* Party Night */

  async function metaMap() {
    try { return new Map((await gameIndex()).map((m) => [m.id, m])); } catch { return new Map(); }
  }

  function toStandings() {
    saved.ledger = saved.state.$drink || saved.ledger;
    saved.night = archiveGame(saved.night, { gameId: saved.gameId, name: g.meta.name, state: saved.state, now: Date.now() });
    saved.stage = 'between';
    saved.privateFor = null;
    gate = null;
    surface.reset();
    persist();
    render();
    return { ok: true };
  }

  async function startGame(id) {
    let ng;
    try { ng = await loadGame(id); } catch (err) { return { error: `Couldn't load that game: ${err.message}` }; }
    const opts = (() => { try { return JSON.parse(localStorage.getItem(`games.opts.${id}`) || '{}'); } catch { return {}; } })();
    // Each game of the night plays its own pack choice (picked on its start
    // screen or in the next-game sheet), else its built-in deck.
    const pack = packFor(id);
    let content = ng.content;
    try { content = await packContent(ng, pack); } catch { /* catalogue unreachable: built-in deck */ }
    const playing = content !== ng.content;
    const r = rt.createGame(ng.engine, { players: saved.players, variant: saved.variant, mode: 'pass', options: opts, content, now: Date.now(), drink: saved.ledger });
    if (r.error) return r;
    g = ng;
    root.querySelector('.play-screen').dataset.game = id;
    Object.assign(saved, {
      gameId: id, options: r.state.options, state: r.state, privateFor: null, stage: 'game',
      packCode: playing ? pack.code : null, packTitle: playing ? pack.title : null, content: playing ? content : null,
    });
    saved.night = { ...saved.night, queue: saved.night.queue.filter((x, i) => !(i === 0 && x === id)) };
    gate = null;
    surface.reset();
    persist();
    render();
    ui.toast(`${g.meta.name}: game ${saved.night.played.length + 1} of the night`, 'info');
    wasOver = false;
    maybeHowto(g.meta, saved.variant, { onRules: () => rules && rules(g.meta.id, g.meta.name) });
    return { ok: true };
  }

  async function pickNext() {
    const list = (await gameIndex()).filter((m) => m.modes.includes('pass'));
    const id = await nightui.pickGameSheet('Next game', list, { players: saved.players.length });
    if (!id) return null;
    const m = list.find((x) => x.id === id);
    if (m.options.length || hasPacks(m)) {
      // The game's settings and pack first, remembered per game like the set-up screen.
      const key = `games.opts.${id}`;
      let opts = normaliseOptions(m.options, (() => { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; } })());
      const packRow = () => {
        const p = packSummary(m, packFor(id));
        return ui.html`<button type="button" class="settings-row pack-btn" id="next-pack" aria-haspopup="dialog">${p.emoji ? ui.html`<span class="pk-art" aria-hidden="true">${p.emoji}</span>` : ui.raw(ui.icon('list', 20))}<span><b>${p.title}</b><small>${p.sub}</small></span>${ui.raw(ui.icon('back', 18))}</button>`;
      };
      const v = await ui.sheet({
        title: `${m.name} settings`,
        className: 'sheet-next-opts',
        body: ui.html`${m.options.length ? ui.raw(optionsForm(m.options, opts, { id: 'next-opts' })) : ''}${hasPacks(m) ? ui.html`<h2 class="sec">Pack</h2><div id="next-pack-slot">${packRow()}</div>` : ''}`,
        actions: [{ label: `Start ${m.name}`, tone: 'primary', value: 'go' }, { label: 'Cancel', value: null }],
        onOpen(wrap) {
          const form = wrap.querySelector('#next-opts');
          if (form) wireOptionsForm(form, m.options, opts, (o) => { opts = o; localStorage.setItem(key, JSON.stringify(o)); });
          const slot = wrap.querySelector('#next-pack-slot');
          const wirePack = () => slot.querySelector('#next-pack').addEventListener('click', async () => {
            const res = await pickPackSheet(m);
            if (res === undefined) return;
            setPackFor(id, res);
            slot.innerHTML = String(packRow());
            wirePack();
            ui.toast(res ? `Playing with ${res.title}` : 'Playing with the built-in deck', 'info');
          });
          if (slot) wirePack();
        },
      });
      if (v !== 'go') return null;
    }
    return startGame(id);
  }

  async function renderNight() {
    clearTimeout(deadlineTimer);
    document.body.dataset.stage = '1';
    ui.setNow(nowEl, saved.stage === 'recap' ? { text: 'The awards. Read them out', tone: 'watch' } : { text: 'Pick the next game, or the awards', tone: 'act' }, { first: true });
    const metas = await metaMap();
    const d = { night: saved.night, players: saved.players, drink: drinkView(), metaOf: (id) => metas.get(id) || null };
    const key = JSON.stringify([saved.stage, saved.night, d.drink && d.drink.tally]);
    if (key !== nightKey) {
      const fresh = !nightKey.startsWith(`["${saved.stage}"`);
      nightKey = key;
      surface.reset();
      main.innerHTML = String(saved.stage === 'recap'
        ? ui.html`${nightui.recapHTML(d, { ceremony: fresh, still: !fresh })}<div class="nt-actions"><button class="btn btn-amber btn-xl" id="nt-share">${ui.icon('share', 20)} Share the recap image</button></div>`
        : nightui.standingsHTML(d, { still: !fresh }));
      main.querySelector('#nt-share')?.addEventListener('click', (e) => nightui.shareRecap(d, e.currentTarget));
      if (fresh && saved.stage === 'recap') nightui.playCeremony(nightui.awardsOf(d).length);
    }
    if (saved.stage === 'recap') {
      bar([
        { label: 'Done', tone: 'secondary', confirm: 'Finish the night? This clears the scores.', run: () => { clearPassGame(); onExit(); } },
        { label: 'New night', tone: 'primary', run: () => {
          saved.night = newNight(Date.now());
          saved.ledger = withLedger(saved.ledger, { reset: true, now: Date.now() });
          saved.stage = 'between';
          persist();
          return pickNext();
        } },
      ]);
      return;
    }
    const next = saved.night.queue[0] && metas.get(saved.night.queue[0]);
    bar([
      { label: next ? 'Other game' : 'Next game', tone: next ? 'secondary' : 'primary', run: pickNext },
      next ? { label: `Play ${next.name}`, tone: 'primary', run: () => startGame(next.id) } : null,
      { label: 'Awards', tone: 'secondary', run: () => { saved.stage = 'recap'; persist(); render(); } },
    ].filter(Boolean));
  }

  /* drinks */

  function patchDrinks(patch) {
    if (saved.stage === 'game' && saved.state) saved.state = rt.withDrinkPatch(saved.state, patch);
    saved.ledger = withLedger(saved.ledger, patch);
    if (patch.tier) saved.variant = patch.tier;
    persist();
    render();
  }

  function openDrinks() {
    drinkui.drinkSheet({
      drink: drinkView(), players: saved.players, me: null, isHost: true, mode: 'pass',
      onOut: (id, on) => patchDrinks({ out: [id, on] }),
      onTier: (t) => patchDrinks({ tier: t }),
      onCap: (n) => patchDrinks({ shotCap: n }),
    });
  }

  root.querySelector('#pp-menu').addEventListener('click', async () => {
    const inGame = saved.stage === 'game';
    const choice = await menu({
      gameId: saved.gameId, name: g.meta.name, inPass: true, inGame, over: inGame && !!saved.state.$over,
      drinking: ledger().tier !== 'standard',
    });
    if (choice === 'drinks') return openDrinks();
    if (choice === 'standings' && inGame) {
      if (saved.state.$over || (await ui.confirm('End this game now and show the standings? Its scores count as they are.', { ok: 'Show standings' }))) toStandings();
      return;
    }
    if (choice === 'restart') {
      if (!inGame) return pickNext();
      const r = rt.createGame(g.engine, { players: saved.players, variant: saved.variant, mode: 'pass', options: saved.options, content: saved.content || g.content, now: Date.now(), drink: ledger() });
      if (r.error) return ui.toast(r.error, 'error');
      saved.state = r.state;
      saved.privateFor = null;
      persist();
      gate = null;
      surface.reset();
      render();
      ui.toast('New game dealt', 'info');
    } else if (choice === 'end') {
      clearPassGame();
      onExit();
    }
  });

  render();
  if (saved.stage === 'game') maybeHowto(g.meta, saved.variant, { onRules: () => rules && rules(g.meta.id, g.meta.name) });
  return () => {
    clearTimeout(deadlineTimer);
    delete document.body.dataset.stage;
    delete document.body.dataset.awake;
    ui.keepAwake(false);
  };
}
