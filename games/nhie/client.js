// Never Have I Ever views. See docs/GAME-MODULES.md for the contract.

// "Ben", "Ben and Cy", "Ben, Cy and Dee"; null past three names.
function nameList(ids, ui) {
  if (!ids.length || ids.length > 3) return null;
  const n = ids.map((id) => ui.name(id));
  const s = n.length === 1 ? n[0] : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
  return s.length > 30 ? null : s;
}

function roundLabel(view) {
  return `Round ${view.round} of ${view.rounds}`;
}

// Deadly telegraph for the prompt screen (3+ players, or it cannot happen).
function lonelyNote(view, ui) {
  return view.players.length >= 3 ? ui.deadlyNote('The only one who has takes a shot') : '';
}

function haveButtons(view, ui) {
  const { html } = ui;
  return html`<div class="pick-grid nhie-choices">
    <button class="pick ${view.myVote === true ? 'on' : ''}" data-act="vote" data-payload='${JSON.stringify({ promptId: view.promptId, has: true })}' aria-pressed="${view.myVote === true}">
      ${ui.icon('check', 24)}<span>I have</span>
    </button>
    <button class="pick ${view.myVote === false ? 'on' : ''}" data-act="vote" data-payload='${JSON.stringify({ promptId: view.promptId, has: false })}' aria-pressed="${view.myVote === false}">
      ${ui.icon('minus', 24)}<span>I haven’t</span>
    </button>
  </div>`;
}

function passChips(view, ui) {
  const { html } = ui;
  return html`<div class="pick-grid">
    ${view.players.map((id) => html`<button class="pick ${view.passHas.includes(id) ? 'on' : ''}" data-act="markPass" data-payload='${JSON.stringify({ promptId: view.promptId, playerId: id })}' aria-pressed="${view.passHas.includes(id)}">
      ${ui.avatar(id, 44)}<span>${ui.name(id)}</span>
    </button>`)}
  </div>`;
}

function roundResult(view, ui) {
  const { html } = ui;
  const r = view.result;
  const n = r.hasIds.length;
  return html`<div class="nhie-reveal">
    <p class="nhie-prompt-sm">Never have I ever ${view.prompt}</p>
    <div class="nhie-count ${n === 0 ? 'none' : ''}"><strong>${n === 0 ? 'Nobody' : n === view.players.length ? 'Everyone' : n}</strong><span>${n === 0 ? 'has done it' : n === view.players.length ? 'has done it' : `of ${view.players.length} have`}</span></div>
    ${ui.roster(view.players, { mark: r.hasIds, size: 40 })}
    ${r.lonely ? html`<p class="pill pill-deadly nhie-lonely">Lonely confession</p>` : ''}
    ${ui.drinks(r.drinks)}
    ${view.scores && ui.surface !== 'tv' ? html`<h3 class="sec">Confessions</h3>${ui.scores(view.scores)}` : ''}
  </div>`;
}

function finalScreen(view, ui) {
  const { html } = ui;
  const board = view.final.board;
  const top = board.length ? board[0] : null;
  const headline = !top || top.score === 0 ? 'Squeaky clean, the lot of you' : `${ui.name(top.id)} has lived the wildest`;
  return html`<div class="nhie-final">
    ${top && top.score > 0 ? html`<div class="nhie-champ">${ui.avatar(top.id, 96)}<span>${top.score} confession${top.score === 1 ? '' : 's'}</span></div>` : ''}
    <h2 class="nhie-headline">${headline}</h2>
    ${ui.scores(board)}
    ${ui.drinks(view.final.drinks)}
  </div>`;
}

export function player(view, ui) {
  const { html } = ui;
  if (view.phase === 'final') return finalScreen(view, ui);
  if (!view.me) {
    if (view.phase === 'reveal' && view.result) return html`${roundResult(view, ui)}<p class="waiting-line">${ui.icon('users', 18)} You’re in from the next round</p>`;
    return html`<div class="state-card">${ui.icon('eyeOff', 36)}<h2>Watching this one</h2><p>You’re in from the next round.</p></div>`;
  }
  if (view.phase === 'reveal') return roundResult(view, ui);
  // phase === 'prompt', room mode only (pass mode has no private screen)
  return html`<div class="tv-stage nhie-stage">
    <p class="tv-sub">${roundLabel(view)}</p>
    <h2 class="q nhie-prompt"><span class="nhie-kicker">Never have I ever</span> ${view.prompt}</h2>
    ${haveButtons(view, ui)}
    ${lonelyNote(view, ui)}
    <p class="waiting-line">${view.myVote !== null && view.myVote !== undefined ? html`${ui.icon('check', 18)} Answer in. ` : ''}${view.answered.length} of ${view.players.length} answered</p>
  </div>`;
}

export function tv(view, ui) {
  const { html } = ui;
  // The TV hides an all-zero board, so the heading goes with it.
  const scores = view.scores && ui.surface === 'tv' && view.scores.some((r) => r.score > 0) ? html`<aside class="tv-side"><h3 class="sec">Confessions</h3>${ui.scores(view.scores, { limit: 8 })}</aside>` : '';
  switch (view.phase) {
    case 'prompt':
      if (ui.surface === 'shared') {
        return html`<div class="tv-stage nhie-stage">
          <p class="tv-sub">${roundLabel(view)}</p>
          <h2 class="q nhie-prompt"><span class="nhie-kicker">Never have I ever</span> ${view.prompt}</h2>
          ${passChips(view, ui)}
          <p class="waiting-line">${view.passHas.length ? `${view.passHas.length} marked. Tap Reveal when done` : 'Nobody marked yet. Tap Reveal if nobody has'}</p>
          ${lonelyNote(view, ui)}
        </div>`;
      }
      return html`<div class="tv-stage nhie-stage">
        <p class="tv-sub">${roundLabel(view)}</p>
        <h2 class="q nhie-prompt"><span class="nhie-kicker">Never have I ever</span> ${view.prompt}</h2>
        <p class="lead-line big">Answer on your phone</p>
        ${ui.roster(view.players, { mark: view.answered })}
        ${lonelyNote(view, ui)}
      </div>${scores}`;
    case 'reveal':
      return html`<div class="tv-stage">${roundResult(view, ui)}</div>${scores}`;
    case 'final':
      return html`<div class="tv-stage">${finalScreen(view, ui)}</div>`;
    default:
      return '';
  }
}

// The one-line "what do I do now" strip under the top bar on phones.
export function now(view, ui) {
  const shared = ui.surface === 'shared';
  const host = shared || ui.isHost;
  const last = view.round >= view.rounds;
  if (view.phase === 'final') {
    return host ? { text: 'Game over. Play again or see the standings', tone: 'act' } : { text: 'Game over. Host picks what\'s next', tone: 'watch' };
  }
  if (view.phase === 'reveal') {
    if (host) return { text: last ? 'Tap See the results when you\'re ready' : 'Tap Next prompt when you\'re ready', tone: 'act' };
    if (!view.me) return { text: 'You\'re in from the next round', tone: 'wait' };
    return { text: last ? 'That was the last one. Results next' : 'See who has. Host reads the next one', tone: 'watch' };
  }
  // prompt
  if (shared) return { text: 'Read it out. Tap everyone who has done it', tone: 'act' };
  if (!view.me) return { text: 'You\'re in from the next round', tone: 'wait' };
  if (view.myVote === null || view.myVote === undefined) return { text: 'Tap I have or I haven\'t. Nobody sees it', tone: 'act' };
  const left = view.players.filter((id) => !view.answered.includes(id));
  if (!left.length) return { text: 'Answer in. Revealing now', tone: 'wait' };
  const names = nameList(left, ui);
  return { text: names ? `Answer in. Waiting for ${names}` : `Answer in. Waiting for ${left.length} more`, tone: 'wait' };
}
