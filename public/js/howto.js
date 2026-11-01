// First-time how-to-play: the first time this device starts a game, three
// steps and what the chosen tier means, before anyone is lost. Steps come
// from the game's meta.howto; the full rules stay one tap away.
import * as ui from './ui.js';
import { gameIcon } from './games.js';

const key = (id) => `games.howto.${id}`;

export function seen(id) {
  return localStorage.getItem(key(id)) === '1';
}

export function stepsHTML(meta, cls = '') {
  if (!meta.howto || !meta.howto.length) return ui.raw('');
  return ui.html`<ol class="steps-list ${cls}">${meta.howto.map((s) => ui.html`<li>${s}</li>`)}</ol>`;
}

// Resolves once dismissed. onRules() opens the full rules sheet.
export async function howtoSheet(meta, tier, { onRules } = {}) {
  localStorage.setItem(key(meta.id), '1');
  const tierIcon = tier === 'deadly' ? 'skull' : tier === 'drinking' ? 'glass' : 'star';
  const v = await ui.sheet({
    className: 'sheet-howto',
    body: ui.html`<div class="howto" style="${ui.themeVars(meta)}">
      <div class="howto-hero"><span class="game-row-ico">${ui.raw(gameIcon(meta, 42))}</span><h2>How to play ${meta.name}</h2></div>
      ${stepsHTML(meta)}
      ${meta.variants && meta.variants[tier] ? ui.html`<p class="howto-tier ${tier}">${ui.icon(tierIcon, 18)}<span><b>${ui.TIER_LABEL[tier]}:</b> ${meta.variants[tier]}</span></p>` : ''}
    </div>`,
    actions: [
      { label: "Let's play", tone: 'primary', value: 'go' },
      ...(onRules ? [{ label: 'Full rules', tone: 'secondary', value: 'rules' }] : []),
    ],
    onOpen(wrap) { ui.applyTheme(wrap.querySelector('.sheet'), meta); },
  });
  if (v === 'rules' && onRules) await onRules();
}

// Shows the sheet once per game per device.
export function maybeHowto(meta, tier, opts) {
  if (!meta || seen(meta.id) || !meta.howto || !meta.howto.length) return null;
  return howtoSheet(meta, tier, opts);
}
