// The small "reconnecting" pill for a room screen or the TV. It floats over
// the page (never pushes anything), stays out of sight for a blip, and offers
// a manual retry once the outage is no longer a blip.
import { icon } from './ui.js';

const GRACE_MS = 1500; // a drop that heals inside this is invisible
const RETRY_MS = 8000; // after this the pill becomes a "retry now" button

export function createNetBar(el, { onRetry = null } = {}) {
  let showTimer = null;
  let retryTimer = null;
  let text = '';

  const paint = (retry) => {
    const offline = navigator.onLine === false;
    const label = offline ? 'You are offline. Reconnecting when you are back...' : text;
    el.hidden = false;
    el.setAttribute('role', 'status');
    if (retry && onRetry) {
      el.innerHTML = `${icon('wifiOff', 16)}<button type="button" class="netbar-retry">Still trying to reconnect. Tap to retry now</button>`;
      el.querySelector('button').addEventListener('click', () => { onRetry(); paint(false); armRetry(); });
      el.classList.add('actionable');
    } else {
      el.classList.remove('actionable');
      el.innerHTML = `${icon('wifiOff', 16)}<span>${label}</span><span class="spinner sm"></span>`;
    }
  };
  const armRetry = () => {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => paint(true), RETRY_MS);
  };

  return {
    show(label) {
      text = label;
      if (!el.hidden) return paint(el.classList.contains('actionable'));
      // Offline is not a blip: say so now. Otherwise give the socket a moment.
      if (navigator.onLine === false) { paint(false); return armRetry(); }
      if (showTimer) return;
      showTimer = setTimeout(() => { showTimer = null; paint(false); armRetry(); }, GRACE_MS);
    },
    hide() {
      clearTimeout(showTimer);
      clearTimeout(retryTimer);
      showTimer = retryTimer = null;
      el.hidden = true;
      el.classList.remove('actionable');
    },
  };
}
