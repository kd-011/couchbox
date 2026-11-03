// Synthesised sound for the big moments (no audio files to download, works
// offline). Browsers only allow sound after a tap, so the first tap anywhere
// unlocks it. Off switch: localStorage games.sound = '0'.
let ctx = null;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

export function soundOn() {
  return localStorage.getItem('games.sound') !== '0';
}
export function setSound(on) {
  localStorage.setItem('games.sound', on ? '1' : '0');
  if (on) unlock();
}
export function unlocked() {
  return !!ctx && ctx.state === 'running';
}
export function unlock() {
  const c = ac();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}
document.addEventListener('pointerdown', unlock, { capture: true, passive: true });

function tone({ type = 'sine', from, to = from, at = 0, dur = 0.3, gain = 0.3, attack = 0.005 }) {
  const c = ac();
  if (!c || !soundOn()) return;
  const t = c.currentTime + at;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(from, t);
  if (to !== from) o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise({ at = 0, dur = 0.4, gain = 0.2, hp = 800 }) {
  const c = ac();
  if (!c || !soundOn()) return;
  const t = c.currentTime + at;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = c.createBufferSource();
  const f = c.createBiquadFilter();
  const g = c.createGain();
  f.type = 'highpass';
  f.frequency.value = hp;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.buffer = buf;
  src.connect(f).connect(g).connect(c.destination);
  src.start(t);
}

// The Deadly stinger: a low hit, a rising siren, then a heavy landing.
export function stinger() {
  tone({ type: 'sine', from: 90, to: 38, dur: 0.9, gain: 0.55 });
  noise({ dur: 0.35, gain: 0.25, hp: 1800 });
  tone({ type: 'sawtooth', from: 180, to: 720, at: 0.25, dur: 1.1, gain: 0.07, attack: 0.3 });
}
export function tick(at = 0) {
  tone({ type: 'square', from: 1400, dur: 0.035, gain: 0.05, at });
}
export function land() {
  tone({ type: 'sine', from: 70, to: 40, dur: 0.7, gain: 0.6 });
  tone({ type: 'triangle', from: 660, to: 640, at: 0.02, dur: 0.6, gain: 0.12 });
  noise({ dur: 0.25, gain: 0.18, hp: 2500 });
}
export function chime() {
  tone({ type: 'sine', from: 880, dur: 0.5, gain: 0.12 });
  tone({ type: 'sine', from: 1320, at: 0.09, dur: 0.6, gain: 0.08 });
}
export function fanfare() {
  [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'triangle', from: f, at: i * 0.12, dur: 0.5, gain: 0.12 }));
  tone({ type: 'triangle', from: 1047, at: 0.5, dur: 1.2, gain: 0.1 });
}
export function drumroll(sec = 1.4) {
  for (let i = 0; i < sec * 22; i++) noise({ at: i / 22, dur: 0.06, gain: 0.05 + (i / (sec * 22)) * 0.08, hp: 300 });
}

/* UI sounds: short, quiet, never on every tap of a list */

// A soft click for primary taps.
export function blip() {
  tone({ type: 'triangle', from: 520, to: 760, dur: 0.07, gain: 0.05 });
}
// Someone joined: a bubbly two-note pop.
export function pop() {
  tone({ type: 'sine', from: 380, to: 900, dur: 0.12, gain: 0.12 });
  tone({ type: 'sine', from: 990, dur: 0.12, gain: 0.06, at: 0.07 });
}
// A new phase of the game: an airy sweep.
export function whoosh() {
  noise({ dur: 0.45, gain: 0.07, hp: 1200 });
  tone({ type: 'sine', from: 240, to: 520, dur: 0.35, gain: 0.05, attack: 0.12 });
}
// Right / wrong.
export function good() {
  tone({ type: 'triangle', from: 660, dur: 0.14, gain: 0.12 });
  tone({ type: 'triangle', from: 990, dur: 0.3, gain: 0.12, at: 0.1 });
}
export function bad() {
  tone({ type: 'sawtooth', from: 220, to: 150, dur: 0.38, gain: 0.07 });
  tone({ type: 'square', from: 110, dur: 0.3, gain: 0.04, at: 0.02 });
}
// The last seconds of a countdown, then the buzzer.
export function beep(final = false) {
  if (final) tone({ type: 'square', from: 300, to: 260, dur: 0.6, gain: 0.08 });
  else tone({ type: 'sine', from: 1046, dur: 0.09, gain: 0.08 });
}
