// Salad Bowl views. Pure functions of (view, ui) returning markup; buttons
// and forms with data-act dispatch actions (see docs/GAME-MODULES.md).

const PLACEHOLDERS = [
  'Dolly Parton', 'A rubber chicken', 'Your most embarrassing moment', 'The Eiffel Tower',
  'Netflix and chill', 'A mid-life crisis', 'That one annoying neighbour', 'Bitcoin',
];

const DEADLY_NOTE = 'Still holding a card when the buzzer sounds? Shot.';
const NEXT_ROUND_LABELS = ['Describe', 'One Word', 'Act'];

function roundHeader(view, ui) {
  const { html } = ui;
  return html`<div class="sb-round">
    <span class="pill">Round ${view.round} of ${view.roundsTotal}</span>
    <strong class="sb-round-name">${view.roundLabel}</strong>
    <p class="sb-rule">${view.roundRule}</p>
  </div>`;
}

function submitForm(view, ui) {
  const { html } = ui;
  const placeholder = PLACEHOLDERS[view.myCount % PLACEHOLDERS.length];
  return html`<div class="sb-submit">
    <h2 class="sb-title">Fill the bowl</h2>
    <div class="sb-pips" aria-label="${view.myCount} of ${view.submitTarget} written">${Array.from({ length: view.submitTarget }, (_, i) => html`<span class="${i < view.myCount ? 'on' : ''}"></span>`)}</div>
    ${view.myDone
      ? html`<div class="waiting-line">${ui.icon('check', 18)} All ${view.submitTarget} written</div>`
      : html`<form class="sb-write" data-act="submitWords">
          <input class="input input-xl" name="text" maxlength="40" autocomplete="off" placeholder="${placeholder}" data-draft="sb-write-${view.myCount}" required>
          <button class="btn btn-primary btn-xl" type="submit">Add to the bowl</button>
        </form>`}
    ${view.mySubmissions.length ? html`<ul class="sb-mine-list">${view.mySubmissions.map((t) => html`<li>${t}</li>`)}</ul>` : ''}
    <div class="waiting-line">${view.submitReadyCount} of ${view.totalPlayers} players ready${view.myDone && (view.submitPending || []).length
      ? html`<br>Still writing: ${view.submitPending.map((id) => ui.name(id)).join(', ')}` : ''}</div>
  </div>`;
}

function readyScreen(view, ui) {
  const { html } = ui;
  const isActive = view.me && view.me === view.active;
  return html`<div class="sb-stage">
    ${roundHeader(view, ui)}
    ${isActive
      ? html`<h2 class="sb-you">Your turn</h2>
          ${ui.deadlyNote(DEADLY_NOTE)}
          <button class="btn btn-primary btn-xl" data-act="start">Start my turn</button>`
      : html`<div class="sb-up">${ui.avatar(view.active, 96)}</div><h2 class="sb-you">${ui.name(view.active)} is up</h2>`}
  </div>`;
}

function cardPanel(view, ui, interactive) {
  const { html } = ui;
  return html`<div class="sb-turn">
    <div class="sb-top"><span class="pill">${view.roundLabel}</span><span class="sb-pot">${view.potLeft} in the bowl</span>${ui.countdown(view.timer)}</div>
    <div class="sb-card">${view.card}</div>
    ${interactive ? html`<div class="sb-turn-actions">
      <button class="btn btn-secondary btn-xl" data-act="skip">Skip</button>
      <button class="btn btn-primary btn-xl" data-act="gotIt">Got it!</button>
    </div>` : ''}
    <p class="sb-got-n"><b>${view.gottenCount}</b> got this turn</p>
    ${ui.deadlyNote(DEADLY_NOTE)}
  </div>`;
}

function turnWatch(view, ui) {
  const { html } = ui;
  return html`<div class="sb-stage">
    ${roundHeader(view, ui)}
    <div class="sb-watch">
      ${ui.countdown(view.timer, { ring: true, size: ui.surface === 'tv' ? 260 : 170 })}
      <div class="sb-watch-who">${ui.avatar(view.active, 64)}<h2 class="sb-you">${ui.name(view.active)}</h2></div>
    </div>
    <p class="sb-got-n"><b>${view.gottenCount}</b> got · ${view.potLeft} still in the bowl</p>
    ${ui.deadlyNote(DEADLY_NOTE)}
  </div>`;
}

function recap(view, ui) {
  const { html } = ui;
  const r = view.lastTurn;
  return html`<div class="sb-recap">
    ${r.cleared
      ? html`<h2 class="sb-cleared" data-fx="confetti" data-fx-key="sb-clear-${r.round}-${r.player}-${r.gotten.length}-${r.gotten[0] || ''}">Cleared the bowl!</h2><p class="lead-line">${ui.name(r.player)} got through every phrase left.</p>`
      : r.timedOut
        ? html`<h2 class="sb-caught">${ui.name(r.player)} was caught holding a card</h2>
          ${r.heldPhrase ? html`<p class="sb-held">${r.heldPhrase}</p>` : ''}`
        : html`<h2 class="sb-ended">${ui.name(r.player)}'s turn was ended early</h2>`}
    ${r.gotten.length
      ? html`<h3 class="sec">${ui.plural(r.gotten.length, 'phrase')} got</h3><ul class="sb-got-list">${r.gotten.map((t, i) => html`<li style="--i:${i}">${t}</li>`)}</ul>`
      : html`<p class="waiting-line">Nothing got that turn</p>`}
    ${ui.drinks(r.drinks)}
    ${ui.surface !== 'tv' && view.scores.some((x) => x.score) ? html`<h3 class="sec">Scores</h3>${ui.scores(view.scores, { limit: 8 })}` : ''}
    ${r.roundDone
      ? html`<p class="lead-line sb-round-done">${view.round < view.roundsTotal ? `Round over. Next up: ${NEXT_ROUND_LABELS[view.round]}.` : 'That was the last round.'}</p>`
      : ''}
  </div>`;
}

function teamBoard(view, ui) {
  const { html } = ui;
  const tb = view.final.teamBoard;
  if (!tb) return '';
  const byId = Object.fromEntries(view.teams.map((t) => [t.id, t]));
  const top = tb.length ? tb[0].score : 0;
  return html`<h3 class="sec">Teams</h3><ol class="scores">${tb.map((r) => {
    const t = byId[r.id];
    return html`<li class="${r.score === top && top > 0 ? 'lead' : ''}">
      <span class="rank">${1 + tb.filter((x) => x.score > r.score).length}</span>
      <span class="av" style="--c:${t.color};--s:32px" aria-hidden="true">${(t.name || '?').slice(0, 2).toUpperCase()}</span>
      <span class="nm">${t.name}</span><span class="pts">${r.score}</span></li>`;
  })}</ol>`;
}

function finalCard(view, ui) {
  const { html } = ui;
  const board = view.final.board;
  const best = board.length ? board[0].score : 0;
  const tops = board.filter((r) => r.score === best);
  const headline = best === 0 ? 'Game over'
    : tops.length === 1 ? `${ui.name(tops[0].id)} wins`
      : tops.length === board.length ? 'Dead heat' : `${tops.map((r) => ui.name(r.id)).join(' and ')} tie`;
  return html`<div class="sb-final">
    <div class="winner sb-winner" ${best > 0 ? html`data-fx="confetti" data-fx-key="sb-final-${board.map((r) => `${r.id}.${r.score}`).join('-')}"` : ''}>${best > 0 && tops.length < board.length ? html`<div class="winner-avs">${tops.map((r) => ui.avatar(r.id, 72))}</div>` : ''}<h2>${headline}</h2></div>
    ${ui.scores(board)}
    ${teamBoard(view, ui)}
  </div>`;
}

export function player(view, ui) {
  const { html } = ui;
  if (view.phase === 'final') return finalCard(view, ui);
  if (view.phase === 'submit') {
    if (!view.me) return html`<div class="state-card"><h2>Watching</h2><p>Hang tight for the next game.</p></div>`;
    return submitForm(view, ui);
  }
  if (!view.me) {
    return html`<div class="state-card">${ui.icon('eye', 36)}<h2>You are watching</h2><p>Round ${view.round} is under way. Hang tight for the next one.</p></div>`;
  }
  if (view.phase === 'ready') return readyScreen(view, ui);
  if (view.phase === 'turnEnd') return recap(view, ui);
  // turn
  if (view.isActive) {
    return view.card ? cardPanel(view, ui, true) : html`<div class="state-card"><h2>Dealing...</h2></div>`;
  }
  return turnWatch(view, ui);
}

export function tv(view, ui) {
  const { html } = ui;
  const shared = ui.surface === 'shared';
  const side = ui.surface === 'tv' && view.scores.some((x) => x.score) ? html`<aside class="tv-side">${ui.scores(view.scores, { limit: 8 })}</aside>` : '';
  if (view.phase === 'final') return html`<div class="tv-stage">${finalCard(view, ui)}</div>`;
  if (view.phase === 'submit') {
    return html`<div class="tv-stage">
      <h2 class="tv-big">Filling the bowl</h2>
      <div class="sb-bowl" aria-hidden="true"></div>
      <p class="waiting-line">${view.submitReadyCount} of ${view.totalPlayers} players ready</p>
    </div>`;
  }
  if (view.phase === 'turnEnd') return html`<div class="tv-stage">${recap(view, ui)}</div>${side}`;
  if (view.phase === 'ready') {
    return html`<div class="tv-stage">
      ${roundHeader(view, ui)}
      <div class="sb-up">${ui.avatar(view.active, shared ? 88 : 140)}</div>
      <h2 class="tv-big">${shared ? `Pass to ${ui.name(view.active)}` : `${ui.name(view.active)} is up next`}</h2>
      ${shared ? '' : html`<p class="lead-line">Get ready to guess</p>`}
      ${ui.deadlyNote(DEADLY_NOTE)}
      ${shared ? html`<button class="btn btn-primary btn-xl" data-act="start">Start the turn</button>` : ''}
    </div>${side}`;
  }
  // turn
  if (shared) return html`<div class="tv-stage">${view.card ? cardPanel(view, ui, true) : html`<h2>Dealing...</h2>`}</div>`;
  return html`<div class="tv-stage">${turnWatch(view, ui)}</div>${side}`;
}

// The one-line "what do I do right now" strip under the top bar on phones.
// Never quotes a phrase: only the performer's own screen shows the card.
const PERFORM = ['Describe it', 'One word only', 'Act it out, no talking'];
const WATCHING = ['is describing', 'is giving one-word clues', 'is acting'];

function waitingFor(ids, ui) {
  if (!ids.length) return 'Waiting for the others';
  if (ids.length > 3) return `Waiting for ${ids.length} more players`;
  const names = ids.map((id) => ui.name(id));
  return `Waiting for ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`}`;
}

export function now(view, ui) {
  const r = Math.max(0, Math.min(2, (view.round || 1) - 1));
  const shared = ui.surface === 'shared';
  if (view.phase === 'final') {
    return ui.isHost
      ? { text: 'Game over. Tap Standings or Play again', tone: 'act' }
      : { text: 'Game over. The host picks what is next', tone: 'wait' };
  }
  if (view.phase === 'turnEnd') {
    const last = view.lastTurn && view.lastTurn.roundDone && view.round >= view.roundsTotal;
    if (ui.isHost) return { text: last ? 'Tap See the results' : "Tap Next turn when you're ready", tone: 'act' };
    if (view.upNext && view.upNext === view.me) return { text: "You're up next. Get ready", tone: 'wait' };
    return { text: 'Turn over. The host starts the next one', tone: 'wait' };
  }
  if (shared) {
    if (view.phase === 'submit') return { text: 'Pass the phone round to fill the bowl', tone: 'act' };
    if (view.phase === 'ready') return { text: `Pass to ${ui.name(view.active)}, then tap Start`, tone: 'act' };
    if (view.phase === 'turn') return { text: `${PERFORM[r]}. Tap Got it when guessed`, tone: 'act' };
    return null;
  }
  if (!view.me) return { text: 'Watching. You join the next game', tone: 'watch' };
  switch (view.phase) {
    case 'submit': {
      if (!view.myDone) {
        const left = view.submitTarget - view.myCount;
        return { text: view.myCount ? `Write ${left} more for the bowl` : `Write ${left} names for the bowl`, tone: 'act' };
      }
      return { text: waitingFor(view.submitPending || [], ui), tone: 'wait' };
    }
    case 'ready':
      if (view.isActive) return { text: "Your turn. Tap Start when you're ready", tone: 'act' };
      return { text: `Waiting for ${ui.name(view.active)} to start`, tone: 'wait' };
    case 'turn':
      if (view.isActive) return { text: `${PERFORM[r]}. Tap Got it when guessed`, tone: 'act' };
      return { text: `Guess out loud: ${ui.name(view.active)} ${WATCHING[r]}`, tone: 'watch' };
    default:
      return null;
  }
}
