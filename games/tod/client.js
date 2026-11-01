// Truth or Dare views. Nothing here is secret: everyone sees the same
// prompt at once, so the player view and the TV view read almost the same.
// See docs/GAME-MODULES.md for the contract.

// Ask the platform for one confetti burst, once per key.
function confetti(ui, key) {
  return ui.raw(`data-fx="confetti" data-fx-key="${ui.esc(key)}"`);
}

const lastTurn = (view) => !view.upNext;

// The one-line "what do I do now" strip the platform shows under the top
// bar on phones. Never called for the room TV.
export function now(view, ui) {
  const who = ui.name(view.current);
  if (view.phase === 'final') {
    return ui.isHost ? { text: 'Game over. Tap Play again for another', tone: 'act' } : { text: 'Game over. Check the final scores', tone: 'watch' };
  }
  if (view.phase === 'result') {
    if (ui.isHost) return { text: lastTurn(view) ? 'Tap See the results when you are ready' : 'Tap Next player when you are ready', tone: 'act' };
    if (lastTurn(view)) return { text: 'Last turn done. Host shows the results', tone: 'watch' };
    if (view.me && view.upNext === view.me) return { text: 'You are up next. Get ready', tone: 'wait' };
    return { text: `Turn over. ${ui.name(view.upNext)} is up next`, tone: 'watch' };
  }
  const dare = view.prompt && view.prompt.type === 'dare';
  if (ui.surface === 'shared') {
    if (view.phase === 'ready') return { text: `${who}'s turn: tap Truth or Dare for them`, tone: 'act' };
    if (view.phase === 'reveal') return { text: `When ${who} is done, tap Did it or Skipped`, tone: 'act' };
    return null;
  }
  if (!view.me) return { text: 'You are in from the next game', tone: 'watch' };
  const up = view.me === view.current;
  if (view.phase === 'ready') {
    return up ? { text: 'Your turn: pick truth or dare', tone: 'act' } : { text: `Waiting for ${who} to pick truth or dare`, tone: 'wait' };
  }
  if (view.phase === 'reveal') {
    if (up) return { text: dare ? 'Do the dare, then tap Did it or Skipped' : 'Answer out loud, then tap Did it or Skipped', tone: 'act' };
    return { text: dare ? `Watch ${who} do the dare` : `Listen to ${who}'s answer`, tone: 'watch' };
  }
  return null;
}

function spiceLabel(s) {
  return s === 'wild' ? 'Wild' : s === 'spicy' ? 'Spicy' : 'Mild';
}

function turnLabel(view) {
  const rot = view.rotations > 1 ? ` · lap ${view.rotation} of ${view.rotations}` : '';
  return `Turn ${view.turnNo} of ${view.turnsTotal}${rot} · ${spiceLabel(view.spice)}`;
}

// `canAct` is true on the up player's own screen, and on the shared screen
// in pass and play (where the "screen" and the host are the same thing).
function readyBlock(view, ui, canAct) {
  const { html } = ui;
  const who = view.current;
  return html`<div class="tv-stage tod-ready">
    <p class="tv-sub">${turnLabel(view)}</p>
    <div class="tod-spot">${ui.avatar(who, ui.surface === 'tv' ? 160 : 104)}</div>
    <h2 class="tod-up">${canAct ? "You're up" : html`${ui.name(who)} is up`}</h2>
    ${canAct
      ? html`<div class="tod-pick">
            <button class="tod-choice tod-truth" data-act="choose" data-arg="truth">Truth</button>
            <button class="tod-choice tod-dare" data-act="choose" data-arg="dare">Dare</button>
          </div>`
      : ui.surface === 'tv' ? html`<p class="lead-line big">Truth, or dare?</p>` : ''}
  </div>`;
}

function revealBlock(view, ui, canAct) {
  const { html } = ui;
  const p = view.prompt;
  return html`<div class="tv-stage tod-reveal">
    <div class="tod-card tod-card-${p.type}">
      <div class="tod-card-top"><span class="tod-type">${p.type === 'dare' ? 'Dare' : 'Truth'}</span><span class="tod-for">${ui.avatar(view.current, 28)} ${ui.name(view.current)} · ${spiceLabel(view.spice)}</span></div>
      <h2 class="tod-prompt">${p.text}</h2>
    </div>
    ${canAct
      ? html`<div class="tod-pick">
          <button class="btn btn-secondary btn-xl" data-act="resolve" data-arg="skip">Skipped</button>
          <button class="btn btn-good btn-xl" data-act="resolve" data-arg="did">Did it</button>
        </div>`
      : ''}
    ${view.upSkips >= 1 ? ui.deadlyNote(canAct ? 'You skipped once already. Skip again and it’s a shot' : `${ui.name(view.current)} skipped once already. Skip again and it’s a shot`) : ''}
  </div>`;
}

function resultBlock(view, ui) {
  const { html } = ui;
  const r = view.result;
  const headline = r.outcome === 'did' ? `${ui.name(view.current)} did it` : `${ui.name(view.current)} skipped it`;
  return html`<div class="tv-stage tod-result ${r.outcome === 'did' ? 'is-did' : 'is-skip'}">
    <div class="tod-stamp">${r.outcome === 'did' ? 'Done' : 'Skipped'}</div>
    <h2 class="tod-headline">${headline}</h2>
    <p class="tod-was">${r.type === 'dare' ? 'Dare' : 'Truth'}: ${r.text}</p>
    ${ui.drinks(r.drinks)}
    <p class="tod-next">${lastTurn(view)
    ? 'That was the last turn. The results are next.'
    : html`Up next: ${ui.avatar(view.upNext, 28)} <b>${ui.name(view.upNext)}</b>`}</p>
    ${view.scores ? html`<h3 class="sec">Scores</h3>${ui.scores(view.scores)}` : ''}
  </div>`;
}

function finalBlock(view, ui) {
  const { html } = ui;
  const board = view.final && view.final.board;
  if (board && board.length) {
    const best = board[0].score;
    const tops = board.filter((r) => r.score === best);
    const headline = best === 0 ? 'Game over'
      : tops.length === 1 ? `${ui.name(tops[0].id)} wins`
        : tops.length === board.length ? 'Dead heat' : `${tops.map((r) => ui.name(r.id)).join(' and ')} tie`;
    return html`<div class="tv-stage tod-final">
      ${best > 0 && tops.length < board.length ? html`<div class="tod-spot">${tops.map((r) => ui.avatar(r.id, 84))}</div>` : ''}
      <h2 class="tod-headline" ${best > 0 ? confetti(ui, `tod-final-${view.gameKey}`) : ''}>${headline}</h2>
      ${ui.scores(board)}
    </div>`;
  }
  return html`<div class="tv-stage tod-final">
    <h2 class="tod-headline">Game over</h2>
  </div>`;
}

export function player(view, ui) {
  const { html } = ui;
  if (view.phase === 'final') return finalBlock(view, ui);
  if (!view.me) {
    return html`<div class="state-card">${ui.icon('users', 36)}<h2>You are in from the next game</h2></div>`;
  }
  const isUp = view.me === view.current;
  if (view.phase === 'ready') return readyBlock(view, ui, isUp);
  if (view.phase === 'reveal') return revealBlock(view, ui, isUp);
  if (view.phase === 'result') return resultBlock(view, ui);
  return html``;
}

// The host bar already has Truth/Dare and Did it/Skipped buttons (and in
// pass and play the shared screen IS the host), so tv() never repeats them
// here, on the TV or on the shared phone: it's read-only, like Heads' TV.
export function tv(view, ui) {
  const { html } = ui;
  if (view.phase === 'final') return finalBlock(view, ui);
  if (view.phase === 'ready') return readyBlock(view, ui, false);
  if (view.phase === 'reveal') return revealBlock(view, ui, false);
  if (view.phase === 'result') return resultBlock(view, ui);
  return html``;
}
