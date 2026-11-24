// A playwright-core bump often needs a newer chromium_headless_shell build than
// the PC has. Launch first; only when the executable is missing, install it
// (the same command by hand every time: bug #856) and retry once.
import { chromium } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';

function installHeadlessShell() {
  const cli = join(dirname(createRequire(import.meta.url).resolve('playwright-core/package.json')), 'cli.js');
  const r = spawnSync(process.execPath, [cli, 'install', 'chromium-headless-shell'], { encoding: 'utf8' });
  if (r.status !== 0) {
    const lines = `${r.stderr || ''}${r.stdout || ''}`.trim().split('\n');
    const reason = lines.findLast((l) => /^Error:/.test(l)) || lines.pop();
    throw new Error(r.error?.message || reason || `exit ${r.status}`);
  }
}

export async function launchChromium({ launch = () => chromium.launch(), install = installHeadlessShell } = {}) {
  try {
    return await launch();
  } catch (err) {
    if (!/Executable doesn't exist/.test(err.message)) throw err;
  }
  console.log('canary: browser build missing, installing chromium-headless-shell');
  try {
    install();
  } catch (err) {
    throw new Error(`canary: browser install failed: ${err.message.split('\n')[0]}`);
  }
  return launch();
}
