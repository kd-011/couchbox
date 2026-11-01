// Kokoro TTS for the Host Box's voice: a thin HTTP client for a
// Kokoro TTS server you run yourself (see KOKORO_SERVER_URL),
// with a disk cache keyed by the line's text so a repeated line is never
// re-rendered. Unreachable Kokoro degrades silently: say() resolves null,
// and the room just skips that line; the LEDs and button still work with no
// voice. No LLM flavour here (see docs/HOSTBOX-PROTOCOL.md) - these are
// fixed templates from lib/voice.mjs, spoken as written.
import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BROKEN_COOLDOWN_MS = 60_000;

export function makeTts({
  cacheDir,
  fetchImpl = fetch,
  log = () => {},
  voice = process.env.HOSTBOX_VOICE || 'af_sky',
  speed = Number(process.env.HOSTBOX_VOICE_SPEED || 1.0),
  url = process.env.KOKORO_SERVER_URL || 'http://127.0.0.1:8124',
} = {}) {
  let brokenUntil = 0;
  const known = new Set(); // hashes already confirmed on disk this run

  function hashOf(text) {
    return createHash('sha1').update(`${voice}|${speed}|${text}`).digest('hex');
  }

  // Renders `text` if needed and returns its cache filename ("<hash>.wav"),
  // or null when the line is empty or Kokoro could not be reached.
  async function say(text) {
    const clean = String(text || '').trim();
    if (!clean) return null;
    const hash = hashOf(clean);
    const file = `${hash}.wav`;
    if (known.has(hash)) return file;
    const path = join(cacheDir, file);
    if (existsSync(path)) { known.add(hash); return file; }
    if (Date.now() < brokenUntil) return null;
    try {
      const res = await fetchImpl(`${url}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: clean, voice, speed }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`kokoro ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) throw new Error('kokoro returned no audio');
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(path, buf);
      known.add(hash);
      return file;
    } catch (err) {
      brokenUntil = Date.now() + BROKEN_COOLDOWN_MS;
      log(`[hostbox-voice] ${err.message}`);
      return null;
    }
  }

  return { say, hashOf };
}
