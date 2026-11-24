// Journey: find a game to play. Home on a phone lists every game; search narrows it, a dead search has a
// way out, and Surprise me deals a real game.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, BASE } from './lib.mjs';

const { browser, page, errors } = await launch();
after(() => browser.close());

test('home lists the games, search narrows them, Surprise me picks one', async () => {
  const { games } = await (await fetch(`${BASE}/games/index.json`)).json();
  const p = await page();
  await p.goto(`${BASE}/`);
  await p.locator('a.deck').first().waitFor();
  assert.equal(await p.locator('a.deck').count(), games.length, 'one card per game');

  await p.locator('#home-search').fill('imp');
  await p.waitForFunction(() => document.querySelectorAll('a.deck').length === 1);
  assert.match(await p.locator('a.deck').innerText(), /imposter/i);

  await p.locator('#home-search').fill('zzzz');
  await p.locator('.home-empty').waitFor();
  await p.locator('#home-clear').click();
  await p.waitForFunction((n) => document.querySelectorAll('a.deck').length === n, games.length);

  await p.locator('#surprise').click();
  await p.locator('.sheet-wrap.open [data-value="play"]').waitFor();
  const picked = await p.locator('.sheet-wrap.open [data-game-id]').getAttribute('data-game-id');
  assert.ok(games.some((g) => g.id === picked), `Surprise me picked a real game (${picked})`);
  await p.locator('.sheet-wrap.open [data-value="play"]').click();
  await p.waitForURL(new RegExp(`#/new/${picked}$`));
  await p.locator('#tier-standard').waitFor();
  assert.deepEqual(errors, []);
});
