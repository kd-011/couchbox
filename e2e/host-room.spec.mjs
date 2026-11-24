// Journey: host a room on everyone's phones. Tap a game, type a name, and the lobby has the 4-letter code,
// the join link and a scannable QR above the fold.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, hostImposter } from './lib.mjs';

const { browser, page, errors } = await launch();
after(() => browser.close());

test('a host gets a room code and a QR on the lobby in two taps', async () => {
  const host = await page();
  const code = await hostImposter(host);
  assert.match(code, /^[A-HJ-NP-Z]{4}$/, 'a 4-letter code with no I or O');
  assert.ok(await host.locator('.code-tiles').isVisible(), 'the code is on screen');
  const qr = host.locator('.lobby-qr img, .lobby-localhost').first();
  await qr.waitFor();
  assert.equal(await host.locator('.seat:not(.seat-empty)').count(), 1, 'the host holds one seat');
  assert.ok(await host.getByText('Ana').first().isVisible(), 'the host sees their own name');
  assert.deepEqual(errors, []);
});
