import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchChromium } from '../e2e/ensure-browser.mjs';

const MISSING = new Error("browserType.launch: Executable doesn't exist at /x/chrome-headless-shell\n| Looks like Playwright was just updated |");

test('a browser that is already installed launches without installing', async () => {
  let installs = 0;
  const b = await launchChromium({ launch: async () => 'browser', install: () => { installs++; } });
  assert.equal(b, 'browser');
  assert.equal(installs, 0);
});

test('a missing executable is installed once, then launch is retried', async () => {
  let installs = 0;
  let launches = 0;
  const b = await launchChromium({
    launch: async () => { if (++launches === 1) throw MISSING; return 'browser'; },
    install: () => { installs++; },
  });
  assert.equal(b, 'browser');
  assert.equal(installs, 1);
  assert.equal(launches, 2);
});

test('a failed install is one clean line, not the raw launch error', async () => {
  await assert.rejects(
    launchChromium({ launch: async () => { throw MISSING; }, install: () => { throw new Error('install exited 1'); } }),
    (e) => /^canary: browser install failed: install exited 1$/.test(e.message) && !e.message.includes('\n'),
  );
});

test('a launch failure that is not a missing browser is rethrown untouched', async () => {
  const boom = new Error('sandbox exploded');
  let installs = 0;
  await assert.rejects(launchChromium({ launch: async () => { throw boom; }, install: () => { installs++; } }), boom);
  assert.equal(installs, 0);
});
