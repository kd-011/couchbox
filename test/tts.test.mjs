import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTts } from '../lib/tts.mjs';

function tmpDir() {
  return mkdtempSync(join(tmpdir(), 'hostbox-tts-'));
}

function fakeFetch(body = 'wav-bytes', ok = true, status = 200) {
  const calls = [];
  const impl = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok,
      status,
      arrayBuffer: async () => Buffer.from(body),
    };
  };
  impl.calls = calls;
  return impl;
}

test('say() renders once, then serves the cache on a repeated line', async () => {
  const dir = tmpDir();
  const fetchImpl = fakeFetch();
  const tts = makeTts({ cacheDir: dir, fetchImpl, log: () => {} });
  try {
    const file = await tts.say('Here we go.');
    assert.match(file, /^[a-f0-9]{40}\.wav$/);
    assert.ok(existsSync(join(dir, file)));
    assert.equal(readFileSync(join(dir, file), 'utf8'), 'wav-bytes');
    assert.equal(fetchImpl.calls.length, 1);

    const again = await tts.say('Here we go.');
    assert.equal(again, file);
    assert.equal(fetchImpl.calls.length, 1, 'a repeated line never hits Kokoro twice');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('say() resolves null for an empty line without calling Kokoro', async () => {
  const fetchImpl = fakeFetch();
  const tts = makeTts({ cacheDir: tmpDir(), fetchImpl, log: () => {} });
  assert.equal(await tts.say(''), null);
  assert.equal(await tts.say('   '), null);
  assert.equal(fetchImpl.calls.length, 0);
});

test('an unreachable Kokoro degrades to null instead of throwing', async () => {
  const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
  let logged = '';
  const tts = makeTts({ cacheDir: tmpDir(), fetchImpl, log: (m) => { logged = m; } });
  assert.equal(await tts.say('Line one'), null);
  assert.match(logged, /ECONNREFUSED/);
});

test('a non-200 from Kokoro also degrades to null', async () => {
  const fetchImpl = fakeFetch('', false, 500);
  const tts = makeTts({ cacheDir: tmpDir(), fetchImpl, log: () => {} });
  assert.equal(await tts.say('Line one'), null);
});

test('after a failure, Kokoro is not hammered again immediately (cooldown)', async () => {
  let n = 0;
  const fetchImpl = async () => { n++; throw new Error('down'); };
  const tts = makeTts({ cacheDir: tmpDir(), fetchImpl, log: () => {} });
  await tts.say('Line one');
  await tts.say('Line two');
  assert.equal(n, 1, 'the second call should back off instead of retrying straight away');
});

test('different text (or voice) hashes to a different cache file', async () => {
  const tts = makeTts({ cacheDir: tmpDir(), fetchImpl: fakeFetch(), log: () => {} });
  const a = await tts.say('Line one');
  const b = await tts.say('Line two');
  assert.notEqual(a, b);
});
