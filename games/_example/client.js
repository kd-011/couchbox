// High Card views: the minimal example from docs/GAME-MODULES.md.
function reveal(view, ui) {
  const { html } = ui;
  const r = view.reveal;
  return html`<h2 class="q">${ui.name(r.winner)} wins round ${view.round}</h2>
    <ul class="roster">${view.players.map((id) => html`<li>${ui.avatar(id, 34)}<span>${ui.name(id)}: <b>${r.cards[id].label}</b></span></li>`)}</ul>
    ${ui.drinks(r.drinks)}${ui.scores(view.scores)}`;
}

export function player(view, ui) {
  const { html } = ui;
  if (view.phase === 'flip') return reveal(view, ui);
  if (!view.me) return html`<div class="state-card"><h2>Next round</h2></div>`;
  return html`<div class="tv-stage">
    <div class="tv-big">${view.myCard.label}</div>
    ${view.looked.includes(view.me)
      ? html`<p class="waiting-line">Waiting for the flip ${ui.countdown(view.timer)}</p>`
      : html`<button class="btn btn-primary btn-xl" data-act="looked">Seen it</button>`}
  </div>`;
}

export function tv(view, ui) {
  const { html } = ui;
  if (view.phase === 'flip') return html`<div class="tv-stage">${reveal(view, ui)}</div>`;
  return html`<div class="tv-stage">
    ${ui.countdown(view.timer, { ring: true })}
    ${ui.roster(view.players, { mark: view.looked })}
  </div>`;
}
