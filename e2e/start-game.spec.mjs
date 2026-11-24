// Journey: start the game with three phones. The host starts Imposter, every phone gets the how-to once and
// then a card, and the TV never learns the secret word.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, hostImposter, gotIt, BASE, TV } from './lib.mjs';

const { browser, page, errors } = await launch();
after(() => browser.close());

test('three phones get a card and the TV shows no secret', async () => {
  const host = await page();
  const code = await hostImposter(host);
  const phones = [host];
  for (const name of ['Ben', 'Cy']) {
    const p = await page();
    await p.goto(`${BASE}/r/${code}`);
    await p.locator('#join-name').fill(name);
    await p.locator('#join-go').click();
    await p.locator('.lobby').waitFor();
    phones.push(p);
  }
  const tv = await page(TV, 'tv');
  await tv.goto(`${BASE}/tv/${code}`);
  await tv.locator('.tv-lobby').waitFor();

  await host.waitForFunction(() => document.querySelectorAll('.seat:not(.seat-empty)').length === 3);
  await host.getByRole('button', { name: /start imposter/i }).click();
  for (const p of phones) {
    await gotIt(p);
    await p.locator('.imp-card').waitFor();
  }

  // Flip every card: exactly one phone is the imposter, and only the others ever see the word.
  let word = null;
  let imposters = 0;
  for (const p of phones) {
    await p.locator('.imp-card').click();
    if (await p.locator('.imp-back.is-imposter').count()) imposters++;
    else word = (await p.locator('.imp-word').textContent()).trim();
  }
  assert.equal(imposters, 1, 'exactly one imposter');
  assert.ok(word, 'the crew has a word');
  assert.ok(!(await tv.content()).includes(word), 'the TV page never carries the word');
  assert.deepEqual(errors, []);
});
