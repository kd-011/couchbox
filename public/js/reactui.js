// Reaction bursts: a quick emoji anyone in a room can send, floats across
// every screen. Platform-only, not tied to any game: see the 'react'
// message in lib/rooms.mjs, docs/GAME-MODULES.md "Teams and audience".
import * as ui from './ui.js';

export const REACTIONS = ['😂', '🔥', '👀', '😬', '🍻', '💀'];

export function floatReaction(emoji) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const el = document.createElement('span');
  el.className = 'reaction-float';
  el.textContent = emoji;
  el.style.left = `${8 + Math.random() * 80}%`;
  el.style.setProperty('--drift', `${Math.round((Math.random() - 0.5) * 80)}px`);
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

export async function reactionSheet(send) {
  const v = await ui.sheet({
    title: 'React',
    className: 'sheet-react',
    body: `<div class="react-grid">${REACTIONS.map((e) => `<button type="button" class="react-pick" data-value="${e}">${e}</button>`).join('')}</div>`,
  });
  if (v) { ui.haptic('tap'); send(v); }
}
