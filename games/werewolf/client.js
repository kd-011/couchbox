// Werewolf views. Pure functions of (view, ui) returning markup. The host
// bar (pause/vote-now/next-night/play-again/etc.) is rendered by the
// platform from hostActions(); this file only ever draws the stage content.

const ROLE_LABEL = { werewolf: 'Werewolf', seer: 'Seer', doctor: 'Doctor', villager: 'Villager' };
const ROLE_LINE = {
  werewolf: 'You hunt by night. Blend in by day.',
  seer: 'Each night you may learn one truth.',
  doctor: 'Each night you may save one life.',
  villager: 'You have no power but your voice and your vote.',
};

const LYNCH_NOTE = 'The lynched take a shot';

// "Ben", "Ben and Cy", "Ana, Ben and Cy".
function nameList(ids, ui) {
  const n = ids.map((id) => ui.name(id));
  return n.length < 2 ? n.join('') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

// Ask the platform for one confetti burst, once per key.
function confetti(ui, key) {
  return ui.raw(`data-fx="confetti" data-fx-key="${ui.esc(key)}"`);
}

// The one-line "what do I do now" strip the platform shows under the top
// bar on phones. Never called for the room TV. It only ever says what this
// screen already shows: at night everyone with nothing (left) to do gets
// the very same line, whatever their role, so a glance at the strip tells a
// neighbour nothing.
export function now(view, ui) {
  const host = ui.isHost;
  if (view.phase === 'final') {
    return host ? { text: 'Game over. Tap Play again for another', tone: 'act' } : { text: 'Game over. Every role is revealed', tone: 'watch' };
  }
  const decided = !!view.winner;
  if (ui.surface === 'shared') {
    switch (view.phase) {
      case 'night': return { text: 'Eyes closed. Night is falling', tone: 'watch' };
      case 'day': return { text: decided ? 'Tap Reveal the ending' : 'Read it out, then tap Wake the village', tone: 'act' };
      case 'discuss': return { text: 'Argue it out. Tap Vote now when ready', tone: 'act' };
      case 'vote': return { text: 'Vote out loud, then tap who is out', tone: 'act' };
      case 'result': return { text: decided ? 'Tap Reveal the ending' : 'Tap Night falls again when ready', tone: 'act' };
      default: return null;
    }
  }
  if (!view.me) return { text: 'You are in from the next game', tone: 'watch' };
  const ghost = !view.aliveMe;
  if (view.phase === 'night') {
    if (ghost) return { text: 'You are a ghost. Watch quietly', tone: 'watch' };
    if (view.myRole === 'werewolf' && !view.myPick) return { text: "Pick tonight's kill", tone: 'act' };
    if (view.myRole === 'seer' && view.myPick == null) return { text: 'Pick one player to see their role', tone: 'act' };
    if (view.myRole === 'doctor' && view.myPick == null) return { text: 'Pick one player to protect tonight', tone: 'act' };
    return { text: 'Eyes closed. Wait for dawn', tone: 'wait' };
  }
  if (view.phase === 'day') {
    if (host) return { text: decided ? 'Tap Reveal the ending' : 'Read out the night, then tap Wake the village', tone: 'act' };
    if (decided) return { text: 'Game decided. Host reveals the ending', tone: 'watch' };
    if (view.lastNightResult && view.lastNightResult.diedId === view.me) return { text: 'You died in the night. You are a ghost now', tone: 'watch' };
    return { text: 'Dawn. Look up, the host wakes the village', tone: 'watch' };
  }
  if (view.phase === 'discuss') {
    if (host) return { text: 'Argue it out. Tap Vote now when ready', tone: 'act' };
    return ghost ? { text: 'You are a ghost. Listen, say nothing', tone: 'watch' } : { text: 'Argue it out. Who is a wolf?', tone: 'watch' };
  }
  if (view.phase === 'vote') {
    if (ghost) return { text: 'You are a ghost. The living are voting', tone: 'watch' };
    if (!view.myVote) return { text: 'Vote for who to lynch', tone: 'act' };
    const left = view.alive.filter((id) => id !== view.me && !view.voted.includes(id));
    if (!left.length) return { text: 'All votes in. Counting now', tone: 'wait' };
    const named = `Waiting for ${nameList(left, ui)} to vote`;
    return { text: left.length <= 3 && named.length <= 48 ? named : `Waiting for ${left.length} more votes`, tone: 'wait' };
  }
  if (view.phase === 'result') {
    if (host) return { text: decided ? 'Tap Reveal the ending' : 'Tap Night falls again when ready', tone: 'act' };
    if (decided) return { text: 'Game decided. Host reveals the ending', tone: 'watch' };
    if (view.result && view.result.lynchedId === view.me) return { text: 'You were lynched. You are a ghost now', tone: 'watch' };
    return { text: 'Night falls again soon. Get ready', tone: 'watch' };
  }
  return null;
}

function ghostLine(view, ui) {
  return view.aliveMe ? '' : ui.html`<p class="ww-ghost">${ui.icon('eye', 16)}<span>You are a ghost. You see everything, but the living cannot hear you.</span></p>`;
}

function roleCard(view, ui) {
  const { html } = ui;
  return html`<div class="ww-role ww-role-${view.myRole}">
    <span class="ww-role-tag">You are the</span>
    <strong class="ww-role-name">${ROLE_LABEL[view.myRole]}</strong>
    <span class="ww-role-line">${ROLE_LINE[view.myRole]}</span>
  </div>`;
}

function targetGrid(ids, ui, act, myPick) {
  const { html } = ui;
  return html`<div class="pick-grid">
    ${ids.map((id) => html`<button class="pick ${myPick === id ? 'on' : ''}" data-act="${act}" data-arg="${id}" aria-pressed="${myPick === id}">
      ${ui.avatar(id, 44)}<span>${ui.name(id)}</span>
    </button>`)}
  </div>`;
}

function nightScreen(view, ui) {
  const { html } = ui;
  if (!view.aliveMe) {
    return html`<div class="ww-stage ww-night">
      ${ghostLine(view, ui)}
      <h2 class="q">The village sleeps.</h2>
      <p class="waiting-line">Something is moving out there. Watch quietly. ${ui.countdown(view.timer)}</p>
    </div>`;
  }
  if (view.myRole === 'werewolf') {
    const targets = view.alive.filter((id) => !view.pack.ids.includes(id));
    const packLines = view.pack.ids.filter((id) => id !== view.me).map((id) => html`<li>${ui.avatar(id, 24)}<span>${ui.name(id)}</span>${ui.icon('back', 14)}<span>${view.pack.picks[id] ? ui.name(view.pack.picks[id]) : 'still deciding'}</span></li>`);
    return html`<div class="ww-stage ww-night">
      ${roleCard(view, ui)}
      <h2 class="q">Choose tonight's kill</h2>
      ${targetGrid(targets, ui, 'nightKill', view.myPick)}
      ${view.pack.ids.length > 1 ? html`<div class="ww-pack"><h3 class="sec">Your pack</h3><ul class="ww-pack-list">${packLines}</ul></div>` : ''}
      <p class="waiting-line">${view.myPick ? `Set on ${ui.name(view.myPick)}. Tap another to switch.` : ''} ${ui.countdown(view.timer)}</p>
    </div>`;
  }
  if (view.myRole === 'seer' && view.myPick == null) {
    const targets = view.alive.filter((id) => id !== view.me);
    return html`<div class="ww-stage ww-night">
      ${roleCard(view, ui)}
      <h2 class="q">Peer into one soul</h2>
      ${targetGrid(targets, ui, 'seerCheck', view.myPick)}
      <p class="waiting-line">One look only. ${ui.countdown(view.timer)}</p>
    </div>`;
  }
  if (view.myRole === 'seer') {
    const seen = view.seerHistory[view.round];
    return html`<div class="ww-stage ww-night">
      ${roleCard(view, ui)}
      <div class="ww-reveal">
        <span>The truth about ${ui.name(seen.targetId)}</span>
        <strong>${ROLE_LABEL[seen.role]}</strong>
      </div>
      <p class="waiting-line">${ui.icon('check', 18)} Keep it to yourself. ${ui.countdown(view.timer)}</p>
    </div>`;
  }
  if (view.myRole === 'doctor' && view.myPick == null) {
    return html`<div class="ww-stage ww-night">
      ${roleCard(view, ui)}
      <h2 class="q">Who do you protect tonight?</h2>
      ${targetGrid(view.alive, ui, 'doctorSave', view.myPick)}
      <p class="waiting-line">You won't be told if it mattered. ${ui.countdown(view.timer)}</p>
    </div>`;
  }
  if (view.myRole === 'doctor') {
    return html`<div class="ww-stage ww-night">
      ${roleCard(view, ui)}
      <p class="waiting-line">${ui.icon('check', 18)} You're watching over ${ui.name(view.myPick)} tonight. ${ui.countdown(view.timer)}</p>
    </div>`;
  }
  return html`<div class="ww-stage ww-night">
    ${roleCard(view, ui)}
    <h2 class="q">The village sleeps</h2>
    <p class="waiting-line">${ui.countdown(view.timer)}</p>
  </div>`;
}

function dayHeadline(view) {
  const n = view.lastNightResult;
  if (!n || !n.diedId) return { title: 'Nobody died in the night.', sub: 'Everyone survived to see the dawn, this time.' };
  return { title: 'Found at first light', sub: null, diedId: n.diedId, diedRole: n.diedRole };
}

function dayScreen(view, ui) {
  const { html } = ui;
  const d = dayHeadline(view);
  return html`<div class="ww-stage ww-day ww-dawn">
    ${ghostLine(view, ui)}
    <h2 class="q">${d.title}</h2>
    ${d.diedId
      ? html`<div class="ww-reveal ww-reveal-death">
          <span>${ui.avatar(d.diedId, 40)} ${ui.name(d.diedId)} was the</span>
          <strong>${ROLE_LABEL[d.diedRole]}</strong>
        </div>`
      : html`<p class="waiting-line">${d.sub}</p>`}
    ${view.winner
    ? html`<p class="ww-winner-teaser">${view.winner === 'village' ? 'The village has' : 'The werewolves have'} won. ${ui.isHost ? 'Tap Reveal the ending.' : 'The host will reveal everything.'}</p>`
    : ''}
  </div>`;
}

function discussScreen(view, ui) {
  const { html } = ui;
  return html`<div class="ww-stage ww-day">
    ${ghostLine(view, ui)}
    ${ui.countdown(view.timer, { ring: true, size: 200 })}
    <h2 class="ww-count">${view.werewolfCount} wolf${view.werewolfCount === 1 ? '' : 'ves'} in this circle</h2>
    ${ui.deadlyNote(LYNCH_NOTE)}
  </div>`;
}

function voteScreen(view, ui) {
  const { html } = ui;
  if (!view.aliveMe) {
    return html`<div class="ww-stage ww-day">
      ${ghostLine(view, ui)}
      <h2 class="q">The living are voting</h2>
      <p class="waiting-line">${view.voted.length} of ${view.alive.length} votes in.</p>
      ${ui.deadlyNote(LYNCH_NOTE)}
    </div>`;
  }
  const targets = view.alive.filter((id) => id !== view.me);
  return html`<div class="ww-stage ww-day">
    <h2 class="q">Who do you lynch?</h2>
    ${targetGrid(targets, ui, 'vote', view.myVote)}
    <p class="waiting-line">${view.myVote ? ui.icon('check', 16) : ''} ${view.voted.length} of ${view.alive.length} voted</p>
    ${ui.deadlyNote(LYNCH_NOTE)}
  </div>`;
}

function outcome(view, ui) {
  const { html } = ui;
  const r = view.result;
  if (!r) return '';
  return html`<div class="ww-stage ww-day">
    ${ghostLine(view, ui)}
    <h2 class="q">${r.lynchedId ? `${ui.name(r.lynchedId)} was lynched` : 'The vote was split. Nobody was lynched.'}</h2>
    ${r.lynchedId ? html`<div class="ww-reveal"><span>They were the</span><strong>${ROLE_LABEL[r.lynchedRole]}</strong></div>` : ''}
    ${ui.drinks(r.drinks)}
    ${view.winner
      ? html`<p class="ww-winner-teaser">${view.winner === 'village' ? 'The village has' : 'The werewolves have'} won.</p>`
      : ''}
  </div>`;
}

function finalScreen(view, ui) {
  const { html } = ui;
  const f = view.final;
  if (!f) return '';
  const villageWon = f.winner === 'village';
  const rolesList = Object.entries(f.roles).sort((a, b) => (a[1] === 'werewolf' ? -1 : 1) - (b[1] === 'werewolf' ? -1 : 1));
  return html`<div class="ww-stage ww-final">
    <h2 class="ww-headline ${villageWon ? 'win' : 'lose'}" ${confetti(ui, `ww-final-${view.gameKey}`)}>${villageWon ? 'The village wins' : 'The werewolves win'}</h2>
    <p class="ww-sub">${villageWon ? 'Every wolf has been found and driven out.' : 'The pack now outnumbers everyone left standing.'}</p>
    <ul class="ww-finalroles">
      ${rolesList.map(([id, role]) => html`<li class="${f.alive.includes(id) ? 'alive' : 'dead'} ${role === 'werewolf' ? 'wolf' : ''}">${ui.avatar(id, 32)}<span>${ui.name(id)}</span><b>${ROLE_LABEL[role]}</b></li>`)}
    </ul>
    ${ui.drinks(f.drinks)}
    ${view.scores ? html`<h3 class="sec">Scores</h3>${ui.scores(view.scores)}` : ''}
  </div>`;
}

export function player(view, ui) {
  const { html } = ui;
  if (!view.me) {
    return html`<div class="state-card">
      ${ui.icon('users', 36)}
      <h2>You are in from the next game</h2>
      <p>This one is already under way. Hang tight.</p>
    </div>`;
  }
  switch (view.phase) {
    case 'night': return nightScreen(view, ui);
    case 'day': return dayScreen(view, ui);
    case 'discuss': return discussScreen(view, ui);
    case 'vote': return voteScreen(view, ui);
    case 'result': return outcome(view, ui);
    case 'final': return finalScreen(view, ui);
    default: return '';
  }
}

const NIGHT_INTRO = [
  'Everyone, close your eyes.',
  'The village falls still. Not everyone sleeping means well.',
];

function tvNight(view, ui) {
  const { html } = ui;
  const intro = view.round <= 1 ? NIGHT_INTRO[0] : 'Night falls once more.';
  return html`<div class="tv-stage ww-night">
    <h2 class="tv-big">${intro}</h2>
    <p class="tv-sub">Werewolves, wake and choose.${view.rolesEnabled.seer ? ' The seer may look.' : ''}${view.rolesEnabled.doctor ? ' The doctor may save.' : ''}</p>
    ${ui.countdown(view.timer, { ring: true, size: ui.surface === 'tv' ? 320 : 200 })}
    ${ui.roster(view.players, { mark: view.alive })}
  </div>`;
}

function tvDay(view, ui) {
  const { html } = ui;
  const d = dayHeadline(view);
  return html`<div class="tv-stage ww-day ww-dawn">
    <h2 class="tv-big">Everyone wake up.</h2>
    ${d.diedId
      ? html`<p class="tv-sub">${ui.name(d.diedId)} did not survive the night. They were the <b>${ROLE_LABEL[d.diedRole]}</b>.</p>`
      : html`<p class="tv-sub">${d.sub}</p>`}
    ${view.winner ? html`<p class="lead-line big">${view.winner === 'village' ? 'The village has' : 'The werewolves have'} won.</p>` : ''}
  </div>`;
}

function tvDiscuss(view, ui) {
  const { html } = ui;
  return html`<div class="tv-stage ww-day">
    ${ui.countdown(view.timer, { ring: true, size: ui.surface === 'tv' ? 360 : 220 })}
    <p class="lead-line big">Who isn't acting right?</p>
    <h2 class="ww-count">${view.werewolfCount} wolf${view.werewolfCount === 1 ? '' : 'ves'} still at this table</h2>
    ${ui.deadlyNote(LYNCH_NOTE)}
  </div>`;
}

function tvVote(view, ui) {
  const { html } = ui;
  if (ui.surface === 'shared') {
    return html`<div class="tv-stage ww-day">
      <h2 class="q">Who got voted out?</h2>
      <div class="pick-grid">
        ${view.alive.map((id) => html`<button class="pick" data-act="accuse" data-arg="${id}" data-confirm="Lynch ${ui.name(id)}?">${ui.avatar(id, 44)}<span>${ui.name(id)}</span></button>`)}
      </div>
      <button class="btn btn-secondary" data-act="accuse" data-payload="null" data-confirm="Nobody voted out?">It was a tie</button>
      ${ui.deadlyNote(LYNCH_NOTE)}
    </div>`;
  }
  return html`<div class="tv-stage ww-day">
    <h2 class="tv-big">Vote on your phone</h2>
    ${ui.roster(view.players, { mark: view.voted })}
    ${ui.deadlyNote(LYNCH_NOTE)}
  </div>`;
}

function tvResult(view, ui) {
  const { html } = ui;
  const r = view.result;
  return html`<div class="tv-stage ww-day">
    <h2 class="tv-big">${r && r.lynchedId ? `${ui.name(r.lynchedId)} is lynched` : 'No agreement. Nobody is lynched.'}</h2>
    ${r && r.lynchedId ? html`<p class="tv-sub">They were the <b>${ROLE_LABEL[r.lynchedRole]}</b>.</p>` : ''}
    ${r ? ui.drinks(r.drinks) : ''}
    ${view.winner ? html`<p class="lead-line big">${view.winner === 'village' ? 'The village has' : 'The werewolves have'} won.</p>` : ''}
  </div>`;
}

function tvFinal(view, ui) {
  const { html } = ui;
  const f = view.final;
  if (!f) return '';
  const villageWon = f.winner === 'village';
  const rolesList = Object.entries(f.roles).sort((a, b) => (a[1] === 'werewolf' ? -1 : 1) - (b[1] === 'werewolf' ? -1 : 1));
  // On a room TV the scores live in a side panel (there's room to spare); on
  // the shared pass-and-play screen they go inline, same as the drinks list.
  const aside = view.scores && ui.surface === 'tv' ? html`<aside class="tv-side">${ui.scores(view.scores, { limit: 8 })}</aside>` : '';
  const inlineScores = view.scores && ui.surface !== 'tv' ? html`<h3 class="sec">Scores</h3>${ui.scores(view.scores)}` : '';
  return html`<div class="tv-stage tv-result">
    <h2 class="ww-headline ${villageWon ? 'win' : 'lose'}" ${confetti(ui, `ww-final-${view.gameKey}`)}>${villageWon ? 'The village wins' : 'The werewolves win'}</h2>
    <ul class="ww-finalroles">
      ${rolesList.map(([id, role]) => html`<li class="${f.alive.includes(id) ? 'alive' : 'dead'} ${role === 'werewolf' ? 'wolf' : ''}">${ui.avatar(id, 32)}<span>${ui.name(id)}</span><b>${ROLE_LABEL[role]}</b></li>`)}
    </ul>
    ${ui.drinks(f.drinks)}
    ${inlineScores}
  </div>${aside}`;
}

export function tv(view, ui) {
  switch (view.phase) {
    case 'night': return tvNight(view, ui);
    case 'day': return tvDay(view, ui);
    case 'discuss': return tvDiscuss(view, ui);
    case 'vote': return tvVote(view, ui);
    case 'result': return tvResult(view, ui);
    case 'final': return tvFinal(view, ui);
    default: return '';
  }
}
