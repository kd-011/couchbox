// "Show on TV". The TV must be a SEPARATE page (/tv/CODE) so the host's
// phone stays their private controller.
//  1. Where the browser can present a URL to a screen (the Presentation API:
//     Chrome with a Chromecast / Google TV on the network), offer "Cast to a
//     TV", which opens /tv/CODE on the TV as its own page.
//  2. Everywhere else (iPhone, smart-TV browsers, Fire Stick Silk, a laptop
//     on HDMI): the short TV address plus the room code, and a QR code.
//  3. Always: a warning against screen mirroring, which would put the host's
//     secret cards on the TV.
import * as ui from './ui.js';

let session = null; // the live PresentationConnection, if any

function tvUrl(code) {
  return `${location.origin}/tv/${code}`;
}

// Resolves true only when a real presentation display is available right
// now. Any missing API or a NotSupportedError degrades to false.
export async function castAvailable(code) {
  if (!('PresentationRequest' in window) || !window.isSecureContext) return false;
  try {
    const req = new PresentationRequest([tvUrl(code)]);
    const avail = await Promise.race([
      req.getAvailability(),
      new Promise((r) => setTimeout(() => r(null), 1500)),
    ]);
    return !!(avail && avail.value);
  } catch {
    return false;
  }
}

async function startCast(code) {
  const req = new PresentationRequest([tvUrl(code)]);
  navigator.presentation.defaultRequest = req;
  session = await req.start();
  session.addEventListener('terminate', () => { session = null; });
  return session;
}

export function casting() {
  return !!(session && session.state !== 'terminated' && session.state !== 'closed');
}

// The sheet behind every "Show on TV" button (lobby and in-game menu).
export async function showOnTv(code) {
  const host = location.host;
  const url = tvUrl(code);
  const p = ui.sheet({
    title: 'Show on TV',
    className: 'sheet-tv',
    body: ui.html`<div class="tvs">
      <div class="tvs-cast" id="tvs-cast" hidden></div>
      <div class="tvs-open">
        <p class="tvs-step">On the TV or laptop browser, go to</p>
        <p class="tvs-url"><span>${host}/tv</span></p>
        <p class="tvs-step">and enter</p>
        <div class="code-tiles sm" aria-label="Room code ${code}">${[...code].map((ch, i) => ui.html`<span style="--i:${i}">${ch}</span>`)}</div>
        <div class="tvs-qr"><img class="qr" src="/qr/tv/${code}.svg" width="148" height="148" alt="QR code linking to ${url}"><span>Or scan to open the TV screen on a laptop or tablet</span></div>
      </div>
      <p class="tvs-warn">${ui.icon('eyeOff', 18)}<span><b>Don't screen-mirror this phone.</b> Mirroring copies your screen, secret cards and all. Open the TV screen as its own page instead.</span></p>
      <div class="tvs-actions">
        <a class="btn btn-secondary" href="/tv/${code}" target="_blank" rel="noopener">${ui.icon('tv', 18)} Open TV screen here</a>
        <button class="btn btn-ghost" data-value="copy">${ui.icon('copy', 18)} Copy TV link</button>
      </div>
    </div>`,
    async onOpen(wrap, done) {
      const box = wrap.querySelector('#tvs-cast');
      if (casting()) {
        box.hidden = false;
        box.innerHTML = String(ui.html`<p class="tvs-live">${ui.icon('tv', 20)} Casting to the TV now</p><button class="btn btn-secondary" id="tvs-stop">Stop casting</button>`);
        box.querySelector('#tvs-stop').addEventListener('click', () => { try { session.terminate(); } catch { /* gone */ } session = null; done('stopped'); });
        return;
      }
      if (!(await castAvailable(code))) return;
      if (!wrap.isConnected) return;
      box.hidden = false;
      box.innerHTML = String(ui.html`<button class="btn btn-primary btn-xl" id="tvs-go">${ui.icon('tv', 20)} Cast to a TV</button>
        <p class="tvs-note">Opens the TV screen on your Chromecast or Google TV as its own page. Your phone stays your controller.</p>`);
      box.querySelector('#tvs-go').addEventListener('click', async (e) => {
        const b = e.currentTarget;
        b.classList.add('busy');
        try {
          await startCast(code);
          ui.toast('The TV screen is on', 'info');
          ui.haptic('success');
          done('cast');
        } catch (err) {
          b.classList.remove('busy');
          // NotAllowedError = they closed the picker; anything else is real.
          if (err && err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
            ui.toast("Couldn't cast to that TV", 'error', `${err.name || ''} ${err.message || ''}`.trim());
          }
        }
      });
    },
  });
  const v = await p;
  if (v === 'copy') {
    try {
      await navigator.clipboard.writeText(url);
      ui.toast('TV link copied', 'info');
      ui.haptic('success');
    } catch (err) {
      ui.toast('Could not copy the link', 'error', String(err.message || err));
    }
  }
}
