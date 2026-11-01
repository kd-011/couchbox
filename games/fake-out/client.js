// Fake Out views. Pure functions of (view, ui) returning markup; buttons
// and forms with data-act dispatch actions (see docs/GAME-MODULES.md).

const PERFECT_NOTE = 'Fool every other player and the Shot Roulette spins between them';
const LAST_NOTE = 'Last place at the end takes a shot';

// "Ben", "Ben and Cy", "Ana, Ben and Cy".
function nameList(ids, ui) {
  const n = ids.map((id) => ui.name(id));
  return n.length < 2 ? n.join('') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

// Name who we're waiting on when it's 3 or fewer (and it fits), else count.
function waitLine(ids, ui, verb, noun) {
  const named = `Waiting for ${nameList(ids, ui)} to ${verb}`;
  return ids.length <= 3 && named.length <= 48 ? named : `Waiting for ${ids.length} more ${noun}`;
}

// Ask the platform for one confetti burst, once per key.
function confetti(ui, key) {
  return ui.raw(`data-fx="confetti" data-fx-key="${ui.esc(key)}"`);
}

// What this player picked in the reveal: 'truth', 'fooled', or null.
function myOutcome(view) {
  const r = view.result;
  const mine = view.me ? r && r.votes[view.me] : view.myVote;
  if (!r || !mine) return null;
  const opt = r.voteOptions.find((o) => o.id === mine);
  return opt && opt.truth ? 'truth' : opt ? { by: opt.authorId } : null;
}

// The one-line "what do I do now" strip the platform shows under the top
// bar on phones. Never called for the room TV.
export function now(view, ui) {
  if (view.final) {
    return ui.isHost ? { text: 'Game over. Tap Play again for another', tone: 'act' } : { text: 'Game over. Check the final scores', tone: 'watch' };
  }
  if (view.phase === 'result') {
    if (ui.isHost) return { text: view.lastRound ? 'Tap See the results when you are ready' : 'Tap Next round when you are ready', tone: 'act' };
    const o = myOutcome(view);
    const next = view.lastRound ? 'Results next' : 'Next round soon';
    if (o === 'truth') return { text: `You found the truth. ${next}`, tone: 'watch' };
    if (o && o.by) return { text: `${ui.name(o.by)} fooled you. ${next}`, tone: 'watch' };
    return { text: view.lastRound ? 'Last round done. Host shows the results' : 'Round over. Host starts the next one', tone: 'watch' };
  }
  if (ui.surface === 'shared') {
    // One phone: everyone writes and votes on a private turn, so the shared
    // screen only shows between them.
    return { text: view.phase === 'write' ? 'Pass the phone so everyone writes a fake' : 'Pass the phone so everyone votes', tone: 'act' };
  }
  const pending = (view.pending || []).filter((id) => id !== view.me);
  if (!view.me) {
    if (view.audience && view.phase === 'vote') {
      return view.myVote ? { text: 'Vote in. Waiting for the players', tone: 'wait' } : { text: 'Pick the true one, just for you', tone: 'act' };
    }
    if (view.audience) return { text: 'Players are writing fakes. You vote next', tone: 'wait' };
    return { text: 'You are in from the next round', tone: 'watch' };
  }
  if (view.phase === 'write') {
    if (view.myFake === null) return { text: 'Write a fake answer that sounds true', tone: 'act' };
    return { text: pending.length ? waitLine(pending, ui, 'write', 'fakes') : 'All in. Voting opens now', tone: 'wait' };
  }
  if (view.phase === 'vote') {
    if (!view.myVote) return { text: 'Tap the answer you think is true', tone: 'act' };
    return { text: pending.length ? waitLine(pending, ui, 'vote', 'votes') : 'All in. Revealing now', tone: 'wait' };
  }
  return null;
}

function fact(text, ui, blank) {
  const { html } = ui;
  const [before, after] = text.split('_____');
  return html`<p class="fo-fact">${before}${blank}${after ?? ''}</p>`;
}

function writeForm(view, ui) {
  const { html } = ui;
  if (view.myFake !== null) {
    return html`<div class="fo-mine">
      <span class="fo-mine-label">${ui.icon('check', 14)} Locked in: your fake answer</span>
      <strong class="fo-mine-text">${view.myFake}</strong>
    </div>
    <div class="waiting-line">${view.writtenCount} of ${view.totalPlayers} written. Voting opens when everyone is in.</div>`;
  }
  return html`<form class="fo-write" data-act="write">
    <input class="input input-xl" name="text" maxlength="60" autocomplete="off" placeholder="Your convincing lie..." data-draft="fo-${view.round}" required>
    <button class="btn btn-primary btn-xl" type="submit">Lock it in</button>
  </form>
  <div class="waiting-line">${view.writtenCount} of ${view.totalPlayers} written</div>`;
}

function voteGrid(view, ui) {
  const { html } = ui;
  return html`<div class="pick-grid fo-vote-grid">
    ${view.options.map((o) => {
      const mine = view.myFakeText !== null && view.myFakeText !== undefined && o.text === view.myFakeText;
      if (mine) {
        return html`<div class="pick fo-own" aria-disabled="true"><span>${o.text}</span><span class="fo-own-tag">Yours</span></div>`;
      }
      return html`<button class="pick ${view.myVote === o.id ? 'on' : ''}" data-act="vote" data-arg="${o.id}" aria-pressed="${view.myVote === o.id}">
        <span>${o.text}</span>
      </button>`;
    })}
  </div>`;
}

// The reveal, staged like a game show: the lies that fooled nobody go by
// first, then each lie that fooled someone (fewest victims first) with its
// author and who fell for it, and the truth lands last. CSS staggers it with
// --d; prefers-reduced-motion shows it all at once.
function resultCard(view, ui) {
  const { html } = ui;
  const r = view.result;
  const votersOf = (id) => Object.entries(r.votes).filter(([, o]) => o === id).map(([v]) => v);
  const lies = r.voteOptions.filter((o) => !o.truth).map((o) => ({ ...o, fooled: votersOf(o.id) }));
  const duds = lies.filter((o) => !o.fooled.length);
  const hits = lies.filter((o) => o.fooled.length).sort((a, b) => a.fooled.length - b.fooled.length);
  const truth = r.voteOptions.find((o) => o.truth);
  const finders = votersOf(truth.id);
  const step = 0.8;
  let t = 0.3;
  const dudAt = t;
  if (duds.length) t += 0.5;
  const hitRows = hits.map((o) => {
    const d = t;
    t += step;
    return html`<li class="fo-lie ${o.authorId === r.perfectBy ? 'is-perfect' : ''}" style="--d:${d}s">
      <span class="fo-lie-text">${o.text}</span>
      <span class="fo-lie-meta">
        <span class="fo-by">${ui.avatar(o.authorId, 26)}<b>${ui.name(o.authorId)}</b>&nbsp;lied</span>
        <span class="fo-fooled">fooled ${o.fooled.map((id) => ui.avatar(id, 26))}</span>
        <b class="fo-pts">+${o.fooled.length}</b>
      </span>
    </li>`;
  });
  const truthAt = t + 0.2;
  const found = myOutcome(view) === 'truth';
  return html`<div class="fo-result" style="--truth:${truthAt}s;--after:${truthAt + 0.7}s">
    ${fact(view.promptText, ui, html`<span class="fo-fill"><span class="fo-blank">?????</span><strong class="fo-answer">${r.answer}</strong></span>`)}
    <ol class="fo-reveal">
      ${duds.length ? html`<li class="fo-duds" style="--d:${dudAt}s"><span class="fo-duds-h">Fooled nobody</span>${duds.map((o) => html`<span class="fo-dud">${ui.avatar(o.authorId, 22)}<span>${o.text}</span></span>`)}</li>` : ''}
      ${hitRows}
      <li class="fo-truth ${found ? 'is-mine' : ''}" style="--d:${truthAt}s">
        <span class="fo-truth-h">${ui.icon('check', 20)} The truth</span>
        <span class="fo-truth-text">${truth.text}</span>
        <span class="fo-lie-meta">${finders.length
          ? html`<span class="fo-fooled">found by ${finders.map((id) => ui.avatar(id, 26))}</span><b class="fo-pts">+1 each</b>`
          : html`<span class="fo-fooled">Nobody found it</span>`}</span>
      </li>
    </ol>
    <div class="fo-after">
      ${r.perfectBy ? html`<p class="fo-perfect">${ui.name(r.perfectBy)} wrote a perfect fake</p>` : ''}
      ${ui.drinks(r.drinks)}
      ${view.scores ? html`<h3 class="sec">Scores after round ${view.round} of ${view.roundsTotal}</h3>${ui.scores(view.scores)}` : ''}
      ${view.lastRound ? ui.deadlyNote(LAST_NOTE) : ''}
    </div>
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
  return html`<div class="fo-final">
    <div class="fo-final-winner" ${best > 0 ? confetti(ui, `fo-final-${view.gameKey}`) : ''}>${best > 0 && tops.length < board.length ? html`<div class="fo-final-avs">${tops.map((r) => ui.avatar(r.id, 72))}</div>` : ''}<h2>${headline}</h2></div>
    ${ui.scores(board)}
    ${teamBoard(view, ui)}
    ${ui.drinks(view.final.drinks)}
  </div>`;
}

function audienceVoteGrid(view, ui) {
  const { html } = ui;
  return html`<div class="pick-grid fo-vote-grid">
    ${view.options.map((o) => html`<button class="pick ${view.myVote === o.id ? 'on' : ''}" data-act="audienceVote" data-arg="${o.id}" aria-pressed="${view.myVote === o.id}">
      <span>${o.text}</span>
    </button>`)}
  </div>`;
}

export function player(view, ui) {
  const { html } = ui;
  if (view.final) return finalCard(view, ui);
  if (view.phase === 'result' && view.result) return resultCard(view, ui);
  if (!view.me) {
    if (view.audience && view.phase === 'vote') {
      return html`<div class="fo-stage">
        ${fact(view.promptText, ui, html`<span class="fo-blank">?????</span>`)}
        <h2 class="q">From the crowd: which one is true?</h2>
        ${audienceVoteGrid(view, ui)}
        <p class="waiting-line">${view.myVote ? html`${ui.icon('check', 16)} Vote in. Tap another to change it.` : 'Just for you, it never changes the scores.'}${ui.drinking ? ' Wrong, and you drink too.' : ''}</p>
      </div>`;
    }
    if (view.audience && view.phase === 'write') {
      return html`<div class="fo-stage">
        <p class="tv-sub">${ui.icon('users', 16)} From the crowd · Round ${view.round} of ${view.roundsTotal}</p>
        ${fact(view.promptText, ui, html`<span class="fo-blank">?????</span>`)}
        <p class="waiting-line">The players are writing fakes: ${view.writtenCount} of ${view.totalPlayers} in. You vote on which one is true next.</p>
      </div>`;
    }
    if (view.audience) {
      return html`<div class="state-card">
        ${ui.icon('users', 36)}
        <h2>You are in the crowd</h2>
        <p>Watch the reveal. The next fact is coming up.</p>
      </div>`;
    }
    return html`<div class="state-card">
      ${ui.icon('users', 36)}
      <h2>You are in from the next round</h2>
      <p>Round ${view.round} is under way. Hang tight.</p>
    </div>`;
  }
  switch (view.phase) {
    case 'write':
      return html`<div class="fo-stage">
        ${ui.countdown(view.timer, { ring: true, size: 90 })}
        <p class="tv-sub">Round ${view.round} of ${view.roundsTotal}</p>
        ${fact(view.promptText, ui, html`<span class="fo-blank">?????</span>`)}
        ${writeForm(view, ui)}
        ${ui.deadlyNote(PERFECT_NOTE)}
      </div>`;
    case 'vote':
      return html`<div class="fo-stage">
        <p class="tv-sub">Round ${view.round} of ${view.roundsTotal}</p>
        ${fact(view.promptText, ui, html`<span class="fo-blank">?????</span>`)}
        <h2 class="q">Which one is true?</h2>
        ${voteGrid(view, ui)}
        <div class="waiting-line">${view.myVote ? html`${ui.icon('check', 16)} Vote in. Tap another to change it. ` : ''}${view.votedCount} of ${view.totalPlayers} voted</div>
        ${ui.deadlyNote(PERFECT_NOTE)}
      </div>`;
    case 'result':
      return resultCard(view, ui);
    default:
      return '';
  }
}

export function tv(view, ui) {
  const { html } = ui;
  if (view.final) return html`<div class="tv-stage">${finalCard(view, ui)}</div>`;
  const scores = view.scores ? html`<aside class="tv-side">${ui.scores(view.scores, { limit: 8 })}</aside>` : '';
  switch (view.phase) {
    case 'write':
      return html`<div class="tv-stage">
        <p class="tv-sub">Round ${view.round} of ${view.roundsTotal}</p>
        ${fact(view.promptText, ui, html`<span class="fo-blank">?????</span>`)}
        ${ui.countdown(view.timer, { ring: true, size: ui.surface === 'tv' ? 320 : 200 })}
        <p class="waiting-line">${view.writtenCount} of ${view.totalPlayers} written</p>
        ${ui.deadlyNote(PERFECT_NOTE)}
      </div>${scores}`;
    case 'vote':
      return html`<div class="tv-stage">
        <p class="tv-sub">Round ${view.round} of ${view.roundsTotal}</p>
        ${fact(view.promptText, ui, html`<span class="fo-blank">?????</span>`)}
        <h2 class="q">Which one is true?</h2>
        <ol class="fo-tv-options">${view.options.map((o) => html`<li>${o.text}</li>`)}</ol>
        <p class="waiting-line">${view.votedCount} of ${view.totalPlayers} voted on their phones</p>
        ${ui.deadlyNote(PERFECT_NOTE)}
      </div>${scores}`;
    case 'result':
      // A room TV has the scores in the side panel already.
      return html`<div class="tv-stage tv-result">${resultCard({ ...view, scores: ui.surface === 'tv' ? null : view.scores }, ui)}</div>${scores}`;
    default:
      return '';
  }
}
