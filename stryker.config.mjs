/**
 * Mutation testing, run by the merge gate through .cortex-gate.json's "mutation" command (changed lines only:
 * `--mutate lib/rooms.mjs:10-40`). By hand: `npx --yes -p @stryker-mutator/core@10 stryker run --mutate lib/rooms.mjs:10-40`.
 * Stryker is fetched by npx on demand, so package.json stays free of it.
 *
 * node:test gives Stryker no per-test coverage, so every mutant would run the whole suite (about 40 s). Instead
 * each run only takes the test files that name the mutated file (an import or a path in a spawn), and falls back
 * to the whole suite when none do or no --mutate is given. Tests that read `git ls-files` are left out: the
 * sandbox has no .git. The gate passes the report path, the incremental file and a flag saying it is in a
 * throwaway scratch (mutate in place there, quiet reporters).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const scratch = process.env.CORTEX_MUTATION_SCRATCH === '1';
const NEEDS_GIT = new Set(['export-image-gate.test.mjs', 'kit.test.mjs', 'public-export.test.mjs', 'selfhost.test.mjs']);

function testFiles() {
  const out = readdirSync('test').filter((f) => f.endsWith('.test.mjs') && !NEEDS_GIT.has(f)).map((f) => join('test', f));
  for (const g of readdirSync('games', { withFileTypes: true })) {
    if (!g.isDirectory()) continue;
    for (const f of readdirSync(join('games', g.name))) if (f.endsWith('.test.mjs')) out.push(join('games', g.name, f));
  }
  return out;
}

// The --mutate list on the command line: "path:start-end" entries, comma separated, ranges optional.
function mutated() {
  const i = process.argv.indexOf('--mutate');
  const arg = i >= 0 ? process.argv[i + 1] : process.argv.find((a) => a.startsWith('--mutate='))?.slice(9);
  return String(arg || '').split(',').map((s) => s.replace(/:\d+(-\d+)?$/, '').trim()).filter(Boolean);
}

// The mutated files plus the source files that import them, one hop: a rate limiter is tested through the
// room or the AI packs that call it, not by name.
function related(paths) {
  const names = new Set(paths.map((p) => basename(p)));
  const src = ['server.mjs', ...['lib', 'games/_kit', 'public/js'].flatMap((d) => readdirSync(d).filter((f) => /\.(mjs|js)$/.test(f) && !f.endsWith('.test.mjs')).map((f) => join(d, f)))];
  for (const f of src) {
    const text = readFileSync(f, 'utf8');
    for (const p of paths) if (text.includes(`/${basename(p)}'`)) names.add(basename(f));
  }
  return [...names];
}

function pick() {
  const all = testFiles();
  const paths = mutated();
  if (!paths.length) return all;
  const names = related(paths);
  const hit = all.filter((f) => { const src = readFileSync(f, 'utf8'); return names.some((n) => src.includes(`/${n}`) || src.includes(`'${n}'`)); });
  return hit.length ? hit : all;
}

export default {
  testRunner: 'command',
  commandRunner: { command: `node --test --test-force-exit ${pick().join(' ')}` },
  coverageAnalysis: 'off',
  reporters: scratch ? ['json'] : ['clear-text', 'progress', 'json'],
  jsonReporter: { fileName: process.env.CORTEX_MUTATION_REPORT || 'reports/mutation/mutation.json' },
  incrementalFile: process.env.CORTEX_MUTATION_INCREMENTAL || 'reports/stryker-incremental.json',
  inPlace: scratch,
  // Stryker would add `// @ts-nocheck` to the inline scripts in public/index.html, which test/preload.test.mjs matches byte for byte.
  disableTypeChecks: false,
  concurrency: 3,
  timeoutMS: 60000,
  thresholds: { high: 80, low: 60, break: null },
  ignorePatterns: ['data', 'reports', '.shots', '.stryker-tmp', 'docs/screenshots'],
  cleanTempDir: 'always',
};
