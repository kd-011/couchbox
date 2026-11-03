// UI kit shared by the platform screens and every game's client.js (games
// get these through the `ui` object, so a client.js needs no imports).
import * as sfx from './sfx.js';
import { morph } from './morph.js';

/* ---------- templating: html`` auto-escapes every interpolation ---------- */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

class Safe {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = (s) => new Safe(String(s ?? ''));

function fmt(v) {
  if (v === null || v === undefined || v === false || v === true) return '';
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(fmt).join('');
  return esc(v);
}

export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) out += fmt(vals[i]);
  });
  return new Safe(out);
}

/* ---------- icons: one stroke family, authored paths ---------- */

const ICONS = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  share: '<path d="M12 15V3M7.5 7.5L12 3l4.5 4.5"/><path d="M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>',
  qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2"/>',
  tv: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
  crown: '<path d="M4 18h16l-1.5-9-4.5 4-2-6-2 6-4.5-4z"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0111 0"/><path d="M16 4.6a3.2 3.2 0 010 6.2M17.5 13.6A5.5 5.5 0 0120.5 19"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  leave: '<path d="M14 4h4a2 2 0 012 2v12a2 2 0 01-2 2h-4"/><path d="M10 16l-4-4 4-4M6 12h10"/>',
  book: '<path d="M4 5.5A1.5 1.5 0 015.5 4H11v16H5.5A1.5 1.5 0 014 18.5zM20 5.5A1.5 1.5 0 0018.5 4H13v16h5.5a1.5 1.5 0 001.5-1.5z"/>',
  glass: '<path d="M6 3h12l-1.6 15.2a2 2 0 01-2 1.8H9.6a2 2 0 01-2-1.8z"/><path d="M6.6 8h10.8"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  phones: '<rect x="2.5" y="5" width="8" height="15" rx="2"/><rect x="13.5" y="4" width="8" height="15" rx="2"/><path d="M5.8 17h1.4M16.8 16h1.4"/>',
  star: '<path d="M12 3.5l2.6 5.5 6 .7-4.5 4.1 1.2 5.9L12 16.8l-5.3 2.9 1.2-5.9-4.5-4.1 6-.7z"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 6.1A9.6 9.6 0 0112 6c6 0 9.5 6 9.5 6a16 16 0 01-3 3.7M6.4 7.6A16 16 0 002.5 12S6 18 12 18a9 9 0 004.2-1"/><path d="M9.9 10a3 3 0 004.1 4.1"/>',
  wifiOff: '<path d="M3 3l18 18M8.5 16.4a5 5 0 017 0M5 12.9a10 10 0 015.2-2.7M19 12.9a10 10 0 00-2.4-1.8M2 9.4a15 15 0 014.6-2.8M22 9.4A15 15 0 0011 5.1"/><circle cx="12" cy="20" r=".8"/>',
  refresh: '<path d="M20 12a8 8 0 11-2.3-5.7M20 4v5h-5"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  skull: '<path d="M12 3a8 8 0 00-8 8c0 2.6 1.3 4.6 3 5.8V20h10v-3.2c1.7-1.2 3-3.2 3-5.8a8 8 0 00-8-8z"/><circle cx="9" cy="11.5" r="1.6"/><circle cx="15" cy="11.5" r="1.6"/><path d="M10 20v-2M14 20v-2"/>',
  shot: '<path d="M7 4h10l-1.6 15a1.5 1.5 0 01-1.5 1.3h-3.8a1.5 1.5 0 01-1.5-1.3z"/><path d="M8.2 12h7.6"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 01-8 0z"/><path d="M8 6H5a3 3 0 003 3M16 6h3a3 3 0 01-3 3M12 13v4M8.5 20h7M10 17h4"/>',
  drop: '<path d="M12 3.5s-6 6.4-6 10.5a6 6 0 0012 0c0-4.1-6-10.5-6-10.5z"/>',
  sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11"/>',
  mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r=".9"/><circle cx="4.5" cy="12" r=".9"/><circle cx="4.5" cy="18" r=".9"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M5 19h14"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 10.5h.01M15.5 10.5h.01M8 14.5a4 4 0 008 0"/>',
  tap: '<path d="M9 11V5.5a1.5 1.5 0 013 0V11M12 10V8.5a1.5 1.5 0 013 0V11M15 10.5a1.5 1.5 0 013 0V15a6 6 0 01-6 6h-.5a6 6 0 01-4.8-2.4L4.3 15a1.5 1.5 0 012.3-1.9L9 15.5"/>',
  hourglass: '<path d="M7 3h10M7 21h10M8 3v3.5a4 4 0 001.6 3.2L12 12l2.4-2.3A4 4 0 0016 6.5V3M8 21v-3.5a4 4 0 011.6-3.2L12 12l2.4 2.3a4 4 0 011.6 3.2V21"/>',
  cast: '<path d="M3 8V6a2 2 0 012-2h14a2 2 0 012 2v12a2 2 0 01-2 2h-6"/><path d="M3 12a8 8 0 018 8M3 16a4 4 0 014 4"/><circle cx="3.5" cy="19.5" r=".8"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  shuffle: '<path d="M3.5 7.5H7c3 0 4.5 2 6 4.5s3 4.5 6 4.5h1.5M3.5 16.5H7c1.4 0 2.5-.5 3.4-1.4M13.6 8.9c.9-.9 2-1.4 3.4-1.4h2.5"/><path d="M17.5 4.5l3 3-3 3M17.5 13.5l3 3-3 3"/>',
  hostbox: '<rect x="3" y="11" width="18" height="9" rx="3"/><circle cx="12" cy="7" r="3.2"/><path d="M7.5 15.5h.01M16.5 15.5h.01"/>',
};

export function icon(name, size = 22, label = '') {
  const a11y = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"';
  return raw(`<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${a11y}>${ICONS[name] || ''}</svg>`);
}

/* ---------- players ---------- */

const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#8b7fb0');

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
}

// A player's face (their picked emoji) in their colour; initials if none.
export function avatar(p, size = 40, extra = '') {
  if (!p) return raw(`<span class="av av-ghost" style="--s:${size}px">?</span>`);
  const face = typeof p.avatar === 'string' && p.avatar && p.avatar.length <= 8;
  return raw(`<span class="av ${face ? 'av-face' : ''} ${extra}" style="--c:${safeColor(p.color)};--s:${size}px" aria-hidden="true">${esc(face ? p.avatar : initials(p.name))}</span>`);
}

/* ---------- game colour ---------- */

function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
// Text colour that reads best on a game's colour: ink or white.
export function inkFor(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return '#14092b';
  const L = lum(hex);
  return (L + 0.05) / 0.0573 >= 1.05 / (L + 0.05) ? '#140c1f' : '#ffffff';
}
// style="" value that lights a screen in a game's colour.
export function themeVars(meta) {
  const a = meta && /^#[0-9a-f]{6}$/i.test(meta.accent || '') ? meta.accent : '#9d7bff';
  return `--accent:${a};--accent-ink:${inkFor(a)}`;
}
export function applyTheme(el, meta) {
  const a = meta && /^#[0-9a-f]{6}$/i.test(meta.accent || '') ? meta.accent : '#9d7bff';
  el.style.setProperty('--accent', a);
  el.style.setProperty('--accent-ink', inkFor(a));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#0b0812');
}

/* ---------- clock and countdowns ---------- */

let clockOffset = 0;
export function syncClock(serverNow) {
  if (Number.isFinite(serverNow)) clockOffset = serverNow - Date.now();
}
export const serverNow = () => Date.now() + clockOffset;

function remainingMs(t) {
  if (!t) return 0;
  return t.paused ? t.remaining : Math.max(0, t.endsAt - serverNow());
}

export function fmtTime(ms) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ui.countdown(view.timer) -> "1:23" that ticks; { ring: true } wraps it in
// a progress ring; { size } sets the ring diameter.
export function countdown(t, opts = {}) {
  if (!t) return raw('');
  const data = `data-ends="${Number(t.endsAt)}" data-paused="${t.paused ? 1 : 0}" data-remaining="${Number(t.remaining)}" data-total="${Number(t.total)}"`;
  const ms = remainingMs(t);
  if (!opts.ring) return raw(`<span class="cd" ${data}>${fmtTime(ms)}</span>`);
  const size = opts.size || 220;
  const r = 46;
  const c = 2 * Math.PI * r;
  const pct = t.total ? ms / t.total : 0;
  return raw(`<div class="cd-ring ${t.paused ? 'paused' : ''}" style="--size:${size}px" ${data}>
    <svg viewBox="0 0 100 100" aria-hidden="true"><circle class="track" cx="50" cy="50" r="${r}"/><circle class="bar" cx="50" cy="50" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}"/></svg>
    <span class="cd" ${data}>${fmtTime(ms)}</span></div>`);
}

function tickCountdowns() {
  for (const el of document.querySelectorAll('[data-ends]')) {
    const t = {
      endsAt: Number(el.dataset.ends), paused: el.dataset.paused === '1',
      remaining: Number(el.dataset.remaining), total: Number(el.dataset.total),
    };
    const ms = remainingMs(t);
    // The last five seconds beep on the stage (TV, or the one shared phone);
    // never on every player's phone at once.
    if (document.body.dataset.stage && el.classList.contains('cd') && !t.paused) {
      const sec = Math.ceil(ms / 1000);
      if (el.dataset.beeped !== String(sec) && sec <= 5 && ms > 0 && t.total > 8000) { el.dataset.beeped = String(sec); sfx.beep(false); }
      if (ms <= 0 && el.dataset.beeped !== '0' && el.dataset.beeped) { el.dataset.beeped = '0'; sfx.beep(true); }
    }
    if (el.classList.contains('cd')) {
      const txt = fmtTime(ms);
      if (el.textContent !== txt) el.textContent = txt;
      el.classList.toggle('urgent', ms <= 10_000 && ms > 0 && !t.paused);
      el.classList.toggle('done', ms <= 0);
    } else if (el.classList.contains('cd-ring')) {
      const bar = el.querySelector('.bar');
      if (bar && t.total) {
        const c = Number(bar.getAttribute('stroke-dasharray'));
        bar.setAttribute('stroke-dashoffset', String(c * (1 - ms / t.total)));
      }
      el.classList.toggle('urgent', ms <= 10_000 && !t.paused);
    }
  }
}
setInterval(tickCountdowns, 200);

/* ---------- feedback ---------- */

export function haptic(kind = 'tap') {
  if (!navigator.vibrate || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const p = { tap: 8, success: [12, 40, 16], warn: [30, 30, 30], danger: 40 }[kind] || 8;
  try { navigator.vibrate(p); } catch { /* not allowed */ }
}

// navigator.clipboard only exists on https and localhost, and a home network is neither.
export async function copyText(text) {
  if (navigator.clipboard) {
    try { await navigator.clipboard.writeText(text); return; } catch { /* try the old way */ }
  }
  const t = document.createElement('textarea');
  t.value = text;
  t.readOnly = true;
  t.style.cssText = 'position:fixed;opacity:0;font-size:16px';
  document.body.appendChild(t);
  t.select();
  t.setSelectionRange(0, text.length);
  const copied = document.execCommand('copy');
  t.remove();
  if (!copied) throw new Error('this browser blocked copying');
}

export function toast(text, kind = 'info', detail = '') {
  let box = document.getElementById('toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.innerHTML = `${kind === 'drink' ? icon('glass', 18) : kind === 'water' ? icon('drop', 18) : kind === 'error' ? icon('close', 18) : icon('check', 18)}<div><div>${esc(text)}</div>${detail ? `<small>${esc(detail)}</small>` : ''}</div>`;
  box.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, kind === 'error' || kind === 'water' ? 5000 : 2600);
}

// Full-screen colour flash with one giant word: "Correct!", "Pass", "Time".
// kind: 'good' | 'bad' | 'accent' | a #hex. Skipped under reduced motion.
export function flash(word, kind = 'good') {
  const c = { good: '#3ddc97', bad: '#ff6a4d', accent: getComputedStyle(document.querySelector('.screen, .tv') || document.body).getPropertyValue('--accent').trim() || '#9d7bff' }[kind] || kind;
  if (kind === 'good') sfx.good(); else if (kind === 'bad') sfx.bad();
  haptic(kind === 'bad' ? 'warn' : 'success');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const el = document.createElement('div');
  el.className = 'flash';
  el.setAttribute('aria-hidden', 'true');
  el.style.setProperty('--c', c);
  el.style.setProperty('--ink', /^#[0-9a-f]{6}$/i.test(c) ? inkFor(c) : '#0b0812');
  el.innerHTML = `<b>${esc(word)}</b>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1350);
}

// The "what do I do now" strip: a game's client.now(view, ui), or the
// platform's own line for screens it owns.
function nowHTML(line) {
  if (!line || !line.text) return '';
  const tone = ['act', 'wait', 'watch'].includes(line.tone) ? line.tone : 'watch';
  const ic = tone === 'act' ? 'tap' : tone === 'wait' ? 'hourglass' : 'eye';
  return String(html`<span class="now-dot">${icon(ic, 16)}</span><span>${line.text}</span>`);
}
export function setNow(el, line, ctx = {}) {
  if (!el) return;
  const html = nowHTML(line);
  if (el.dataset.line === html) return;
  const was = el.dataset.tone;
  el.dataset.line = html;
  el.className = `now ${line && line.text ? `now-${line.tone || 'watch'}` : ''}`;
  morph(el, html);
  el.dataset.tone = line ? line.tone || '' : '';
  // Your move: a nudge in the hand, once per new ask.
  if (line && line.tone === 'act' && was !== 'act' && !ctx.first) { haptic('success'); sfx.pop(); }
}


/* ---------- sound: one global switch ---------- */

export function soundButton() {
  const on = sfx.soundOn();
  return raw(`<button class="icon-btn" data-sound-toggle aria-pressed="${on}" aria-label="Sound ${on ? 'on' : 'off'}" title="Sound ${on ? 'on' : 'off'}">${icon(on ? 'sound' : 'mute')}</button>`);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-sound-toggle]');
  if (!b) return;
  const on = !sfx.soundOn();
  sfx.setSound(on);
  for (const el of document.querySelectorAll('[data-sound-toggle]')) {
    el.setAttribute('aria-pressed', String(on));
    el.setAttribute('aria-label', `Sound ${on ? 'on' : 'off'}`);
    el.title = `Sound ${on ? 'on' : 'off'}`;
    el.innerHTML = String(icon(on ? 'sound' : 'mute'));
  }
  if (on) sfx.blip();
  haptic('tap');
});

/* ---------- sheets (bottom sheet dialog) ---------- */

export function sheet({ title = '', body = '', actions = [], dismissable = true, className = '', onOpen = null, collect = null }) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const wrap = document.createElement('div');
    wrap.className = `sheet-wrap ${className}`;
    wrap.innerHTML = `<div class="sheet-backdrop"></div>
      <div class="sheet" role="dialog" aria-modal="true" ${title ? 'aria-labelledby="sheet-title"' : ''}>
        <div class="sheet-grab" aria-hidden="true"></div>
        ${title ? `<h2 id="sheet-title" class="sheet-title">${esc(title)}</h2>` : ''}
        <div class="sheet-body">${String(body)}</div>
        ${actions.length ? `<div class="sheet-actions">${actions.map((a, i) => `<button class="btn btn-${a.tone || 'secondary'}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}
      </div>`;
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('open'));
    const done = (v) => {
      const data = collect ? collect(wrap) : undefined;
      wrap.classList.remove('open');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => wrap.remove(), 260);
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      resolve(collect ? { value: v, data } : v);
    };
    const onKey = (e) => { if (e.key === 'Escape' && dismissable) done(undefined); };
    document.addEventListener('keydown', onKey);
    wrap.querySelector('.sheet-backdrop').addEventListener('click', () => dismissable && done(undefined));
    wrap.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => done(actions[Number(b.dataset.i)].value)));
    wrap.querySelectorAll('[data-value]').forEach((b) => b.addEventListener('click', () => done(b.dataset.value)));
    if (onOpen) onOpen(wrap, done);
    // Keyboard and mouse get focus moved in; on a touch phone a ring on the
    // first button just looks like a bug.
    const first = wrap.querySelector('[data-value], [data-i], input, button');
    const box = wrap.querySelector('.sheet');
    box.setAttribute('tabindex', '-1');
    const target = first && !matchMedia('(pointer: coarse)').matches ? first : box;
    setTimeout(() => target.focus({ preventScroll: true }), 50);
  });
}

export async function confirm(text, { ok = 'Yes', cancel = 'Cancel', danger = false, title = '' } = {}) {
  if (danger) haptic('warn');
  const v = await sheet({
    title: title || text,
    body: title ? html`<p class="sheet-text">${text}</p>` : '',
    actions: [{ label: ok, tone: danger ? 'danger' : 'primary', value: true }, { label: cancel, tone: 'secondary', value: false }],
  });
  return v === true;
}

/* ---------- drinking ---------- */

export function drinkLine(d, name) {
  const n = d.n;
  switch (d.unit) {
    case 'shot': return `${name} takes ${n === 1 ? 'a shot' : `${n} shots`}`;
    case 'finish': return `${name} finishes their drink`;
    case 'give': return `${name} hands out ${n} sip${n === 1 ? '' : 's'}`;
    case 'forfeit': return `${name} does a forfeit`;
    case 'waterfall': return d.playerId ? `Waterfall, ${name} starts` : 'Waterfall';
    case 'social': return `Everyone drinks ${n}`;
    default: return `${name} drinks ${n}`;
  }
}

export const TIER_LABEL = { standard: 'Standard', drinking: 'Drinking', deadly: 'Deadly' };

// The tier pill for headers: nothing for Standard.
export function tierPill(tier, size = 14) {
  if (tier === 'deadly') return html`<span class="pill pill-deadly">${icon('skull', size)} Deadly</span>`;
  if (tier === 'drinking') return html`<span class="pill pill-amber">${icon('glass', size)} Drinking</span>`;
  return raw('');
}

// One-time 18+ / drink responsibly confirm. Resolves true if it is OK to
// show drinking content on this device. Deadly (shots) gets its own one-time
// explainer of the safety rails on top.
export async function ageGate(tier = 'drinking') {
  const adult = localStorage.getItem('games.18ok') === '1';
  if (tier !== 'deadly' && adult) return true;
  if (tier === 'deadly' && adult && localStorage.getItem('games.deadlyok') === '1') return true;
  const deadly = tier === 'deadly';
  const v = await sheet({
    title: deadly ? 'Deadly: sips and shots' : 'Drinking version',
    className: `sheet-age ${deadly ? 'sheet-deadly' : ''}`,
    body: deadly
      ? html`<div class="age-mark deadly">${icon('skull', 34)}<span>18+</span></div>
      <p class="sheet-text">Deadly adds shots as rare, announced moments on top of the sips. The rails stay on: a shot cap per player per hour (over it, sips instead), water-break reminders, the host can drop the tier any time, and anyone can tap <b>I'm out</b> to swap their drinks for forfeits.</p>
      <p class="sheet-text">For adults of legal drinking age. Eat something, pace yourselves, and nobody drives.</p>`
      : html`<div class="age-mark">${icon('glass', 34)}<span>18+</span></div>
      <p class="sheet-text">For adults of legal drinking age. Sips are suggestions: anyone can tap <b>I'm out</b> and swap their drinks for forfeits, any time. Look after your mates and get home safe.</p>`,
    actions: [
      { label: deadly ? "I'm 18+, bring the shots" : 'I am 18+, deal me in', tone: deadly ? 'deadly' : 'amber', value: true },
      { label: 'Not for me', tone: 'secondary', value: false },
    ],
  });
  if (v === true) {
    localStorage.setItem('games.18ok', '1');
    if (deadly) localStorage.setItem('games.deadlyok', '1');
    return true;
  }
  return false;
}

/* ---------- misc ---------- */

export function plural(n, word, many = `${word}s`) {
  return `${n} ${n === 1 ? word : many}`;
}

let wakeLock = null;
export async function keepAwake(on = true) {
  try {
    if (on && !wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* not supported or denied */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && document.body.dataset.awake) keepAwake(true); });
