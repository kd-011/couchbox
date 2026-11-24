// The public export takes its tree from `git archive` and copies it with cpSync, which turns a relative
// symlink into an absolute path inside its temp folder. So every symlink in the repo, such as the
// dossier-scribe pin links in dossiers/, has to be export-ignore in .gitattributes or it ships broken.
// Reads the files directly, so it needs no .git. That the pin links exist is checked in
// test/private-source.test.mjs, since the export drops them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isExcluded } from '../scripts/export-public.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function exportIgnored() {
  const file = join(ROOT, '.gitattributes');
  if (!existsSync(file)) return new Set();
  return new Set(readFileSync(file, 'utf8').split('\n')
    .map((l) => l.trim().split(/\s+/))
    .filter(([path, ...attrs]) => path && !path.startsWith('#') && attrs.includes('export-ignore'))
    .map(([path]) => path));
}

function* symlinks(dir) {
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules') continue;
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) yield relative(ROOT, p).split(sep).join('/');
    else if (st.isDirectory()) yield* symlinks(p);
  }
}

test('every symlink in the repo is export-ignore, so none reaches the public export', () => {
  const ignored = exportIgnored();
  for (const link of symlinks(ROOT)) assert.ok(ignored.has(link), `${link} is export-ignore in .gitattributes`);
});

test('the pin-link check lives in test/private-source.test.mjs, which the export drops with the links', () => {
  assert.ok(isExcluded('test/private-source.test.mjs'), 'test/private-source.test.mjs is on the export exclude list');
});
