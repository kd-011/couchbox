// Renders public/og-image.png (the 1200x630 social card) from the app's own
// font and icon. No domain is drawn on it, so a copy hosted anywhere shares
// correctly. Run after changing the game count or the tagline:
//   node scripts/og-image.mjs
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { loadGames } from '../lib/registry.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const count = (await loadGames(join(root, 'games'))).size;
const font = readFileSync(join(root, 'public/fonts/bricolage.woff2')).toString('base64');
const icon = readFileSync(join(root, 'public/icon.svg')).toString('base64');
const html = `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: B; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 200 800; font-stretch: 75% 100%; }
html, body { margin: 0; width: 1200px; height: 630px; }
body { background: radial-gradient(900px 500px at 15% 0%, #2a2142 0%, #0e0a16 70%), #0b0812; display: flex; align-items: center; gap: 56px; padding: 0 88px; box-sizing: border-box; font-family: B, system-ui, sans-serif; color: #f4efff; }
img { width: 190px; height: 190px; border-radius: 44px; }
h1 { font-size: 132px; line-height: 1; margin: 0 0 22px; font-weight: 800; font-stretch: 75%; letter-spacing: -4px; }
h1 i { color: #ffb347; font-style: normal; }
p { margin: 0; font-size: 34px; line-height: 1.35; color: #b8aed6; font-weight: 600; max-width: 720px; }
</style><img src="data:image/svg+xml;base64,${icon}"><div><h1>Games<i>.</i></h1><p>${count} free party and drinking games. Pass one phone round, or everyone joins on their own.</p></div>`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
writeFileSync(join(root, 'public/og-image.png'), await page.screenshot());
await browser.close();
console.log(`og-image.png: ${count} games`);
