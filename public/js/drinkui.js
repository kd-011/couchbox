// The drink engine on screen: the Deadly takeover (every screen, loudest on
// the TV), water-break nudges, the drinks chip in the play bar and the
// drinks sheet (tallies, "I'm out", host tier drop and shot cap).
// Data comes from games/_kit/drinks.js publicDrink().
import * as ui from './ui.js';
import * as sfx from './sfx.js';
import { MOMENT_SHOW_MS, MAX_SHOT_CAP } from '/games/_kit/drinks.js';

const SEEN_KEY = 'games.moments';
const seen = new Set((() => { try { return JSON.parse(sessionStorage.getItem(SEEN_KEY) || '[]'); } catch { return []; } })());
function markSeen(id) {
  seen.add(id);
  try { sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-60))); } catch { /* private mode */ }
}
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Text tokens: @{0} is the first target's name.
function fill(text, targets, name) {
  return String(text || '').replace(/@\{(\d+)\}/g, (_, i) => name(targets[Number(i)]));
}

// ctx: { players, me (id|null), surface: 'player'|'tv'|'shared', first }
// Call with every fresh drink payload; shows anything new exactly once.
export function handleDrink(drink, ctx) {
  if (!drink) return;
  const fresh = (x) => x && !seen.has(x.id) && ui.serverNow() - x.at < MOMENT_SHOW_MS;
  for (const n of drink.nudges || []) {
    if (!fresh(n)) { if (n) markSeen(n.id); continue; }
    markSeen(n.id);
    if (ctx.first) continue; // old news on a fresh page load
    const mine = !n.playerIds.length || n.playerIds.includes(ctx.me) || ctx.surface !== 'player';
    if (!mine) continue;
    const name = nameFn(ctx.players);
    ui.toast(fill(n.text, n.playerIds, name), 'water');
    if (ctx.surface !== 'player') sfx.chime();
  }
  const m = drink.moment;
  if (fresh(m)) {
    markSeen(m.id);
    showMoment(m, ctx);
  } else if (m) markSeen(m.id);
}

function nameFn(players) {
  const by = new Map((players || []).map((p) => [p.id, p]));
  return (id) => (by.get(id) || {}).name || 'Someone';
}

let current = null;

export function showMoment(m, { players, me, surface }) {
  if (current) current.close(true);
  const byId = new Map((players || []).map((p) => [p.id, p]));
  const name = nameFn(players);
  const water = m.kind === 'water';
  const hitMe = me && m.targets.includes(me);
  const loud = surface !== 'player' || hitMe;
  const roulette = m.kind === 'roulette' && m.candidates.length > 1 && !reduced();
  const big = surface === 'tv';
  const wheel = roulette ? m.candidates.slice(0, 16) : [];
  const lines = (m.lines && m.lines.length ? m.lines : []).map((l) => ui.html`<li class="mo-line" style="--c:${(byId.get(l.playerId) || {}).color || '#8b7fb0'}">
      ${ui.avatar(byId.get(l.playerId), big ? 120 : 64)}
      <span><b>${l.playerId === me ? 'You' : name(l.playerId)}</b> ${l.playerId === me && l.text === 'takes a shot' ? 'take a shot' : l.text}</span></li>`);
  const el = document.createElement('div');
  el.className = `moment ${water ? 'moment-water' : 'moment-deadly'} ${big ? 'moment-tv' : ''} ${hitMe ? 'moment-me' : ''}`;
  el.setAttribute('role', 'alertdialog');
  el.setAttribute('aria-live', 'assertive');
  el.setAttribute('aria-label', `${m.title}. ${m.lines.map((l) => `${name(l.playerId)} ${l.text}`).join('. ')} ${fill(m.text, m.targets, name)}`);
  el.innerHTML = String(ui.html`<div class="mo-glow" aria-hidden="true"></div>
    <div class="mo-body">
      <p class="mo-kicker">${water ? ui.icon('drop', big ? 40 : 22) : ui.icon('skull', big ? 40 : 22)}<span>${water ? 'Breather' : 'Deadly'}</span></p>
      <h2 class="mo-title">${m.title}</h2>
      ${m.sub ? ui.html`<p class="mo-sub">${m.sub}</p>` : ''}
      ${roulette ? ui.html`<div class="mo-wheel" style="--n:${wheel.length}">${wheel.map((id, i) => ui.html`<span class="mo-slot" style="--i:${i}" data-id="${id}">${ui.avatar(byId.get(id), big ? 96 : 52)}</span>`)}<span class="mo-hub">${ui.icon('shot', big ? 64 : 34)}</span></div>` : ''}
      <div class="mo-reveal">
        ${m.text ? ui.html`<p class="mo-text">${fill(m.text, m.targets, (id) => (id === me ? 'You' : name(id)))}</p>` : ''}
        ${lines.length ? ui.html`<ul class="mo-lines">${lines}</ul>` : ''}
      </div>
      ${surface === 'tv' ? '' : ui.html`<button class="btn btn-secondary mo-done" type="button">${hitMe && !water ? 'Done, bottoms up' : 'Got it'}</button>`}
    </div>`);
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));

  const timers = [];
  const later = (ms, fn) => timers.push(setTimeout(fn, ms));
  if (loud) (water ? sfx.chime : sfx.stinger)();
  if (!water) ui.haptic(hitMe ? 'danger' : 'tap');

  const revealAt = roulette ? spin(el, wheel, m.targets[0], later, loud) : (water ? 300 : 1300);
  later(revealAt, () => {
    el.classList.add('revealed');
    if (loud && !water) sfx.land();
    if (hitMe && navigator.vibrate && !reduced()) try { navigator.vibrate([90, 60, 90, 60, 240]); } catch { /* fine */ }
  });
  const close = (instant = false) => {
    timers.forEach(clearTimeout);
    if (current && current.el === el) current = null;
    el.classList.remove('in');
    el.classList.add('out');
    setTimeout(() => el.remove(), instant ? 0 : 260);
  };
  el.querySelector('.mo-done')?.addEventListener('click', () => { ui.haptic('tap'); close(); });
  later(revealAt + (surface === 'tv' ? 7000 : 11000), () => close());
  current = { el, close };
}

// The roulette: a light runs round the ring, slowing down, and stops on the
// target. Returns when (ms) it lands.
function spin(el, wheel, target, later, loud) {
  const slots = [...el.querySelectorAll('.mo-slot')];
  const n = slots.length;
  const end = Math.max(0, wheel.indexOf(target));
  const steps = n * 3 + ((end - 0 + n) % n);
  let t = 900;
  for (let s = 0; s <= steps; s++) {
    const k = s / steps;
    t += 45 + 260 * k * k * k;
    const idx = s % n;
    later(t, () => {
      slots.forEach((x, i) => x.classList.toggle('lit', i === idx));
      if (loud) sfx.tick();
    });
  }
  later(t + 10, () => slots[end] && slots[end].classList.add('won'));
  return t + 350;
}

/* ---------- play bar chip and drinks sheet ---------- */

export function chip(drink, me) {
  if (!drink || drink.tier === 'standard') return '';
  // A phone shows your own tally; the shared one-phone screen the table's.
  const all = Object.values(drink.tally);
  const t = me ? drink.tally[me] || null : all.length ? all.reduce((a, x) => ({ sips: a.sips + x.sips, shots: a.shots + x.shots }), { sips: 0, shots: 0 }) : null;
  const out = me && drink.out.includes(me);
  const label = out ? 'Out' : t ? `${t.sips}${drink.tier === 'deadly' ? ` · ${t.shots}` : ''}` : '';
  return String(ui.html`<button class="drink-chip ${drink.tier}" id="drink-chip" aria-label="Drinks: tallies and I'm out" title="Drinks">
    ${drink.tier === 'deadly' ? ui.icon('skull', 18) : ui.icon('glass', 18)}${label ? ui.html`<span>${label}</span>` : ''}</button>`);
}

// opts: { drink, players, me, isHost, mode: 'room'|'pass', onOut(id, on),
//         onTier(tier), onCap(n) }
export async function drinkSheet(opts) {
  const { drink, players, me, isHost, mode } = opts;
  const deadly = drink.tier === 'deadly';
  const rows = players.map((p) => ({ p, t: drink.tally[p.id] || { sips: 0, shots: 0, gives: 0, forfeits: 0 }, out: drink.out.includes(p.id) }))
    .sort((a, b) => (b.t.sips + b.t.shots * 3) - (a.t.sips + a.t.shots * 3));
  const canToggle = (id) => mode === 'pass' || id === me;
  const lower = drink.tier === 'deadly' ? ['drinking', 'standard'] : drink.tier === 'drinking' ? ['standard'] : [];
  const v = await ui.sheet({
    title: 'Drinks tonight',
    className: 'sheet-drinks',
    body: ui.html`<div class="dk">
      <div class="dk-head">${ui.tierPill(drink.tier, 16)}${deadly ? ui.html`<span class="dk-cap">Shot cap ${drink.shotCap} an hour each</span>` : ''}</div>
      <ul class="dk-list">${rows.map(({ p, t, out }) => ui.html`<li class="${out ? 'out' : ''}">
        ${ui.avatar(p, 34)}
        <span class="dk-who"><span class="dk-name">${p.name}${p.id === me ? ui.html` <em>you</em>` : ''}</span>
          <span class="dk-n"><b>${t.sips}</b> ${t.sips === 1 ? 'sip' : 'sips'}${deadly || t.shots ? ui.html` · <b>${t.shots}</b> ${t.shots === 1 ? 'shot' : 'shots'}` : ''}${t.forfeits ? ui.html` · <b>${t.forfeits}</b> ${t.forfeits === 1 ? 'forfeit' : 'forfeits'}` : ''}${t.gives ? ui.html` · <b>${t.gives}</b> given` : ''}</span></span>
        ${canToggle(p.id)
          ? ui.html`<button class="dk-out ${out ? 'on' : ''}" data-value="out:${p.id}:${out ? 0 : 1}" aria-pressed="${out}" title="${out ? 'Back in: drinks again' : 'Out: drinks become forfeits'}">${out ? 'Out' : "I'm out"}</button>`
          : out ? ui.html`<span class="dk-badge">Out</span>` : ''}
      </li>`)}</ul>
      <p class="dk-note">${ui.icon('drop', 16)} A glass of water between drinks. Out means forfeits instead of drinks, no questions asked. Nobody drives.</p>
      ${isHost && deadly ? ui.html`<div class="dk-row"><span>Shot cap per hour</span>
        <div class="stepper"><button type="button" data-value="cap:${drink.shotCap - 1}" aria-label="Lower the shot cap" ${drink.shotCap <= 0 ? 'disabled' : ''}>&minus;</button><output>${drink.shotCap}</output><button type="button" data-value="cap:${drink.shotCap + 1}" aria-label="Raise the shot cap" ${drink.shotCap >= MAX_SHOT_CAP ? 'disabled' : ''}>+</button></div></div>` : ''}
      ${isHost && lower.length ? ui.html`<div class="dk-drop">${lower.map((t) => ui.html`<button class="btn btn-secondary" data-value="tier:${t}">${ui.icon('down', 18)} Drop to ${ui.TIER_LABEL[t]}</button>`)}</div>` : ''}
    </div>`,
  });
  if (!v) return;
  const [kind, a, b] = String(v).split(':');
  if (kind === 'out') {
    const on = b === '1';
    const p = players.find((x) => x.id === a);
    if (on && !(await ui.confirm(`${p && p.id !== me ? `${p.name} is` : "You're"} out?`, { title: 'Swap drinks for forfeits', ok: "Yes, I'm out" }))) return;
    await opts.onOut(a, on);
    ui.toast(on ? `${p && p.id !== me ? p.name : 'You'}: forfeits from now on` : `${p && p.id !== me ? p.name : 'You'}: back in`, 'info');
    ui.haptic('success');
  } else if (kind === 'tier') {
    if (await ui.confirm(`Drop to ${ui.TIER_LABEL[a]} for the rest of the night? You can raise it again between games.`, { title: `Drop to ${ui.TIER_LABEL[a]}`, ok: 'Drop it' })) {
      await opts.onTier(a);
      ui.haptic('success');
    }
  } else if (kind === 'cap') {
    await opts.onCap(Number(a));
    drinkSheet({ ...opts, drink: { ...drink, shotCap: Number(a) } });
  }
}
