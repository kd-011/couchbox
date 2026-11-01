// scripts/export-public.mjs: the exclude list and the secret scan keep private files and
// secrets out of the public copy. Everything here runs on a throwaway git repo with
// invented content; the secret-looking strings are assembled at run time so this file
// itself holds none.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FAKE_KEY = ['sk', 'or', 'v1', 'Q7m2Zk9pLw4Xv8Rn3Tb5Hc6Jd'].join('-'); // not a real key
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 'Test Author', GIT_AUTHOR_EMAIL: 'author@example.com', GIT_COMMITTER_NAME: 'Test Author', GIT_COMMITTER_EMAIL: 'author@example.com' };

let work, repo, denyFile;
const put = (root, rel, body) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); };
const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { env: GIT_ENV, encoding: 'utf8' }).trim();

// A repo whose tracked files include things that must never be published.
function makeRepo(dir, { leak = false, denied = false } = {}) {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Test Author');
  git(dir, 'config', 'user.email', 'author@example.com');
  put(dir, 'README.md', '# Demo\n');
  put(dir, 'server.mjs', 'console.log("hi");\n');
  put(dir, 'lib/thing.mjs', 'export const x = 1;\n');
  put(dir, '.env.example', 'OPENROUTER_API_KEY=sk-or-v1-xxxx\n');
  // tracked on purpose: the exclude list must still keep these out
  put(dir, '.env', `OPENROUTER_API_KEY=${FAKE_KEY}\n`);
  put(dir, 'data/games.db', 'fake database bytes');
  put(dir, 'data/receipts/r1.jpg', 'fake receipt');
  put(dir, 'backups/games-2026-01-01.db', 'fake backup');
  put(dir, 'android/upload.keystore', 'fake keystore');
  put(dir, 'android/keystore.properties', 'storeFile=upload.keystore\n');
  put(dir, '.shots/home.png', 'fake shot');
  put(dir, 'docs/ui-pass-2026-10/phone.png', 'fake old shot');
  if (leak) put(dir, 'lib/leaky.mjs', `export const KEY = '${FAKE_KEY}';\n`);
  if (denied) put(dir, 'lib/host.mjs', '// served from my-private-host.invalid\n');
  git(dir, 'add', '-A', '-f');
  git(dir, 'commit', '-q', '-m', 'private history');
}

const run = (script, args, cwd = ROOT) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', env: { ...process.env, GAMES_DENYLIST: denyFile } });
const exporter = join(ROOT, 'scripts', 'export-public.mjs');

before(() => {
  work = mkdtempSync(join(tmpdir(), 'games-export-test-'));
  repo = join(work, 'src');
  denyFile = join(work, 'denylist.txt');
  writeFileSync(denyFile, '# test denylist\nmy-private-host.invalid\n');
});
after(() => rmSync(work, { recursive: true, force: true }));

// The script resolves its source repo from its own location, so run a copy of scripts/ that sits inside the throwaway repo.
function exportFrom(srcRepo, out, extra = [], scriptsDir = join(ROOT, 'scripts')) {
  const dest = join(srcRepo, '.export-scripts');
  rmSync(dest, { recursive: true, force: true });
  cpSync(scriptsDir, dest, { recursive: true });
  // the copy lives in <repo>/.export-scripts, so its `..` is the repo
  return { ...run(join(dest, 'export-public.mjs'), ['--out', out, ...extra]), dest };
}

test('a clean repo exports as one commit, no remote, without data, env, keystores, shots or old screenshot folders', () => {
  const src = join(work, 'clean');
  makeRepo(src);
  const out = join(work, 'out-clean');
  const r = exportFrom(src, out);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(git(out, 'rev-list', '--count', 'HEAD'), '1');
  assert.equal(git(out, 'remote'), '');
  for (const keep of ['README.md', 'server.mjs', 'lib/thing.mjs', '.env.example']) assert.ok(existsSync(join(out, keep)), `${keep} is kept`);
  for (const gone of ['.env', 'data', 'backups', 'android/upload.keystore', 'android/keystore.properties', '.shots', 'docs/ui-pass-2026-10']) {
    assert.ok(!existsSync(join(out, gone)), `${gone} was omitted`);
  }
  assert.ok(!git(out, 'log', '--all', '--format=%s').includes('private history'), 'no private history');
  assert.ok(!git(out, 'ls-files').split('\n').some((f) => /^(data|backups|\.shots)\/|^\.env$|keystore/.test(f)), 'none of it is tracked either');
  assert.match(r.stdout, /one commit/);
});

test('a planted secret in a tracked file makes the export refuse: non-zero, nothing written, the secret never printed', () => {
  const src = join(work, 'leaky');
  makeRepo(src, { leak: true });
  const out = join(work, 'out-leaky');
  const r = exportFrom(src, out);
  assert.notEqual(r.status, 0);
  assert.ok(!existsSync(out), 'no output directory was left behind');
  assert.match(r.stderr, /lib\/leaky\.mjs/);
  assert.match(r.stderr, /openrouter-key/);
  assert.ok(!(r.stdout + r.stderr).includes(FAKE_KEY), 'the finding names the file and kind, never the value');
});

test('a denylisted string (your own domain, say) also makes it refuse', () => {
  const src = join(work, 'denied');
  makeRepo(src, { denied: true });
  const out = join(work, 'out-denied');
  const r = exportFrom(src, out);
  assert.notEqual(r.status, 0);
  assert.ok(!existsSync(out));
  assert.match(r.stderr, /denylisted string/);
});

test('it will not write inside the source repo, nor over a non-empty directory without --force', () => {
  const src = join(work, 'guarded');
  makeRepo(src);
  assert.notEqual(exportFrom(src, join(src, 'out-inside')).status, 0, 'inside the repo');
  const taken = join(work, 'taken');
  mkdirSync(taken);
  writeFileSync(join(taken, 'precious.txt'), 'keep me');
  const r = exportFrom(src, taken);
  assert.notEqual(r.status, 0);
  assert.equal(readFileSync(join(taken, 'precious.txt'), 'utf8'), 'keep me');
  const forced = exportFrom(src, taken, ['--force']);
  assert.notEqual(forced.status, 0, 'even --force will not delete a directory that is not a git repo');
  assert.equal(readFileSync(join(taken, 'precious.txt'), 'utf8'), 'keep me');
});

// The guard has two layers: the exclude list drops private files, the scan refuses what slips past.
// These prove the test above would notice either being weakened, by running a weakened copy of the script.
function weakened(name, edits) {
  const dir = join(work, name);
  cpSync(join(ROOT, 'scripts'), dir, { recursive: true });
  const file = join(dir, 'export-public.mjs');
  let s = readFileSync(file, 'utf8');
  for (const [from, to] of edits) {
    assert.ok(s.includes(from), `the guard line to weaken is still there: ${from}`);
    s = s.replace(from, to);
  }
  writeFileSync(file, s);
  return dir;
}

test('weaken only the exclude list: the scan still refuses (two layers)', () => {
  const src = join(work, 'mut-a');
  makeRepo(src);
  const dir = weakened('scripts-a', [['if (isExcluded(rel, exclude))', 'if (false)']]);
  const out = join(work, 'out-mut-a');
  const r = exportFrom(src, out, [], dir);
  assert.notEqual(r.status, 0, 'private files slipped past the exclude list but the scan refused them');
  assert.ok(!existsSync(out));
});

test('weaken both layers: the private files leak, so the tests above really are guarding something', () => {
  const src = join(work, 'mut-b');
  makeRepo(src);
  const dir = weakened('scripts-b', [['if (isExcluded(rel, exclude))', 'if (false)'], ['if (findings.length) {', 'if (false) {'], ['if (final.length) {', 'if (false) {']]);
  const out = join(work, 'out-mut-b');
  const r = exportFrom(src, out, [], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(out, 'data', 'games.db')), 'with the guard gone the database is exported');
  assert.ok(existsSync(join(out, '.env')), 'and so is the env file');
});
