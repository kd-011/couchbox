// Shared bits for the golden-journey specs: one Chromium per spec file, phone first, and a refusal to run
// without a preview (start one with `node e2e/preview.mjs`, then `PREVIEW_URL=<it> node --test e2e/*.spec.mjs`).
import { chromium } from 'playwright-core';

export const BASE = (process.env.PREVIEW_URL || '').replace(/\/+$/, '');
if (!BASE) throw new Error('PREVIEW_URL is not set: run `node e2e/preview.mjs` and pass the URL it prints');

export const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
export const TV = { viewport: { width: 1440, height: 900 } };

export async function launch() {
  const browser = await chromium.launch();
  const errors = [];
  // A fresh context is a stranger's phone: no saved name, no seen how-to sheets. Service workers off so a
  // cached shell never hides a broken page.
  async function page(opts = PHONE, label = 'phone') {
    const ctx = await browser.newContext({ ...opts, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${label}: ${m.text()}`); });
    // The "add to home screen" sheet can land on top of anything: dismiss it, it is not part of a journey.
    await p.addLocatorHandler(p.locator('.sheet-wrap.open.sheet-install'), async (w) => { await w.locator('.sheet-actions [data-i="1"]').click().catch(() => {}); }, { noWaitAfter: true });
    return p;
  }
  return { browser, page, errors };
}

// Dismisses the first-time how-to sheet a game shows each device once.
export async function gotIt(p) {
  await p.locator('.sheet-wrap.open.sheet-howto').waitFor({ timeout: 5000 });
  await p.locator('.sheet-wrap.open .sheet-actions [data-i="0"]').click();
}

// Host creates an Imposter room from the home page and lands in its lobby. Returns the 4-letter code.
export async function hostImposter(host, name = 'Ana') {
  await host.goto(`${BASE}/`);
  await host.locator('a.deck[data-game="imposter"]').click();
  await host.locator('#host-name').fill(name);
  await host.locator('#go-room').click();
  await host.locator('.lobby').waitFor();
  await host.waitForURL(/\/r\/[A-Z]{4}$/);
  return host.url().split('/r/')[1];
}
