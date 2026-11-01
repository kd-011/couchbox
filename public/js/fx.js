// Showpiece effects shared by every screen: confetti bursts and the stage
// wipe between phases. Everything here is skipped under reduced motion.
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const PARTY = ['#ffb347', '#ff6b6b', '#4dabf7', '#69db7c', '#ffd43b', '#b197fc', '#38d9a9'];

// One canvas, reused; it removes itself when the last piece lands.
let canvas = null;
let pieces = [];
let raf = 0;

function frame() {
  const ctx = canvas.getContext('2d');
  const dpr = canvas.dpr;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const h = canvas.height / dpr;
  pieces = pieces.filter((p) => p.y < h + 40 && p.life > 0);
  for (const p of pieces) {
    p.vx *= 0.985;
    p.vy = p.vy * 0.985 + 0.32;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vr;
    p.life -= 1;
    const flip = Math.abs(Math.cos(p.rot * 0.7));
    ctx.save();
    ctx.translate(p.x * dpr, p.y * dpr);
    ctx.rotate(p.rot);
    ctx.globalAlpha = Math.min(1, p.life / 40);
    ctx.fillStyle = p.c;
    if (p.round) {
      ctx.beginPath();
      ctx.ellipse(0, 0, p.s * dpr * 0.5, p.s * dpr * 0.5 * flip, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(-p.s * dpr * 0.5, -p.s * dpr * 0.3 * flip, p.s * dpr, p.s * dpr * 0.6 * flip);
    }
    ctx.restore();
  }
  if (pieces.length) raf = requestAnimationFrame(frame);
  else { canvas.remove(); canvas = null; raf = 0; }
}

// confetti({ colors, count, origin: {x, y} in 0..1, spread })
export function confetti({ colors = PARTY, count = 140, origin = null, power = 1 } = {}) {
  if (reduced()) return;
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'fx-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
  }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.dpr = dpr;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  const bursts = origin ? [origin] : [{ x: 0.12, y: 0.95, dir: 1 }, { x: 0.88, y: 0.95, dir: -1 }];
  const tvScale = Math.max(1, innerWidth / 900);
  for (const b of bursts) {
    for (let i = 0; i < count / bursts.length; i++) {
      const dir = b.dir ?? (Math.random() < 0.5 ? -1 : 1);
      const ang = origin ? Math.random() * Math.PI * 2 : (-Math.PI / 2) + dir * (0.15 + Math.random() * 0.45);
      const v = (origin ? 4 + Math.random() * 9 : 13 + Math.random() * 11) * power * Math.sqrt(tvScale);
      pieces.push({
        x: b.x * innerWidth, y: b.y * innerHeight,
        vx: Math.cos(ang) * v, vy: Math.sin(ang) * v,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.35,
        s: (7 + Math.random() * 7) * Math.sqrt(tvScale),
        c: colors[i % colors.length], round: Math.random() < 0.3,
        life: 180 + Math.random() * 90,
      });
    }
  }
  if (!raf) raf = requestAnimationFrame(frame);
}

// A coloured band sweeps across the stage between phases on the TV and the
// shared one-phone screen: the "next act" curtain.
export function wipe(color) {
  if (reduced()) return;
  const el = document.createElement('div');
  el.className = 'fx-wipe';
  el.setAttribute('aria-hidden', 'true');
  if (color) el.style.setProperty('--c', color);
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove(), { once: true });
  setTimeout(() => el.remove(), 1500);
}

// Fire any effect a client.js asked for with data-fx="confetti" (once per
// data-fx-key, so a re-render never repeats it).
const fired = new Set();
// silent: just remember the keys (a fresh page load is old news).
export function fromMarkup(root, colors, { silent = false } = {}) {
  for (const el of root.querySelectorAll('[data-fx]')) {
    const key = el.dataset.fxKey || el.dataset.fx;
    if (fired.has(key)) continue;
    fired.add(key);
    if (silent) continue;
    if (el.dataset.fx === 'confetti') {
      const r = el.getBoundingClientRect();
      const origin = r.width ? { x: (r.left + r.width / 2) / innerWidth, y: Math.min(0.8, (r.top + r.height / 2) / innerHeight) } : null;
      confetti({ colors, origin, count: 90 });
    }
  }
}
