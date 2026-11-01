// Would You Rather views. See docs/GAME-MODULES.md for the contract.
// Room mode: each phone gets two big equal-weight buttons, A and B. Pass
// mode: the shared screen shows two columns of player chips the host taps
// to assign. Reveal: the split, who's on each side, and the outcome.

// "Ben", "Ben and Cy", "Ana, Ben and Cy".
function nameList(ids, ui) {
  const n = ids.map((id) => ui.name(id));
  return n.length < 2 ? n.join('') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

// Name who we're waiting on when it's 3 or fewer (and it fits), else count.
function waitLine(ids, ui, verb, noun, prefix = '') {
  const named = `${prefix}Waiting for ${nameList(ids, ui)} to ${verb}`;
  return ids.length <= 3 && named.length <= 48 ? named : `${prefix}Waiting for ${ids.length} more ${noun}`;
}

// Ask the platform for one confetti burst, once per key.
function confetti(ui, key) {
  return ui.raw(`data-fx="confetti" data-fx-key="${ui.esc(key)}"`);
}

function roundLabel(view) {
  return view.round >= view.rounds ? `Final round · ${view.round} of ${view.rounds}` : `Round ${view.round} of ${view.rounds}`;
}

// The one-line "what do I do now" strip the platform shows under the top
// bar on phones. Never called for the room TV.
export function now(view, ui) {
  const last = view.round >= view.rounds;
  if (view.phase === 'final') {
    return ui.isHost ? { text: 'Game over. Tap Play again for another', tone: 'act' } : { text: 'Game over. Check the final scores', tone: 'watch' };
  }
  if (view.phase === 'reveal') {
    if (ui.isHost) return { text: last ? 'Tap See the results when you are ready' : 'Tap Next round when you are ready', tone: 'act' };
    return { text: last ? 'Last round done. Host shows the results' : 'Round over. Host starts the next one', tone: 'watch' };
  }
  if (ui.surface === 'shared') {
    return view.pickedCount < view.total
      ? { text: 'Tap each player\'s side, A or B', tone: 'act' }
      : { text: 'Everyone has a side. Tap Reveal', tone: 'act' };
  }
  if (view.me) {
    if (!view.myPick) return { text: 'Pick a side: A or B', tone: 'act' };
    const others = (view.pending || []).filter((id) => id !== view.me);
    if (!others.length) return { text: 'Everyone has picked. Revealing now', tone: 'wait' };
    return { text: waitLine(others, ui, 'pick', 'picks', `You picked ${view.myPick.toUpperCase()}. `), tone: 'wait' };
  }
  if (view.audience) {
    return view.myPick
      ? { text: `You picked ${view.myPick.toUpperCase()}. Waiting for the players`, tone: 'wait' }
      : { text: 'Pick a side too, just for you', tone: 'act' };
  }
  return { text: 'You are in from the next round', tone: 'watch' };
}

// Deadly telegraph for the vote screens (3+ players, or it cannot happen).
function wolfNote(view, ui) {
  return view.total >= 3 ? ui.deadlyNote('Alone on your side: the lone wolf takes a shot') : '';
}

function voteButtons(view, ui, act = 'vote') {
  const { html } = ui;
  const p = view.myPick;
  return html`<div class="wyr-fork ${p ? 'wyr-picked' : ''}">
    <button class="wyr-opt ${p === 'a' ? 'on' : ''}" data-act="${act}" data-arg="a" aria-pressed="${p === 'a'}">
      <span class="wyr-letter">A</span><span class="wyr-text">${view.pair.a}</span>
    </button>
    <div class="wyr-or">or</div>
    <button class="wyr-opt ${p === 'b' ? 'on' : ''}" data-act="${act}" data-arg="b" aria-pressed="${p === 'b'}">
      <span class="wyr-letter">B</span><span class="wyr-text">${view.pair.b}</span>
    </button>
  </div>`;
}

function voteProgress(view, ui) {
  const { html } = ui;
  return html`<div class="wyr-fork">
    <div class="wyr-opt-static"><span class="wyr-letter">A</span><span class="wyr-text">${view.pair.a}</span></div>
    <div class="wyr-or">or</div>
    <div class="wyr-opt-static"><span class="wyr-letter">B</span><span class="wyr-text">${view.pair.b}</span></div>
  </div>
  <p class="waiting-line">${view.pickedCount} of ${view.total} ${view.pickedCount === 1 ? 'has' : 'have'} chosen</p>`;
}

function assignBoard(view, ui) {
  const { html } = ui;
  const col = (side) => html`<ul class="wyr-chips">${view.players.map((id) => html`<li><button class="wyr-chip ${view.picks[id] === side ? 'on' : ''}" data-act="assign" data-payload="${JSON.stringify({ playerId: id, side })}">${ui.avatar(id, 32)}<span>${ui.name(id)}</span></button></li>`)}</ul>`;
  return html`<div class="wyr-fork wyr-fork-assign">
    <div class="wyr-col wyr-col-a">
      <div class="wyr-opt-static"><span class="wyr-letter">A</span><span class="wyr-text">${view.pair.a}</span></div>
      ${col('a')}
    </div>
    <div class="wyr-or">or</div>
    <div class="wyr-col wyr-col-b">
      <div class="wyr-opt-static"><span class="wyr-letter">B</span><span class="wyr-text">${view.pair.b}</span></div>
      ${col('b')}
    </div>
  </div>
  <p class="waiting-line">${view.pickedCount} of ${view.total} assigned</p>`;
}

function teamBoard(view, ui, board) {
  const { html } = ui;
  if (!board) return '';
  const byId = Object.fromEntries(view.teams.map((t) => [t.id, t]));
  const top = board.length ? board[0].score : 0;
  return html`<h3 class="sec">Teams</h3><ol class="scores">${board.map((r) => {
    const t = byId[r.id];
    return html`<li class="${r.score === top && top > 0 ? 'lead' : ''} ${r.id === view.reveal?.wipedTeamId ? 'wyr-wiped' : ''}">
      <span class="rank">${1 + board.filter((x) => x.score > r.score).length}</span>
      <span class="av" style="--c:${t.color};--s:32px" aria-hidden="true">${(t.name || '?').slice(0, 2).toUpperCase()}</span>
      <span class="nm">${t.name}</span><span class="pts">${r.score}</span></li>`;
  })}</ol>`;
}

function revealScreen(view, ui) {
  const { html } = ui;
  const r = view.reveal;
  const total = r.a.length + r.b.length;
  const pct = (n) => (total ? Math.round((n / total) * 100) : 0);
  const sideClass = (side) => (r.majority === side ? ' wyr-majority' : r.minority === side ? ' wyr-minority' : '');
  const col = (side, list) => html`<div class="wyr-col wyr-col-${side}${sideClass(side)}">
    <div class="wyr-res" style="--pct:${pct(list.length)}%">
      <span class="wyr-letter">${side.toUpperCase()}</span><span class="wyr-text">${view.pair[side]}</span>
      <span class="wyr-count">${list.length}<small>${pct(list.length)}%</small></span>
    </div>
    ${list.length ? ui.roster(list, { size: 30, mark: list }) : html`<p class="wyr-nobody">Nobody</p>`}
  </div>`;
  const team = r.wipedTeamId && view.teams ? view.teams.find((t) => t.id === r.wipedTeamId) : null;
  const headline = team ? `${team.name} picked the minority as one`
    : r.loneWolf ? `${ui.name(r.loneWolf)} is the lone wolf`
      : r.majority ? `The room picked ${r.majority.toUpperCase()}`
        : 'Dead even';
  return html`<div class="tv-stage wyr-stage">
    <p class="tv-sub">${roundLabel(view)}</p>
    <h2 class="wyr-verdict ${r.loneWolf || team ? 'is-wolf' : ''}">${headline}</h2>
    ${team ? html`<p class="tv-sub">Every member takes a shot.</p>` : ''}
    <div class="wyr-fork wyr-fork-reveal">
      ${col('a', r.a)}
      <div class="wyr-or">vs</div>
      ${col('b', r.b)}
    </div>
    ${ui.drinking
    ? (r.drinks.length ? ui.drinks(r.drinks) : html`<p class="waiting-line">${ui.icon('check', 16)} Nobody drinks this round.</p>`)
    : ''}
    <h3 class="sec">Scores</h3>${ui.scores(view.scores)}
  </div>`;
}

function finalScreen(view, ui) {
  const { html } = ui;
  const roundsPlayed = html`${view.round} round${view.round === 1 ? '' : 's'} played.`;
  const board = view.final.board || [];
  const best = board.length ? board[0].score : 0;
  const tops = board.filter((r) => r.score === best);
  const headline = best === 0
    ? 'No clear crowd-pleaser'
    : tops.length === 1
      ? `${ui.name(tops[0].id)} ran with the crowd the most`
      : tops.length === board.length
        ? 'Dead heat'
        : `${tops.map((r) => ui.name(r.id)).join(' and ')} tie for it`;
  return html`<div class="tv-stage wyr-stage">
    ${best > 0 && tops.length < board.length ? html`<div class="wyr-winners">${tops.map((r) => ui.avatar(r.id, 76))}</div>` : ''}
    <h2 class="wyr-final-head" ${best > 0 ? confetti(ui, `wyr-final-${view.gameKey}`) : ''}>${headline}</h2>
    <p class="tv-sub">${roundsPlayed}</p>
    ${ui.scores(board)}
    ${teamBoard(view, ui, view.final.teamBoard)}
  </div>`;
}

export function player(view, ui) {
  const { html } = ui;
  if (view.phase === 'reveal') return revealScreen(view, ui);
  if (view.phase === 'final') return finalScreen(view, ui);
  if (!view.me) {
    if (view.audience) {
      return html`<div class="tv-stage wyr-stage">
        <p class="tv-sub">${ui.icon('users', 16)} From the crowd · ${roundLabel(view)}</p>
        <h2 class="q">Would you rather...</h2>
        ${voteButtons(view, ui, 'audienceVote')}
        ${ui.drinking ? html`<p class="tv-sub">Side with the minority and you drink 1.</p>` : ''}
      </div>`;
    }
    return html`<div class="state-card">${ui.icon('users', 36)}<h2>You are in from the next round</h2><p>Round ${view.round} is under way. Watch the split, then you get a side too.</p></div>`;
  }
  return html`<div class="tv-stage wyr-stage">
    <p class="tv-sub">${roundLabel(view)}</p>
    <h2 class="q">Would you rather...</h2>
    ${voteButtons(view, ui)}
    <p class="waiting-line">${view.myPick ? ui.icon('check', 16) : ''} ${view.pickedCount} of ${view.total} ${view.pickedCount === 1 ? 'has' : 'have'} chosen</p>
    ${wolfNote(view, ui)}
  </div>`;
}

export function tv(view, ui) {
  const { html } = ui;
  if (view.phase === 'reveal') return revealScreen(view, ui);
  if (view.phase === 'final') return finalScreen(view, ui);
  if (ui.mode === 'pass') {
    return html`<div class="tv-stage wyr-stage">
      <p class="tv-sub">${roundLabel(view)}</p>
      <h2 class="q">Would you rather...</h2>
      ${assignBoard(view, ui)}
      ${wolfNote(view, ui)}
    </div>`;
  }
  return html`<div class="tv-stage wyr-stage">
    <p class="tv-sub">${roundLabel(view)}</p>
    <h2 class="q">Would you rather...</h2>
    ${voteProgress(view, ui)}
    ${wolfNote(view, ui)}
  </div>`;
}
