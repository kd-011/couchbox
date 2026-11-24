// Boots a throwaway Games server for the golden journeys and stays up until stopped. The gate (and a
// person) runs this, reads the PREVIEW_URL line, then walks e2e/*.spec.mjs against it.
//
//   node e2e/preview.mjs        prints PREVIEW_URL=http://127.0.0.1:<free port>
//
// A real server on a spare port with a scratch packs folder and no AI key, so nothing touches the live
// site's data or spends money. Games keeps rooms in memory, so there is nothing else to seed.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const port = await new Promise((resolve, reject) => {
  const s = createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port: p } = s.address(); s.close(() => resolve(p)); });
});
const scratch = mkdtempSync(join(tmpdir(), 'games-preview-'));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server.mjs'], {
  cwd: ROOT,
  stdio: 'ignore',
  env: { ...process.env, GAMES_PORT: String(port), GAMES_HOST: '127.0.0.1', GAMES_PACKS_DIR: join(scratch, 'packs'), OPENROUTER_API_KEY: '' },
});

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  server.kill();
  rmSync(scratch, { recursive: true, force: true });
  process.exit(code);
}
server.on('exit', () => stop(1));
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => stop(0));

for (let i = 0; i < 150; i++) {
  try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* still starting */ }
  await new Promise((r) => setTimeout(r, 100));
}
try {
  if (!(await fetch(`${base}/healthz`)).ok) throw new Error('unhealthy');
} catch {
  console.error('games preview: the server never answered /healthz');
  stop(1);
}
console.log(`PREVIEW_URL=${base}`);
