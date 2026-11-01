// Quiz Show views. See docs/GAME-MODULES.md for the contract.
// A contestant is a solo player (memberIds: [playerId], real room player) or
// a team (pass and play always; a room split into teams): team ids are
// synthetic ('team-1', 't1'), so ui.name()/ui.avatar() (which only resolve
// real room players) cannot be used for them. teamAvatar/contestantName
// below render a team directly from the contestant object instead. Drink
// entries always name real players (each team member drinks), so
// ui.drinks() renders them the same in every mode.
//
// Whether contestants are teams is a whole-game mode (view.teamsOn), never
// per-contestant: a team of exactly one member still renders as a team
// (teamAvatar/c.name), so this can't be inferred from memberIds.length.

function teamAvatar(c, ui, size = 40) {
  const { html } = ui;
  // "Team 1" -> "T1", not "TE".
  const initials = (c.name || '?').replace(/^Team\s+/i, 'T').slice(0, 2).toUpperCase();
  return html`<span class="av" style="--c:${c.color};--s:${size}px" aria-hidden="true">${initials}</span>`;
}

function contestantAvatar(c, ui, teamsOn, size = 40) {
  if (!c) return ui.avatar(null, size);
  return teamsOn ? teamAvatar(c, ui, size) : ui.avatar(c.id, size);
}

function contestantName(c, ui, teamsOn) {
  if (!c) return 'Someone';
  return teamsOn ? c.name : ui.name(c.id);
}

// "Ben", "Ben and Cy", "Ben, Cy and Dee"; null past three names.
function joinNames(n) {
  if (!n.length || n.length > 3) return null;
  const s = n.length === 1 ? n[0] : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
  return s.length > 30 ? null : s;
}

function fxKey(...parts) {
  let h = 0;
  for (const c of parts.join('|')) h = (h * 31 + c.charCodeAt(0)) | 0;
  return `qs-${(h >>> 0).toString(36)}`;
}

function hostName(ui) {
  return ui.hostId && ui.player && ui.player(ui.hostId) ? ui.name(ui.hostId) : 'The host';
}

function byId(view) {
  return Object.fromEntries(view.contestants.map((c) => [c.id, c]));
}

function scoreboard(view, ui) {
  const { html } = ui;
  if (!view.teamsOn) return ui.scores(view.scores, { always: true });
  const map = byId(view);
  if (!view.scores.length) return ui.raw('');
  const top = view.scores[0].score;
  const rows = view.scores.map((r) => html`<li class="${r.score === top && top > 0 ? 'lead' : ''}">
    <span class="rank">${1 + view.scores.filter((x) => x.score > r.score).length}</span>
    ${teamAvatar(map[r.id], ui, 32)}<span class="nm">${map[r.id]?.name || 'Team'}</span><span class="pts">${r.score}</span></li>`);
  return html`<ol class="scores">${rows}</ol>`;
}

// Deadly: telegraph Double or Nothing before the question resolves. Names
// whoever is on it, or says how to get there.
function donNote(view, ui) {
  if (!ui.deadly) return '';
  const map = byId(view);
  const on = view.don || [];
  if (!on.length) return ui.deadlyNote(`${view.doubleAt || 3} right in a row puts you on Double or Nothing`);
  if (ui.mode === 'room' && view.myContestantId && on.includes(view.myContestantId)) {
    return ui.deadlyNote('You are on Double or Nothing: right scores double, wrong is a shot');
  }
  const names = on.map((id) => contestantName(map[id], ui, view.teamsOn));
  return ui.deadlyNote(`${names.join(' and ')} ${names.length === 1 ? 'is' : 'are'} on Double or Nothing: right scores double, wrong is a shot`);
}

// A badge on a contestant who is on Double or Nothing.
function donBadge(view, id, ui) {
  return ui.deadly && (view.don || []).includes(id) ? ui.html`<span class="pill pill-deadly qs-don">Double or Nothing</span>` : '';
}

// Who is on Double or Nothing, as avatars, for the big screen.
function donStrip(view, ui) {
  const on = view.don || [];
  if (!ui.deadly || !on.length || ui.surface !== 'tv') return '';
  const map = byId(view);
  return ui.html`<div class="qs-don-strip">${on.map((id) => ui.html`<span class="qs-don-who">${contestantAvatar(map[id], ui, view.teamsOn, 40)}<b>${contestantName(map[id], ui, view.teamsOn)}</b>${donBadge(view, id, ui)}</span>`)}</div>`;
}

const TYPE_LABEL = { multiple: 'Multiple choice', truefalse: 'True or false', emoji: 'Emoji round', buzzer: 'Buzzer round' };

// Every answer option has a fixed colour AND a fixed shape (red triangle,
// blue diamond, yellow circle, green square), identical on phones and the
// TV, so players match the screen without reading. True or false is the
// blue diamond (True) and the red triangle (False).
const OPT = [
  { c: '#ff5a4f', i: '#2c0703', shape: 'tri', name: 'triangle' },
  { c: '#3d8bff', i: '#04122e', shape: 'dia', name: 'diamond' },
  { c: '#ffb020', i: '#2b1a00', shape: 'cir', name: 'circle' },
  { c: '#2fc58a', i: '#03251a', shape: 'sq', name: 'square' },
];
const SHAPES = {
  tri: '<path d="M12 3 22 20H2z"/>',
  dia: '<path d="M12 2 22 12 12 22 2 12z"/>',
  cir: '<circle cx="12" cy="12" r="9.5"/>',
  sq: '<rect x="3" y="3" width="18" height="18" rx="2.5"/>',
};
const optOf = (i, tf) => (tf ? OPT[i === 0 ? 1 : 0] : OPT[i % OPT.length]);
function shape(o, ui) {
  return ui.raw(`<svg class="qs-shape" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">${SHAPES[o.shape]}</svg>`);
}
const optStyle = (o) => `--oc:${o.c};--oi:${o.i}`;

// The coloured option tiles. mode: 'pick' (this phone answers),
// 'show' (TV, read only), 'reveal' (correct one lit, the rest dimmed).
function optionTiles(options, ui, { tf = false, act = null, chosen = null, correct = null, mode = 'show', payload = (i) => String(i) } = {}) {
  const { html } = ui;
  const cls = `qs-opts ${tf ? 'qs-tf' : ''} ${mode === 'pick' ? 'pick-grid' : ''} ${chosen !== null && chosen !== undefined ? 'chosen' : ''} ${mode === 'reveal' ? 'revealed' : ''}`;
  return html`<div class="${cls}">${options.map((opt, i) => {
    const o = optOf(i, tf);
    const state = mode === 'reveal' ? (i === correct ? 'right' : 'dim') : chosen === i ? 'on' : '';
    return mode === 'pick'
      ? html`<button class="pick qs-opt ${state}" style="${optStyle(o)}" data-act="${act}" data-payload="${payload(i)}" aria-pressed="${chosen === i}" aria-label="${o.name}: ${opt}">${shape(o, ui)}<span class="qs-opt-text">${opt}</span>${chosen === i ? ui.icon('check', 22) : ''}</button>`
      : html`<div class="qs-opt ${state}" style="${optStyle(o)}">${shape(o, ui)}<span class="qs-opt-text">${opt}</span>${state === 'right' ? ui.icon('check', 22) : ''}</div>`;
  })}</div>`;
}

function boardView(view, ui) {
  const { html } = ui;
  const cols = view.board.length > 9 ? 4 : 3;
  return html`<div class="qs-stage qs-board-stage">
    <h2 class="q qs-board-title">${ui.isHost ? 'Pick a tile' : `${hostName(ui)} is picking`}</h2>
    ${donNote(view, ui)}
    <div class="qs-board pick-grid" style="--cols:${cols}">${view.board.map((t, i) => html`
      <button class="pick qs-tile qs-t-${t.type} ${t.used ? 'used' : ''}" style="--d:${i * 40}ms" data-act="pickTile" data-arg="${t.id}" ${ui.isHost && !t.used ? '' : 'disabled'} aria-label="${t.label}, ${TYPE_LABEL[t.type]}${t.used ? ', played' : ''}">
        ${t.used
          ? html`<span class="qs-tile-done">${ui.icon('check', 22)}</span><span class="qs-tile-cat">${t.label}</span>`
          : html`<span class="qs-tile-type">${TYPE_LABEL[t.type]}</span><span class="qs-tile-cat">${t.label}</span>`}
      </button>`)}</div>
    <p class="waiting-line qs-left">${view.boardLeft} of ${view.board.length} tiles left</p>
  </div>`;
}

function teamsView(view, ui) {
  const { html } = ui;
  return html`<div class="qs-stage">
    <h2 class="q">Teams</h2>
    <div class="qs-teams">${view.contestants.map((c) => html`<div class="qs-team" style="--c:${c.color}">
      <div class="qs-team-head">${teamAvatar(c, ui, 40)}<strong>${c.name}</strong></div>
      <ul class="roster">${c.memberIds.map((id) => html`<li class="on">${ui.avatar(id, 28)}<span>${ui.name(id)}</span></li>`)}</ul>
    </div>`)}</div>
  </div>`;
}

function questionAnswerArea(view, ui) {
  const { html } = ui;
  const r = view.round;
  const tf = r.type === 'truefalse';
  if (ui.mode === 'pass') {
    return html`<div class="qs-team-grid">${view.contestants.map((c) => html`<div class="qs-team-answer ${r.answered.includes(c.id) ? 'in' : ''}">
      <div class="qs-team-label">${teamAvatar(c, ui, 28)}<strong>${c.name}</strong>${donBadge(view, c.id, ui)}${r.answered.includes(c.id) ? html`<span class="qs-in">${ui.icon('check', 16)} In</span>` : ''}</div>
      ${optionTiles(r.options, ui, { tf, mode: 'pick', act: 'answer', payload: (i) => `{"contestantId":"${c.id}","choice":${i}}` })}
    </div>`)}</div>`;
  }
  if (!ui.interactive || !view.me) return optionTiles(r.options, ui, { tf });
  return optionTiles(r.options, ui, { tf, mode: 'pick', act: 'answer', chosen: r.myAnswer });
}

function questionView(view, ui) {
  const { html } = ui;
  const r = view.round;
  const answered = ui.mode === 'room' && r.myAnswer !== null && r.myAnswer !== undefined;
  return html`<div class="qs-stage qs-question">
    <p class="qs-kicker">${r.categoryLabel} · ${TYPE_LABEL[r.type]}</p>
    ${r.type === 'emoji' ? html`<div class="qs-emoji">${r.text}</div>` : html`<h2 class="q">${r.text}</h2>`}
    ${ui.countdown(view.timer, { ring: true, size: ui.surface === 'tv' ? 260 : ui.mode === 'pass' ? 84 : 120 })}
    ${donNote(view, ui)}
    ${donStrip(view, ui)}
    ${questionAnswerArea(view, ui)}
    <p class="waiting-line">${answered ? html`${ui.icon('check', 16)} Answer in. ` : ''}${r.answered.length} of ${view.contestants.length} answered</p>
  </div>`;
}

function roomBuzzerControls(r, ui) {
  const { html } = ui;
  if (r.canBuzz) return html`<button class="qs-buzz" data-act="buzz"><span>Buzz</span></button>`;
  if (r.isBuzzActive) {
    return html`<form class="qs-buzz-form" data-act="submitBuzzAnswer">
      <input name="text" class="input" placeholder="Type your answer" autocomplete="off" enterkeyhint="send" data-keep="qs-buzz-input">
      <button class="btn btn-primary" type="submit">Submit</button>
    </form>`;
  }
  if (r.lockedOut) return html`<p class="waiting-line">${ui.icon('close', 16)} Wrong buzz: you're out of this one</p>`;
  return '';
}

function buzzerView(view, ui) {
  const { html } = ui;
  const r = view.round;
  const map = byId(view);
  const active = map[r.buzzActive];
  const judging = ui.mode === 'pass' && r.buzzActive;
  return html`<div class="qs-stage qs-question">
    <p class="tv-sub qs-kicker">${r.categoryLabel} · Buzzer round</p>
    <h2 class="q">${r.text}</h2>
    ${ui.countdown(view.timer, { ring: true, size: ui.surface === 'tv' ? 200 : 96 })}
    ${judging
      ? html`<div class="qs-judge">
          <p class="lead-line">${teamAvatar(active, ui, 36)} <span><b>${active?.name}</b> buzzed. What did they say?</span></p>
          <p class="qs-answer-hint">Correct answer: <b>${r.judgeAnswer}</b></p>
        </div>`
      : r.buzzActive
        ? html`<p class="lead-line big qs-buzzed">${contestantAvatar(active, ui, view.teamsOn, 40)} <span><b>${contestantName(active, ui, view.teamsOn)}</b> is answering</span></p>`
        : ui.surface === 'tv' ? html`<p class="lead-line big">First to buzz gets to answer</p>` : ''}
    ${donNote(view, ui)}
    ${donStrip(view, ui)}
    ${ui.mode === 'room' && ui.interactive ? roomBuzzerControls({ canBuzz: view.round.canBuzz, isBuzzActive: view.round.isBuzzActive, lockedOut: !!view.myContestantId && r.buzzedOut.includes(view.myContestantId) }, ui) : ''}
    ${ui.mode === 'pass' ? html`<div class="pick-grid qs-buzz-teams">${view.contestants.filter((c) => !r.buzzedOut.includes(c.id)).map((c) => html`
      <button class="pick" style="--c:${c.color}" data-act="buzz" data-arg="${c.id}" ${r.buzzActive ? 'disabled' : ''}>${teamAvatar(c, ui, 36)}<span>${c.name} buzzed</span>${donBadge(view, c.id, ui)}</button>`)}</div>` : ''}
  </div>`;
}

// Deadly extras on a reveal row: doubled, caught on Double or Nothing, or
// the streak building towards it.
function resultTag(view, r, id, ui) {
  const { html } = ui;
  if (!ui.deadly) return '';
  if ((r.doubled || []).includes(id)) return html` <span class="pill pill-deadly qs-don">Doubled</span>`;
  if ((r.donShots || []).includes(id)) return html` <span class="pill pill-deadly qs-don">Shot</span>`;
  if ((view.don || []).includes(id)) return html` <span class="pill pill-deadly qs-don">Double or Nothing next</span>`;
  const n = (view.streaks || {})[id] || 0;
  return n > 0 ? html` <span class="qs-streak">${n} in a row</span>` : '';
}

function revealView(view, ui) {
  const { html } = ui;
  const r = view.round;
  const map = byId(view);
  const mine = ui.surface === 'player' && view.myContestantId ? r.results.find((x) => x.id === view.myContestantId) : null;
  const fx = mine && mine.points > 0 ? fxKey('right', r.text, view.myContestantId, view.boardLeft) : '';
  const correct = r.options && r.correctText !== null ? r.options.indexOf(r.correctText) : -1;
  return html`<div class="qs-stage qs-reveal">
    ${mine ? html`<p class="qs-mine ${mine.points > 0 ? 'hit' : 'miss'}" ${fx ? ui.raw(`data-fx="confetti" data-fx-key="${fx}"`) : ''}>${mine.points > 0 ? html`${view.teamsOn ? 'Your team got it' : 'You got it'} <b>+${mine.points}</b>` : 'Not this time'}</p>` : ''}
    <p class="qs-kicker">${r.categoryLabel}</p>
    ${r.type === 'emoji' ? html`<div class="qs-emoji sm">${r.text}</div>` : html`<h2 class="q">${r.text}</h2>`}
    ${r.type !== 'buzzer' && correct >= 0
      ? optionTiles(r.options, ui, { tf: r.type === 'truefalse', mode: 'reveal', correct })
      : r.correctText ? html`<p class="qs-answer">${r.correctText}</p>` : ''}
    ${r.type === 'buzzer' ? html`<p class="lead-line big">${r.winner ? html`${contestantAvatar(map[r.winner], ui, view.teamsOn, 40)} <span><b>${contestantName(map[r.winner], ui, view.teamsOn)}</b> got it</span>` : 'Nobody got it'}</p>` : ''}
    <ul class="qs-results">${r.results.map((res) => html`<li class="${res.points > 0 ? 'hit' : 'miss'}">
      ${contestantAvatar(map[res.id], ui, view.teamsOn, 32)}<span>${contestantName(map[res.id], ui, view.teamsOn)}${resultTag(view, r, res.id, ui)}</span>
      <strong>${res.points > 0 ? `+${res.points}` : '0'}</strong></li>`)}</ul>
    ${ui.drinks(r.drinks)}
  </div>`;
}

function leaderboardView(view, ui) {
  const { html } = ui;
  return html`<div class="qs-stage qs-standings">
    <h2 class="q">Standings</h2>
    ${scoreboard(view, ui)}
    ${donNote(view, ui)}
    <p class="waiting-line">${view.boardLeft > 0 ? `${view.boardLeft} tile${view.boardLeft === 1 ? '' : 's'} left on the board` : 'The final wager is next'}</p>
  </div>`;
}

function wagerChoices(max) {
  if (max <= 0) return [0];
  return [...new Set([0, Math.round(max * 0.25), Math.round(max * 0.5), max])].sort((a, b) => a - b);
}

function wagerBidView(view, ui) {
  const { html } = ui;
  const w = view.wager;
  if (ui.mode === 'pass') {
    return html`<div class="qs-stage">
      <h2 class="q">Final wager</h2>
      <p class="lead-line">Right, a team gains its wager. Wrong, it loses it.</p>
      ${view.contestants.map((c) => {
        const score = view.scores.find((s) => s.id === c.id)?.score || 0;
        return html`<div class="qs-wager-row">
          <div class="qs-team-label">${teamAvatar(c, ui, 28)}<strong>${c.name}</strong><span>${score} pts</span></div>
          <div class="chips qs-wager-chips">${wagerChoices(score).map((n) => html`<button class="chip" data-act="placeBid" data-payload='{"contestantId":"${c.id}","amount":${n}}'>${n}</button>`)}</div>
          ${w.bidsIn.includes(c.id) ? html`<p class="waiting-line">${ui.icon('check', 16)} Locked in</p>` : ''}
        </div>`;
      })}
    </div>`;
  }
  if (ui.surface === 'tv' || !view.me) {
    return html`<div class="qs-stage">
      <h2 class="tv-big">Final wager</h2>
      <p class="lead-line big">Bet any of your points on one last question. Right, you gain it. Wrong, you lose it.</p>
      <ul class="roster">${view.contestants.map((c) => html`<li class="${w.bidsIn.includes(c.id) ? 'on' : ''}">${contestantAvatar(c, ui, view.teamsOn, 34)}<span>${contestantName(c, ui, view.teamsOn)}</span>${w.bidsIn.includes(c.id) ? ui.icon('check', 16) : ''}</li>`)}</ul>
      <p class="waiting-line">${w.bidsIn.length} of ${view.contestants.length} wagers in</p>
    </div>`;
  }
  return html`<div class="qs-stage">
    <p class="qs-kicker">Final wager</p>
    <div class="qs-bank"><b>${w.myMax}</b><span>points to play with</span></div>
    <div class="chips qs-wager-chips">${wagerChoices(w.myMax).map((n) => html`<button class="chip ${w.myBid === n ? 'on' : ''}" data-act="placeBid" data-payload="${n}" aria-pressed="${w.myBid === n}">${n}</button>`)}</div>
    <p class="waiting-line">${w.myBid !== null && w.myBid !== undefined ? html`${ui.icon('check', 16)} Wagered ${w.myBid}. ` : ''}${w.bidsIn.length} of ${view.contestants.length} wagers in</p>
  </div>`;
}

function wagerQuestionView(view, ui) {
  const { html } = ui;
  const w = view.wager;
  return html`<div class="qs-stage qs-question">
    <p class="qs-kicker">Final wager</p>
    <h2 class="q">${w.text}</h2>
    ${ui.countdown(view.timer, { ring: true, size: ui.surface === 'tv' ? 260 : 120 })}
    ${ui.mode === 'pass'
      ? html`<div class="qs-team-grid">${view.contestants.map((c) => html`<div class="qs-team-answer ${w.answeredIn.includes(c.id) ? 'in' : ''}">
          <div class="qs-team-label">${teamAvatar(c, ui, 28)}<strong>${c.name}</strong>${w.answeredIn.includes(c.id) ? html`<span class="qs-in">${ui.icon('check', 16)} In</span>` : ''}</div>
          ${optionTiles(w.options, ui, { mode: 'pick', act: 'wagerAnswer', payload: (i) => `{"contestantId":"${c.id}","choice":${i}}` })}
        </div>`)}</div>`
      : ui.interactive && view.me
        ? optionTiles(w.options, ui, { mode: 'pick', act: 'wagerAnswer', chosen: w.myAnswer })
        : optionTiles(w.options, ui, {})}
    <p class="waiting-line">${ui.mode === 'room' && w.myAnswer !== null && w.myAnswer !== undefined ? html`${ui.icon('check', 16)} Answer in. ` : ''}${w.answeredIn.length} of ${view.contestants.length} answered</p>
  </div>`;
}

function finalView(view, ui) {
  const { html } = ui;
  const board = view.final.board;
  const best = board.length ? board[0].score : 0;
  const tops = board.filter((r) => r.score === best);
  const map = byId(view);
  const headline = best <= 0 ? 'Game over' : tops.length === 1 ? `${contestantName(map[tops[0].id], ui, view.teamsOn)} wins` : 'Tied at the top';
  return html`<div class="qs-stage qs-final">
    ${best > 0 ? html`<div class="qs-champ">${ui.icon('crown', 40)}<div class="winner-avs">${tops.map((r) => contestantAvatar(map[r.id], ui, view.teamsOn, 88))}</div></div>` : ''}
    <h2 class="qs-headline">${headline}</h2>
    ${best > 0 ? html`<p class="qs-final-pts">${best} points</p>` : ''}
    ${scoreboard(view, ui)}
    ${ui.drinks(view.final.drinks)}
  </div>`;
}

function renderPhase(view, ui) {
  switch (view.phase) {
    case 'teams': return teamsView(view, ui);
    case 'board': return boardView(view, ui);
    case 'question': return questionView(view, ui);
    case 'buzzer': return buzzerView(view, ui);
    case 'reveal': return revealView(view, ui);
    case 'leaderboard': return leaderboardView(view, ui);
    case 'wager-bid': return wagerBidView(view, ui);
    case 'wager-question': return wagerQuestionView(view, ui);
    case 'final': return finalView(view, ui);
    default: return '';
  }
}

function audienceBetScreen(view, ui) {
  const { html } = ui;
  if (view.myBet) {
    const c = byId(view)[view.myBet];
    return html`<div class="state-card qs-crowd">
      ${contestantAvatar(c, ui, view.teamsOn, 56)}<h2>You bet on ${contestantName(c, ui, view.teamsOn)}</h2>
      <p>Right, nothing happens. Wrong, you drink.</p>
    </div>`;
  }
  return html`<div class="qs-stage qs-crowd">
    <h2 class="q">From the crowd: who scores this one?</h2>
    <p class="lead-line">Guess wrong and you drink. Guess right and you don't.</p>
    <div class="pick-grid">${view.contestants.map((c) => html`<button class="pick" data-act="audienceBet" data-arg="${c.id}">
      ${contestantAvatar(c, ui, view.teamsOn, 34)}<span>${contestantName(c, ui, view.teamsOn)}</span></button>`)}</div>
  </div>`;
}

export function player(view, ui) {
  const { html } = ui;
  if (!view.me) {
    if (view.audience && (view.phase === 'question' || view.phase === 'buzzer') && 'myBet' in view) return audienceBetScreen(view, ui);
    if (view.phase === 'final' && view.final) return finalView(view, ui);
    return view.audience
      ? html`<div class="state-card">${ui.icon('users', 36)}<h2>You're in the crowd</h2><p>Bet on who scores when the next question is up.</p></div>`
      : html`<div class="state-card">${ui.icon('users', 36)}<h2>Watching this one</h2><p>You're in from the next game.</p></div>`;
  }
  return renderPhase(view, ui);
}

export function tv(view, ui) {
  return renderPhase(view, ui);
}

// The one-line "what do I do now" strip under the top bar on phones.
function waitLine(prefix, ids, view, ui, noun) {
  const map = byId(view);
  const left = view.contestants.map((c) => c.id).filter((id) => !ids.includes(id) && id !== view.myContestantId);
  if (!left.length) return { text: `${prefix}Revealing now`, tone: 'wait' };
  const names = joinNames(left.map((id) => contestantName(map[id], ui, view.teamsOn)));
  return { text: names ? `${prefix}Waiting for ${names}` : `${prefix}Waiting for ${left.length} more ${noun}`, tone: 'wait' };
}

export function now(view, ui) {
  const shared = ui.surface === 'shared';
  const map = byId(view);
  const host = shared || ui.isHost;
  const p = view.phase;
  if (p === 'final') {
    return host ? { text: 'Game over. Play again or see the standings', tone: 'act' } : { text: 'Game over. Host picks what\'s next', tone: 'watch' };
  }
  if (shared) {
    switch (p) {
      case 'teams': return { text: 'Check the teams, then tap Start the quiz', tone: 'act' };
      case 'board': return { text: 'Pick a tile, then read it out', tone: 'act' };
      case 'question': return { text: 'Read it out. Tap each team\'s answer', tone: 'act' };
      case 'buzzer': {
        const r = view.round;
        if (r && r.buzzActive) return { text: `${contestantName(map[r.buzzActive], ui, true)} buzzed: tap Correct or Wrong`, tone: 'act' };
        return { text: 'Read it out. Tap the team that buzzes', tone: 'act' };
      }
      case 'reveal': return { text: 'Read the answer, then Show standings', tone: 'act' };
      case 'leaderboard': return { text: view.boardLeft > 0 ? 'Tap Back to the board for the next tile' : 'Tap Go to the final wager', tone: 'act' };
      case 'wager-bid': return { text: 'Tap each team\'s wager', tone: 'act' };
      case 'wager-question': return { text: 'Read it out. Tap each team\'s answer', tone: 'act' };
      default: return null;
    }
  }
  // A room phone.
  if (!view.me) {
    if (view.audience && (p === 'question' || p === 'buzzer') && 'myBet' in view) {
      return view.myBet ? { text: 'Bet in. Watch the answers come in', tone: 'wait' } : { text: 'From the crowd: bet on who scores', tone: 'act' };
    }
    return view.audience ? { text: 'In the crowd. Look at the TV', tone: 'watch' } : { text: 'You\'re in from the next game', tone: 'wait' };
  }
  switch (p) {
    case 'board':
      return ui.isHost ? { text: 'Pick a tile from the board', tone: 'act' } : { text: `Waiting for ${hostName(ui) === 'The host' ? 'the host' : hostName(ui)} to pick a tile`, tone: 'wait' };
    case 'question': {
      const r = view.round;
      if (r.myAnswer === null || r.myAnswer === undefined) return { text: r.type === 'truefalse' ? 'True or false? Answer before time\'s up' : 'Pick an answer before time\'s up', tone: 'act' };
      return waitLine('Answer in. ', r.answered, view, ui, 'answers');
    }
    case 'buzzer': {
      const r = view.round;
      if (r.isBuzzActive) return { text: 'You buzzed: type your answer and send', tone: 'act' };
      if (r.canBuzz) return { text: 'Buzz in if you know it', tone: 'act' };
      if (r.buzzActive) return { text: `${contestantName(map[r.buzzActive], ui, view.teamsOn)} is answering`, tone: 'watch' };
      return { text: 'Locked out. Others can still buzz', tone: 'wait' };
    }
    case 'reveal': {
      if (ui.isHost) return { text: 'Tap Show standings when you\'re ready', tone: 'act' };
      const mine = view.round.results.find((x) => x.id === view.myContestantId);
      if (mine && mine.points > 0) return { text: `Right: +${mine.points}. Standings next`, tone: 'watch' };
      return { text: 'Not this time. Standings next', tone: 'watch' };
    }
    case 'leaderboard':
      if (ui.isHost) return { text: view.boardLeft > 0 ? 'Tap Back to the board for the next tile' : 'Tap Go to the final wager', tone: 'act' };
      return { text: view.boardLeft > 0 ? 'Standings. Host picks the next tile' : 'Standings. The final wager is next', tone: 'watch' };
    case 'wager-bid': {
      const w = view.wager;
      if (w.myBid === null || w.myBid === undefined) return { text: w.myMax > 0 ? `Wager up to ${w.myMax} points` : 'No points yet: lock in a wager of 0', tone: 'act' };
      return waitLine('Wager in. ', w.bidsIn, view, ui, 'wagers');
    }
    case 'wager-question': {
      const w = view.wager;
      if (w.myAnswer === null || w.myAnswer === undefined) return { text: 'Answer the final question', tone: 'act' };
      return waitLine('Answer in. ', w.answeredIn, view, ui, 'answers');
    }
    default:
      return null;
  }
}
