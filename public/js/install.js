// "Add Games to your home screen". Never on landing: the prompt waits for
// the first finished game on this device. Android/Chrome uses the captured
// beforeinstallprompt; iPhone and iPad (no install API) get a sheet with the
// Share > Add to Home Screen steps and an arrow toward the Share button.
// A dismiss holds it off for 30 days; installed (standalone) never sees it.
import * as ui from './ui.js';

const SNOOZE_KEY = 'games.installSnooze';
const SNOOZE_MS = 30 * 24 * 60 * 60_000;
let deferred = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e;
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  localStorage.setItem(SNOOZE_KEY, String(Date.now() + 10 * 365 * 24 * 60 * 60_000));
});

export function installed() {
  return matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;
}

function ios() {
  const ua = navigator.userAgent;
  return /iP(hone|od|ad)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}
const ipad = () => /iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

function snoozed() {
  return Number(localStorage.getItem(SNOOZE_KEY) || 0) > Date.now();
}
function snooze() {
  localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
}

// Call when a game finishes on this device. Shows the prompt at most once
// per page load, and only when it can actually help.
let shownThisLoad = false;
export function afterGame({ delay = 2600 } = {}) {
  if (shownThisLoad || installed() || snoozed()) return;
  if (!deferred && !ios()) return;
  shownThisLoad = true;
  setTimeout(() => offer(), delay);
}

export async function offer() {
  if (installed()) return;
  if (deferred) return offerAndroid();
  if (ios()) return offerIos();
}

const art = () => ui.raw(`<div class="inst-art" aria-hidden="true">
  <img src="/icon-192.png" width="72" height="72" alt="">
  <span class="inst-dot"></span>
</div>`);

async function offerAndroid() {
  const v = await ui.sheet({
    title: 'Put Games on your home screen',
    className: 'sheet-install',
    body: ui.html`${art()}<ul class="inst-perks">
      <li>${ui.icon('play', 18)}<span>Opens full screen, straight into the games</span></li>
      <li>${ui.icon('wifiOff', 18)}<span>One-phone games work with no signal</span></li>
      <li>${ui.icon('check', 18)}<span>Free, no account, nothing tracked</span></li>
    </ul>`,
    actions: [
      { label: 'Add to home screen', tone: 'primary', value: 'add' },
      { label: 'Not now', tone: 'secondary', value: 'later' },
    ],
  });
  if (v !== 'add') { snooze(); return; }
  const e = deferred;
  deferred = null;
  try {
    await e.prompt();
    const choice = await e.userChoice;
    if (choice && choice.outcome === 'accepted') { ui.toast('Games is on your home screen', 'info'); ui.haptic('success'); }
    else snooze();
  } catch (err) {
    ui.toast("Couldn't open the install prompt", 'error', String(err.message || err));
  }
}

async function offerIos() {
  const pad = ipad();
  const share = '<svg class="i" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3M7.5 7.5L12 3l4.5 4.5"/><path d="M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"/></svg>';
  const add = '<svg class="i" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8.5v7M8.5 12h7"/></svg>';
  const v = await ui.sheet({
    title: 'Put Games on your home screen',
    className: `sheet-install sheet-install-ios ${pad ? 'ipad' : ''}`,
    body: ui.html`${art()}<ol class="inst-steps">
      <li><span class="inst-n">1</span><span>Tap <b class="inst-key">${ui.raw(share)} Share</b> ${pad ? 'at the top of Safari' : ui.html`in Safari's bar <span class="inst-or">(or ••• first, then Share)</span>`}</span></li>
      <li><span class="inst-n">2</span><span>Scroll down and tap <b class="inst-key">${ui.raw(add)} Add to Home Screen</b></span></li>
      <li><span class="inst-n">3</span><span>Tap <b>Add</b>. Games opens full screen from then on.</span></li>
    </ol>`,
    actions: [{ label: 'Got it', tone: 'primary', value: 'ok' }, { label: 'Not now', tone: 'secondary', value: 'later' }],
    onOpen(wrap) {
      const arrow = document.createElement('div');
      arrow.className = `inst-arrow ${pad ? 'up' : 'down'}`;
      arrow.setAttribute('aria-hidden', 'true');
      arrow.innerHTML = '<svg viewBox="0 0 40 64" width="40" height="64"><path d="M20 4v52M8 44l12 14 12-14" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      wrap.appendChild(arrow);
    },
  });
  snooze(); // either way, don't nag: they know where it is now
  if (v === 'ok') ui.haptic('success');
}
