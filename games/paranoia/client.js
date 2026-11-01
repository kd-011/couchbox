// Paranoia views. Pure functions of (view, ui) returning markup; buttons
// with data-act dispatch actions (see docs/GAME-MODULES.md).

function outcome(view, ui) {
  const { html } = ui;
  const r = view.result;
  return html`<div class="pn-result">
    <div class="pn-coin ${r.revealed ? 'is-heads' : 'is-tails'}" aria-hidden="true">
      <span class="pn-coin-face pn-heads">${ui.icon('eye', 44)}</span>
      <span class="pn-coin-face pn-tails">${ui.icon('eyeOff', 44)}</span>
    </div>
    <h2 class="pn-headline ${r.revealed ? 'is-revealed' : 'is-kept'}">${r.revealed ? 'Revealed' : 'Stays a secret'}</h2>
    <div class="pn-named">${ui.avatar(r.namedId, 52)}<p><span>${ui.name(r.targetId)} named</span><strong>${ui.name(r.namedId)}</strong></p></div>
    ${r.revealed
      ? html`<div class="pn-reveal"><span>The question was</span><strong>${r.question}</strong></div>`
      : html`<p class="pn-mystery">Tails. Nobody finds out what ${ui.name(view.askerId)} asked.${view.isAsker ? html` <span class="pn-wink">Except you.</span>` : ''}</p>`}
    ${ui.drinks(r.drinks)}
    ${view.scores ? html`<h3 class="sec" ${view.over ? html`data-fx="confetti" data-fx-key="pn-over-${view.round}-${view.scores.map((x) => `${x.id}.${x.score}`).join('-')}"` : ''}>${view.over ? `Final scores after ${view.round} rounds` : `Scores after round ${view.round} of ${view.rounds}`}</h3>${ui.scores(view.scores)}` : ''}
  </div>`;
}

// The Asker still has the question in their own view after hiding it, so
// they can re-read it before whispering (a room only; on one phone the
// shared screen never carries it).
function questionPeek(view, ui) {
  const { html } = ui;
  if (!view.question) return '';
  return html`<details class="pn-peek"><summary>${ui.icon('eye', 16)} Show the question again</summary><p>${view.question}</p></details>`;
}

// The Asker leaning in to the Target: two faces and a whisper between them.
function pair(view, ui) {
  const { html } = ui;
  return html`<div class="pn-pair" aria-hidden="true">${ui.avatar(view.askerId, 72)}<span class="pn-whisper"><i></i><i></i><i></i></span>${ui.avatar(view.targetId, 72)}</div>`;
}

function targetGrid(view, ui, type, label) {
  const { html } = ui;
  const pool = type === 'chooseTarget' ? view.players.filter((id) => id !== view.askerId) : view.players;
  return html`<div class="pn-stage">
    <h2 class="pn-q">${label}</h2>
    ${questionPeek(view, ui)}
    <div class="pick-grid">
      ${pool.map((id) => html`<button class="pick" data-act="${type}" data-arg="${id}">${ui.avatar(id, 44)}<span>${ui.name(id)}</span></button>`)}
    </div>
    ${type === 'recordAnswer' ? ui.deadlyNote('If the coin reveals it, the named player takes a shot') : ''}
  </div>`;
}

export function player(view, ui) {
  const { html } = ui;
  if (!view.me) {
    return html`<div class="state-card">
      ${ui.icon('users', 36)}
      <h2>You're in from the next round</h2>
      <p>Round ${view.round} is under way. Hang tight.</p>
    </div>`;
  }
  switch (view.phase) {
    case 'ask':
      if (view.isAsker) {
        return html`<div class="pn-stage">
          <div class="pn-note">
            <span class="pn-note-label">${ui.icon('eyeOff', 16)} Read this, then hide it</span>
            <p class="pn-question">${view.question}</p>
          </div>
          <button class="btn btn-primary btn-xl" data-act="read">Got it, hide this</button>
        </div>`;
      }
      return html`<div class="pn-stage">
        <div class="pn-envelope" aria-hidden="true">${ui.icon('eyeOff', 40)}</div>
        <h2 class="pn-q">${ui.name(view.askerId)} is reading a secret question</h2>
      </div>`;
    case 'target':
      if (view.isAsker) return targetGrid(view, ui, 'chooseTarget', 'Who are you about to ask?');
      return html`<div class="pn-stage">
        <div class="pn-envelope" aria-hidden="true">${ui.icon('eyeOff', 40)}</div>
        <h2 class="pn-q">${ui.name(view.askerId)} is picking someone to ask</h2>
      </div>`;
    case 'answer':
      if (view.isAsker) return targetGrid(view, ui, 'recordAnswer', `Who did ${ui.name(view.targetId)} name?`);
      if (view.me === view.targetId) {
        return html`<div class="pn-stage">
          ${pair(view, ui)}
          <h2 class="pn-q">${ui.name(view.askerId)} is asking you</h2>
          ${ui.deadlyNote('If the coin reveals it, the named player takes a shot')}
        </div>`;
      }
      return html`<div class="pn-stage">
        ${pair(view, ui)}
        <h2 class="pn-q">${ui.name(view.askerId)} asked ${ui.name(view.targetId)}</h2>
        ${ui.deadlyNote('If the coin reveals it, the named player takes a shot')}
      </div>`;
    case 'result':
      return outcome(view, ui);
    default:
      return '';
  }
}

export function tv(view, ui) {
  const { html } = ui;
  switch (view.phase) {
    case 'ask':
      return html`<div class="tv-stage">
        <div class="pn-envelope" aria-hidden="true">${ui.icon('eyeOff', 56)}</div>
        <h2 class="tv-big">${ui.name(view.askerId)} is reading a secret question</h2>
        <p class="tv-sub">Round ${view.round} of ${view.rounds}</p>
      </div>`;
    case 'target':
      if (ui.surface === 'shared') return targetGrid(view, ui, 'chooseTarget', `Who are you about to ask, ${ui.name(view.askerId)}?`);
      return html`<div class="tv-stage">
        <div class="pn-envelope" aria-hidden="true">${ui.icon('eyeOff', 56)}</div>
        <h2 class="tv-big">${ui.name(view.askerId)} is picking who to ask</h2>
        <p class="tv-sub">Round ${view.round} of ${view.rounds}</p>
      </div>`;
    case 'answer':
      if (ui.surface === 'shared') return targetGrid(view, ui, 'recordAnswer', `Who did ${ui.name(view.targetId)} name?`);
      return html`<div class="tv-stage">
        ${pair(view, ui)}
        <h2 class="tv-big">${ui.name(view.askerId)} asked ${ui.name(view.targetId)}</h2>
        <p class="tv-sub">Listen for the name said out loud</p>
        ${ui.deadlyNote('If the coin reveals it, the named player takes a shot')}
      </div>`;
    case 'result':
      return html`<div class="tv-stage tv-result">${outcome(view, ui)}</div>`;
    default:
      return '';
  }
}

// The one-line "what do I do right now" strip under the top bar on phones.
// Never quotes the question: only the Asker's own screen carries it.
export function now(view, ui) {
  const asker = ui.name(view.askerId);
  const target = ui.name(view.targetId);
  if (view.phase === 'result') {
    if (ui.isHost) return { text: view.over ? 'Game over. Tap Standings when ready' : "Tap Next round when you're ready", tone: 'act' };
    return { text: view.over ? 'Game over. The host shows the standings' : 'Round over. The host starts the next one', tone: 'wait' };
  }
  if (ui.surface === 'shared') {
    if (view.phase === 'ask') return { text: `Pass the phone to ${asker}`, tone: 'act' };
    if (view.phase === 'target') return { text: `${asker}: tap who you will ask`, tone: 'act' };
    if (view.phase === 'answer') return { text: `Tap the name ${target} says out loud`, tone: 'act' };
    return null;
  }
  if (!view.me) return { text: "Watching. You're in from next round", tone: 'watch' };
  switch (view.phase) {
    case 'ask':
      if (view.isAsker) return { text: 'Read the question, then tap Got it', tone: 'act' };
      return { text: `Waiting for ${asker} to read`, tone: 'wait' };
    case 'target':
      if (view.isAsker) return { text: 'Pick who to whisper the question to', tone: 'act' };
      return { text: `Waiting for ${asker} to pick someone`, tone: 'wait' };
    case 'answer':
      if (view.isAsker) return { text: `Tap the name ${target} says out loud`, tone: 'act' };
      if (view.me === view.targetId) return { text: 'Listen, then say one name out loud', tone: 'act' };
      return { text: `Listen: ${target} names someone out loud`, tone: 'watch' };
    default:
      return null;
  }
}
