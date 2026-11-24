// Journey: join a friend's room. A second phone types the code on the home page (the fourth letter is
// enough), picks a name and is seated; the host's lobby and the TV screen both show them.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, hostImposter, BASE, TV } from './lib.mjs';

const { browser, page, errors } = await launch();
after(() => browser.close());

test('a friend joins by code and the host and the TV see them', async () => {
  const host = await page();
  const code = await hostImposter(host);

  const friend = await page();
  await friend.goto(`${BASE}/`);
  await friend.locator('#join-code').pressSequentially(code);
  await friend.locator('#join-name').waitFor({ timeout: 3000 });
  await friend.locator('#join-name').fill('Ben');
  await friend.locator('#join-go').click();
  await friend.locator('.lobby').waitFor();
  await friend.waitForURL(new RegExp(`/r/${code}$`));

  await host.waitForFunction(() => document.querySelectorAll('.seat:not(.seat-empty)').length === 2);
  assert.ok(await host.getByText('Ben').first().isVisible(), 'the host sees Ben seated');

  const tv = await page(TV, 'tv');
  await tv.goto(`${BASE}/tv/${code}`);
  await tv.locator('.tv-lobby').waitFor();
  assert.ok(await tv.getByText('Ben').first().isVisible(), 'the TV lobby shows Ben');
  assert.deepEqual(errors, []);
});
