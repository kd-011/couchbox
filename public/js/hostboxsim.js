// Virtual Host Box: a browser stand-in for the Deadly Host Box hardware,
// speaking the exact device protocol in docs/HOSTBOX-PROTOCOL.md, so pairing
// and the button/LED/voice loop can be tested with no hardware at all.
import * as ui from './ui.js';

const ID_KEY = 'games.hostbox.id';
const CODE_KEY = 'games.hostbox.code';
const LONG_PRESS_MS = 700;
const SLOTS = 6;
const SLOT_ANGLE = (i) => (Math.PI * 2 * i) / SLOTS - Math.PI / 2;

function boxId() {
  let id = localStorage.getItem(ID_KEY);
  if (!id) {
    id = Array.from({ length: 6 }, () => '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 33)]).join('');
    localStorage.setItem(ID_KEY, id);
  }
  return id;
}

function wsUrl() {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

const root = document.querySelector('#hb-root');
const audio = document.querySelector('#hb-audio');

const id = boxId();
let ws = null;
let attempt = 0;
let retryTimer = null;
let heartbeat = null;
let wsStatus = 'connecting'; // connecting | connecting (identified) | paired | waiting
// { code } once the server confirms pairing. Persisted, like the real
// firmware's first-boot setup remembering a room code in flash: a refresh
// or reconnect rejoins the same room directly, no re-pairing needed.
let paired = localStorage.getItem(CODE_KEY) ? { code: localStorage.getItem(CODE_KEY) } : null;
let scene = { name: 'idle', params: {} };
let button = { mode: 'idle', label: null };
let caption = '';
let captionTimer = null;
let pressState = null; // { t } while pointer is down

function render() {
  if (!paired) {
    root.innerHTML = String(ui.html`
      <div class="hb-card">
        <h2>This box</h2>
        <div class="hb-status ${wsStatus === 'connecting' ? 'off' : 'waiting'}">
          <span class="dot"></span>
          <span>${wsStatus === 'connecting' ? 'Connecting...' : 'Waiting to be paired'}</span>
        </div>
        <div class="hb-id"><output id="hb-id-out">${id}</output>
          <button class="btn btn-secondary" id="hb-copy">${ui.icon('copy', 18)} Copy</button>
        </div>
        <p class="sheet-text">Open the room's lobby, tap "Add a Host Box", and enter or scan this ID.</p>
      </div>
      <div class="hb-card">
        <h2>Or join with a room code</h2>
        <form id="hb-join" class="hb-join">
          <input class="input" id="hb-code" maxlength="4" placeholder="CODE" autocapitalize="characters" autocomplete="off">
          <button class="btn btn-primary" type="submit">Join</button>
        </form>
        <p class="sheet-text">This is what a box's own first-boot setup would do: remember a room code and reattach to it on every reconnect, once that room's host has approved this box's ID. The code alone is never enough; the first time, the host still has to "Add a Host Box" with the ID above.</p>
      </div>
      <div class="hb-card">
        <h2>Reset</h2>
        <button class="btn btn-ghost" id="hb-reset">Forget this box's ID and make a new one</button>
      </div>
    `);
    root.querySelector('#hb-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(id); ui.toast('ID copied', 'info'); } catch { /* ignore */ }
    });
    root.querySelector('#hb-join').addEventListener('submit', (e) => {
      e.preventDefault();
      const code = root.querySelector('#hb-code').value.trim().toUpperCase();
      if (!code) return;
      send({ t: 'device', boxId: id, code });
      // No synchronous success signal: {t:'paired'} only arrives if that
      // room already approved this exact box ID. Otherwise this quietly
      // joins pendingBoxes and nothing visibly changes until the host pairs it.
      ui.toast('Sent. If this room already knows this box, it will pair instantly - otherwise ask the host to "Add a Host Box" with the ID above.', 'info');
    });
    root.querySelector('#hb-reset').addEventListener('click', () => {
      localStorage.removeItem(ID_KEY);
      location.reload();
    });
    return;
  }

  const s = scene.name;
  const p = scene.params || {};
  const onSlots = new Set(p.slots || p.candidateSlots || []);
  const landed = p.landedSlot;
  const teamColorOf = (slot) => (p.teams || []).find((t) => (t.slots || []).includes(slot))?.color || null;

  const cx = 160; const cy = 150; const r = 104; const gr = 30; // fits labels inside the 320x320 viewBox on every slot, including the bottom one
  const ring = Array.from({ length: SLOTS }, (_, i) => {
    const a = SLOT_ANGLE(i);
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    const on = onSlots.has(i) || landed === i;
    const fill = s === 'winner' && on ? 'var(--amber)'
      : (s === 'roulette' && landed === i) ? 'var(--deadly)'
      : (s === 'deadlyTakeover' && on) ? 'var(--deadly)'
      : (s === 'teamColours' && teamColorOf(i)) ? teamColorOf(i)
      : s === 'countdown' ? 'var(--accent)'
      : 'var(--surface-3)';
    const cls = `hb-slot scene-${s} ${on ? 'on' : ''} ${landed === i ? 'landed' : ''}`;
    return `<circle class="${cls}" cx="${x}" cy="${y}" r="${gr}" fill="${fill}"></circle><text class="hb-slot-label" x="${x}" y="${y + gr + 16}" text-anchor="middle">${i + 1}</text>`;
  }).join('');

  const centerText = s === 'countdown' ? String(p.seconds ?? '') : s === 'roulette' ? 'Spinning' : s === 'winner' ? 'Winner' : s === 'deadlyTakeover' ? 'Deadly' : s === 'teamColours' ? 'Teams' : 'Idle';

  root.innerHTML = String(ui.html`
    <div class="hb-card">
      <div class="hb-status on"><span class="dot"></span><span>Paired to room ${paired.code}</span></div>
      <button class="btn btn-ghost" id="hb-unpair" style="justify-self:start">Forget pairing</button>
    </div>
    <div class="hb-card">
      <h2>LED ring</h2>
      <div class="hb-stage">
        <div class="hb-ring">
          <svg viewBox="0 0 320 320" aria-hidden="true">${ui.raw(ring)}</svg>
          <div class="hb-ring-center"><strong>Scene</strong><span>${centerText}</span></div>
        </div>
        <div class="hb-btn-wrap">
          <div class="hb-button-label">${button.label || (button.mode === 'idle' ? 'Nothing to press' : button.mode)}</div>
          <button class="hb-button" id="hb-button" ${button.mode === 'idle' ? 'disabled' : ''}>${button.mode === 'idle' ? '—' : 'Press'}</button>
          <div class="hb-button-hint">Tap = press. Hold ${LONG_PRESS_MS}ms+ = long-press (pass host).</div>
        </div>
        <div class="hb-caption" aria-live="polite">${caption}</div>
      </div>
    </div>
  `);
  root.querySelector('#hb-unpair').addEventListener('click', () => {
    paired = null;
    localStorage.removeItem(CODE_KEY);
    render();
  });
  wireButton(root.querySelector('#hb-button'));
}

function wireButton(btn) {
  if (!btn || btn.disabled) return;
  const start = (e) => {
    e.preventDefault();
    pressState = { t: Date.now() };
    btn.classList.add('pressed');
  };
  const end = () => {
    if (!pressState) return;
    const held = Date.now() - pressState.t;
    pressState = null;
    btn.classList.remove('pressed');
    ui.haptic('tap');
    send({ t: held >= LONG_PRESS_MS ? 'longpress' : 'press' });
  };
  const cancel = () => { pressState = null; btn.classList.remove('pressed'); };
  btn.addEventListener('pointerdown', start);
  btn.addEventListener('pointerup', end);
  btn.addEventListener('pointercancel', cancel);
  btn.addEventListener('pointerleave', cancel);
}

function setCaption(text) {
  caption = text || '';
  clearTimeout(captionTimer);
  if (caption) captionTimer = setTimeout(() => { caption = ''; render(); }, 6000);
  render();
}

function send(msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function onMessage(msg) {
  if (msg.t === 'paired') {
    paired = { code: msg.code };
    localStorage.setItem(CODE_KEY, msg.code);
    render();
  } else if (msg.t === 'unpaired') {
    paired = null;
    localStorage.removeItem(CODE_KEY);
    ui.toast(msg.reason || 'This box was unpaired', 'info');
    render();
  } else if (msg.t === 'scene') {
    scene = { name: msg.name, params: msg.params || {} };
    render();
  } else if (msg.t === 'button') {
    button = { mode: msg.mode, label: msg.label };
    if (paired) render();
  } else if (msg.t === 'audio') {
    setCaption(msg.text || '');
    audio.src = msg.url;
    audio.play().catch(() => ui.toast('Tap anywhere to allow sound', 'info'));
  } else if (msg.t === 'buttonResult') {
    if (!msg.ok) ui.toast(msg.message || 'That press did nothing right now', 'error');
  } else if (msg.t === 'error') {
    if (msg.code === 'noroom' && paired) {
      // A stale remembered room: fall back to waiting to be paired, same as
      // the real firmware would, instead of retrying the dead code forever.
      paired = null;
      localStorage.removeItem(CODE_KEY);
      render();
    }
    ui.toast(msg.message || 'Error', 'error');
  }
}

function connect() {
  clearTimeout(retryTimer);
  wsStatus = paired ? 'paired' : 'connecting';
  render();
  let socket;
  try { socket = new WebSocket(wsUrl()); } catch { return scheduleRetry(); }
  ws = socket;
  socket.onopen = () => {
    attempt = 0;
    send(paired ? { t: 'device', boxId: id, code: paired.code } : { t: 'device', boxId: id });
    wsStatus = 'waiting'; // identified; 'paired' flips this once {t:'paired'} actually arrives
    render();
    clearInterval(heartbeat);
    heartbeat = setInterval(() => send({ t: 'heartbeat' }), 15_000);
  };
  socket.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    onMessage(msg);
  };
  socket.onclose = () => {
    if (ws !== socket) return;
    clearInterval(heartbeat);
    scheduleRetry();
  };
  socket.onerror = () => {};
}

function scheduleRetry() {
  wsStatus = 'connecting';
  render();
  const delay = Math.min(8000, 400 * 2 ** attempt) + Math.random() * 300;
  attempt++;
  retryTimer = setTimeout(connect, delay);
}

render();
connect();
