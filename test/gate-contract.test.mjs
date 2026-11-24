// The merge gate reads .cortex-gate.json and e2e/journeys.md. This keeps both honest: the contract has the
// keys the gate needs, every risky path still exists, and the journeys list and the specs agree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const contract = JSON.parse(readFileSync(join(ROOT, '.cortex-gate.json'), 'utf8'));

test('the gate contract names a test runner, a mutation tool, the journeys and a preview', () => {
  assert.match(contract.testFiles, /\{files\}/);
  assert.match(contract.mutation, /\{(files|ranges)\}/);
  assert.ok(contract.e2e && contract.preview, 'e2e and preview are both set');
  assert.ok(existsSync(join(ROOT, 'stryker.config.mjs')), 'the mutation command needs its config');
  assert.ok(existsSync(join(ROOT, contract.preview.split(' ').pop())), 'the preview script exists');
});

test('every risky path and mutation path points at something real', () => {
  for (const p of contract.riskyPaths.filter((x) => !x.includes('*'))) assert.ok(existsSync(join(ROOT, p)), `riskyPaths: ${p} does not exist`);
  for (const p of contract.mutationPaths.filter((x) => !x.includes('*'))) assert.ok(existsSync(join(ROOT, p)), `mutationPaths: ${p} does not exist`);
  for (const p of ['lib/rooms.mjs', 'lib/ai-packs.mjs', 'lib/packs.mjs', 'lib/ratelimit.mjs']) assert.ok(contract.riskyPaths.includes(p), `${p} is money, abuse or data and must stay risky`);
});

test('e2e/journeys.md lists 3 to 5 journeys and each names a spec that exists, with no spec left out', () => {
  const md = readFileSync(join(ROOT, 'e2e/journeys.md'), 'utf8');
  const listed = [...md.matchAll(/^- .*`(e2e\/[\w.-]+\.spec\.mjs)`\)\s*$/gm)].map((m) => m[1]);
  assert.ok(listed.length >= 3 && listed.length <= 5, `3 to 5 journeys, found ${listed.length}`);
  for (const spec of listed) assert.ok(existsSync(join(ROOT, spec)), `${spec} is listed but missing`);
  const onDisk = readdirSync(join(ROOT, 'e2e')).filter((f) => f.endsWith('.spec.mjs')).map((f) => `e2e/${f}`);
  assert.deepEqual([...listed].sort(), onDisk.sort(), 'journeys.md and the specs on disk agree');
});
