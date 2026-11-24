// Journey: pass one phone round the table. Pick a game, type the names, hand the phone over: each player
// confirms it is them before the card opens, and the game survives a refresh. Drinking asks for 18+ once.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, gotIt, BASE } from './lib.mjs';

const { browser, page, errors } = await launch();
after(() => browser.close());

test('one phone runs a full pass-and-play deal and survives a refresh', async () => {
  const p = await page();
  await p.goto(`${BASE}/`);
  await p.locator('a.deck[data-game="imposter"]').click();
  await p.locator('#tier-standard').waitFor();

  // The Drinking tier is behind a one-time 18+ confirm.
  await p.locator('#tier-drinking').click();
  await p.locator('.sheet-age').waitFor();
  await p.keyboard.press('Escape');
  await p.locator('.sheet-wrap.open').waitFor({ state: 'detached' });
  assert.equal(await p.locator('#tier-drinking').getAttribute('aria-checked'), 'false', 'dismissing the 18+ sheet leaves the tier alone');

  await p.locator('#go-pass').click();
  await p.locator('#pass-form').waitFor();
  const names = p.locator('#names input');
  for (const [i, n] of ['Ana', 'Ben', 'Cy'].entries()) await names.nth(i).fill(n);
  await p.locator('#start').click();
  await p.locator('#pp-main').waitFor();

  for (let i = 0; i < 3; i++) {
    await p.locator('.gate').waitFor();
    if (i === 0) await gotIt(p); // the how-to shows once per device
    assert.equal(await p.locator('.imp-card').count(), 0, 'no card is visible on the hand-over screen');
    await p.locator('#gate-go').click();
    await p.locator('.imp-card.flipped').waitFor();
    await p.locator('[data-act="seen"]').click();
  }
  await p.locator('.cd-ring').waitFor();

  await p.reload();
  await p.locator('.cd-ring').waitFor();
  assert.deepEqual(errors, []);
});
