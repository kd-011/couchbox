// Most Likely To views. Pure functions of (view, ui) returning markup;
// buttons with data-act dispatch actions (see docs/GAME-MODULES.md).

// "Ben", "Ben and Cy", "Ben, Cy and Dee"; null past three names.
function nameList(ids, ui) {
  if (!ids.length || ids.length > 3) return null;
  const n = ids.map((id) => ui.name(id));
  const s = n.length === 1 ? n[0] : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
  return s.length > 30 ? null : s;
}

// "Votes close in 0:24": only once half the table is in (room only).
function voteClock(view, ui) {
  const { html } = ui;
  return view.timer ? html`<p class="waiting-line mlt-clock">Votes close in ${ui.countdown(view.timer)}</p>` : '';
}

function crownNote(view, ui) {
  if (!view.shotLive) return '';
  return ui.deadlyNote(ui.mode === 'pass' ? 'Crowned by the whole table: take a shot' : 'Every vote for one player: they take a shot');
}

function teamBoard(view, ui, board) {
  const { html } = ui;
  if (!board) return '';
  const byId = Object.fromEntries(view.teams.map((t) => [t.id, t]));
  const top = board.length ? board[0].score : 0;
  return html`<h3 class="sec">Teams</h3><ol class="scores">${board.map((r) => {
    const t = byId[r.id];
    return html`<li class="${r.score === top && top > 0 ? 'lead' : ''}">
      <span class="rank">${1 + board.filter((x) => x.score > r.score).length}</span>
      <span class="av" style="--c:${t.color};--s:32px" aria-hidden="true">${(t.name || '?').slice(0, 2).toUpperCase()}</span>
      <span class="nm">${t.name}</span><span class="pts">${r.score}</span></li>`;
  })}</ol>`;
}

function outcome(view, ui) {
  const { html } = ui;
  const r = view.result;
  const winners = r.winners || [];
  const votes = Object.entries(r.votes || {});
  const crownedTeam = r.crownedTeamId && view.teams ? view.teams.find((t) => t.id === r.crownedTeamId) : null;
  const headline = winners.length === 0
    ? 'No clear winner'
    : winners.length === 1
      ? `${ui.name(winners[0])} is crowned${crownedTeam ? `, unanimously: all of ${crownedTeam.name} drinks` : r.unanimous ? ', unanimously' : ''}`
      : `${winners.map((id) => ui.name(id)).join(' and ')} tie`;
  return html`<div class="mlt-result">
    <p class="mlt-prompt">${view.prompt}</p>
    <div class="mlt-crowned">
      ${winners.length
        ? winners.map((id) => html`<span class="mlt-hero"><span class="mlt-crown">${ui.icon('crown', winners.length > 1 ? 30 : 40)}</span>${ui.avatar(id, winners.length > 1 ? 72 : 96)}</span>`)
        : ''}
    </div>
    <h2 class="mlt-headline ${headline.length > 28 ? 'mlt-long' : ''}">${headline}</h2>
    ${votes.length ? html`<ul class="mlt-votes">${votes.map(([v, t]) => html`<li>${ui.avatar(v, 24)}<span>${ui.name(v)}</span>${ui.icon('back', 14)}<span class="${winners.includes(t) ? 'hit' : 'miss'}">${ui.name(t)}</span></li>`)}</ul>` : ''}
    ${ui.drinks(r.drinks)}
    <h3 class="sec">Crowns</h3>${ui.scores(view.scores)}
  </div>`;
}

function finalScreen(view, ui) {
  const { html } = ui;
  const board = (view.final && view.final.board) || view.scores;
  const top = board && board.length ? board[0] : null;
  return html`<div class="mlt-final">
    ${top && top.score > 0 ? html`<div class="mlt-hero"><span class="mlt-crown">${ui.icon('crown', 44)}</span>${ui.avatar(top.id, 104)}</div>` : ui.icon('crown', 36)}
    <h2 class="mlt-headline">${top && top.score > 0 ? `${ui.name(top.id)} wins the crown` : 'Game over'}</h2>
    <p class="mlt-sub">Most crowns after ${view.roundsTotal} round${view.roundsTotal === 1 ? '' : 's'}</p>
    ${ui.scores(board)}
    ${teamBoard(view, ui, view.final && view.final.teamBoard)}
  </div>`;
}

export function player(view, ui) {
  const { html } = ui;
  if (!view.me) {
    if (view.audience && view.phase === 'vote') {
      return html`<div class="tv-stage">
        <h2 class="q">From the crowd: ${view.prompt}</h2>
        <div class="pick-grid">
          ${view.players.map((id) => html`<button class="pick ${view.myVote === id ? 'on' : ''}" data-act="audienceVote" data-arg="${id}" aria-pressed="${view.myVote === id}">
            ${ui.avatar(id, 44)}<span>${ui.name(id)}</span></button>`)}
        </div>
        ${voteClock(view, ui)}
        <p class="waiting-line">${view.myVote ? html`${ui.icon('check', 18)} Pick in for ${ui.name(view.myVote)}. ` : ''}Just for you: ${ui.drinking ? 'pick wrong and you drink' : 'it never changes the result'}.</p>
      </div>`;
    }
    if (view.phase === 'reveal' && view.result) return html`${outcome(view, ui)}<p class="waiting-line">${ui.icon('users', 18)} ${view.audience ? 'Watching from the crowd' : 'You are in from the next round'}</p>`;
    if (view.phase === 'final') return finalScreen(view, ui);
    return html`<div class="state-card">
      ${ui.icon('users', 36)}
      <h2>You are in from the next round</h2>
      <p>Round ${view.round} is under way. Hang tight.</p>
    </div>`;
  }
  switch (view.phase) {
    case 'vote':
      return html`<div class="tv-stage">
        <h2 class="q">${view.prompt}</h2>
        <div class="pick-grid">
          ${view.players.filter((id) => id !== view.me).map((id) => html`<button class="pick ${view.myVote === id ? 'on' : ''}" data-act="vote" data-arg="${id}" aria-pressed="${view.myVote === id}">
            ${ui.avatar(id, 44)}<span>${ui.name(id)}</span></button>`)}
        </div>
        <div class="waiting-line">${view.myVote ? html`${ui.icon('check', 18)} Vote in for ${ui.name(view.myVote)}. ` : ''}${view.voted.length} of ${view.players.length} voted</div>
        ${voteClock(view, ui)}
        ${crownNote(view, ui)}
      </div>`;
    case 'reveal':
      return outcome(view, ui);
    case 'final':
      return finalScreen(view, ui);
    default:
      return '';
  }
}

export function tv(view, ui) {
  const { html } = ui;
  switch (view.phase) {
    case 'vote':
      if (ui.surface === 'shared') {
        return html`<div class="tv-stage">
          <h2 class="q">${view.prompt}</h2>
          <div class="pick-grid">
            ${view.players.map((id) => html`<button class="pick" data-act="accuse" data-arg="${id}" data-confirm="Crown ${ui.name(id)}?">${ui.avatar(id, 44)}<span>${ui.name(id)}</span></button>`)}
          </div>
          <button class="btn btn-secondary" data-act="accuse" data-payload="null" data-confirm="Nobody stood out this round?">No clear winner</button>
          ${crownNote(view, ui)}
        </div>`;
      }
      return html`<div class="tv-stage">
        <h2 class="tv-big">${view.prompt}</h2>
        <p class="tv-sub">Vote on your phone</p>
        ${ui.roster(view.players, { mark: view.voted })}
        ${voteClock(view, ui)}
        ${crownNote(view, ui)}
      </div>`;
    case 'reveal':
      return html`<div class="tv-stage tv-result">${outcome(view, ui)}</div>`;
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
  const last = view.round >= view.roundsTotal;
  if (view.phase === 'final') {
    return host ? { text: 'Game over. Play again or see the standings', tone: 'act' } : { text: 'Game over. Host picks what\'s next', tone: 'watch' };
  }
  if (view.phase === 'reveal') {
    if (host) return { text: last ? 'Tap See the results when you\'re ready' : 'Tap Next prompt when you\'re ready', tone: 'act' };
    if (!view.me && !view.audience) return { text: 'You\'re in from the next round', tone: 'wait' };
    return { text: last ? 'That was the last one. Results next' : 'Round over. Host reads the next one', tone: 'watch' };
  }
  // vote
  if (shared) return { text: 'Read it out, agree, then tap the winner', tone: 'act' };
  if (!view.me) {
    if (!view.audience) return { text: 'You\'re in from the next round', tone: 'wait' };
    return view.myVote ? { text: 'Pick in. Waiting for the players', tone: 'wait' } : { text: 'From the crowd: pick who fits it', tone: 'act' };
  }
  if (!view.myVote) return { text: view.timer ? 'Vote now, the rest are waiting on you' : 'Vote for who fits it best', tone: 'act' };
  const left = view.players.filter((id) => !view.voted.includes(id));
  if (!left.length) return { text: 'Vote in. Counting the votes', tone: 'wait' };
  const names = nameList(left, ui);
  return { text: names ? `Vote in. Waiting for ${names}` : `Vote in. Waiting for ${left.length} more votes`, tone: 'wait' };
}
