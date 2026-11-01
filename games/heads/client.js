// Celebrity Heads views. See docs/GAME-MODULES.md for the contract.

const NOTE = 'Guess nothing this turn and it\'s a shot';
const NOTE_END = 'Last place at the end takes a shot';

function turnLabel(view) {
  const rot = view.rotations > 1 ? ` · lap ${view.rotation} of ${view.rotations}` : '';
  return `Turn ${view.turnNo} of ${view.turnsTotal}${rot}`;
}

function recap(view, ui) {
  const { html } = ui;
  const r = view.recap;
  const g = view.guesser;
  return html`<div class="hd-recap">
    <div class="hd-score-big ${view.gotCount ? '' : 'zero'}"><strong>${view.gotCount}</strong><span>${ui.avatar(g, 28)} ${ui.name(g)} got ${view.gotCount === 1 ? 'one' : view.gotCount}</span></div>
    <div class="hd-words">
      ${r.got.map((w) => html`<span class="w got">${ui.icon('check', 14)} ${w}</span>`)}
      ${r.passed.map((w) => html`<span class="w passed">${w}</span>`)}
      ${r.lastWord && !r.got.includes(r.lastWord) && !r.passed.includes(r.lastWord) ? html`<span class="w missed">${r.lastWord}</span>` : ''}
    </div>
    ${ui.drinks(r.drinks)}
    <p class="lead-line">${view.upNext ? html`${ui.avatar(view.upNext, 28)} <span>Up next: <b>${ui.name(view.upNext)}</b></span>` : 'That was the last turn. Results next'}</p>
    ${ui.surface !== 'tv' ? html`<h3 class="sec">Scores</h3>${ui.scores(view.scores, { limit: 8 })}` : ''}
  </div>`;
}

function final(view, ui) {
  const { html } = ui;
  const board = view.final.board;
  const best = board.length ? board[0].score : 0;
  const tops = board.filter((r) => r.score === best);
  const headline = best === 0 ? 'Game over'
    : tops.length === 1 ? `${ui.name(tops[0].id)} wins`
      : tops.length === board.length ? 'Dead heat' : `${tops.map((r) => ui.name(r.id)).join(' and ')} tie`;
  return html`<div class="hd-final">
    <div class="winner">${best > 0 && tops.length < board.length ? html`<div class="winner-avs">${tops.map((r) => ui.avatar(r.id, 72))}</div>` : ''}<h2>${headline}</h2></div>
    ${ui.scores(view.final.board)}
    ${ui.drinks(view.final.drinks)}
  </div>`;
}

export function player(view, ui) {
  const { html } = ui;
  const g = view.guesser;
  if (view.phase === 'final') return final(view, ui);
  if (view.phase === 'turnEnd') return recap(view, ui);
  if (!view.me) {
    return html`<div class="state-card">${ui.avatar(g, 56)}<h2>${ui.name(g)} is in the hot seat</h2><p>You are watching this one.</p></div>`;
  }
  const isG = view.role === 'guesser';
  if (view.phase === 'ready') {
    return isG
      ? html`<div class="hd-stage">
          <p class="tv-sub">${turnLabel(view)}</p>
          ${ui.avatar(g, 88)}
          <h2 class="hd-you">You are in the hot seat</h2>
          ${ui.deadlyNote(NOTE)}
          <button class="btn btn-primary btn-xl" data-act="start">Start my turn</button>
        </div>`
      : html`<div class="hd-stage">
          <p class="tv-sub">${turnLabel(view)}</p>
          ${ui.avatar(g, 88)}
          <h2 class="hd-you">${ui.name(g)} is up</h2>
          <p class="lead-line">Keep your screen away from ${ui.name(g)}</p>
          ${ui.deadlyNote(`${ui.name(g)} guesses nothing, ${ui.name(g)} takes a shot`)}
        </div>`;
  }
  // play
  if (isG) {
    return html`<div class="hd-stage">
      ${ui.countdown(view.timer, { ring: true, size: 220 })}
      <h2 class="hd-you">Ask away</h2>
      <div class="hd-tally"><span class="got"><b>${view.gotCount}</b> got</span>${view.passCount ? html`<span><b>${view.passCount}</b> passed</span>` : ''}</div>
      ${view.gotCount ? ui.deadlyNote(NOTE_END) : ui.deadlyNote(NOTE)}
    </div>`;
  }
  return html`<div class="hd-play">
    <div class="hd-top">${ui.avatar(g, 36)} <span>${ui.name(g)} · <b>${view.gotCount}</b> got</span> ${ui.countdown(view.timer)}</div>
    <div class="hd-word" data-word="${view.wordId}">${view.word}</div>
    <div class="hd-buttons">
      <button class="btn hd-pass" data-act="pass" data-payload="${view.wordId}">Pass</button>
      <button class="btn hd-got" data-act="got" data-payload="${view.wordId}">Got it</button>
    </div>
    ${view.gotCount ? '' : ui.deadlyNote(`Nothing guessed yet: ${ui.name(g)} is on for a shot`)}
  </div>`;
}

export function tv(view, ui) {
  const { html } = ui;
  const g = view.guesser;
  const shared = ui.surface === 'shared';
  const side = ui.surface === 'tv' ? html`<aside class="tv-side">${ui.scores(view.scores, { limit: 8 })}</aside>` : '';
  if (view.phase === 'final') return html`<div class="tv-stage">${final(view, ui)}</div>`;
  if (view.phase === 'turnEnd') return html`<div class="tv-stage">${recap(view, ui)}</div>${side}`;
  if (view.phase === 'ready') {
    return html`<div class="tv-stage">
      <p class="tv-sub">${turnLabel(view)}</p>
      ${ui.avatar(g, shared ? 88 : 140)}
      <h2 class="tv-big">${shared ? `Pass the phone to ${ui.name(g)}` : `${ui.name(g)} is in the hot seat`}</h2>
      <p class="lead-line">${shared ? 'Screen facing out, on your forehead' : `${ui.name(g)}: no peeking at the phones`}</p>
      ${ui.deadlyNote(NOTE)}
    </div>${side}`;
  }
  // play
  if (shared) {
    return html`<div class="hd-play hd-forehead">
      <div class="hd-top">${ui.avatar(g, 36)} <span>${ui.name(g)} · <b>${view.gotCount}</b> got</span> ${ui.countdown(view.timer)}</div>
      <div class="hd-word" data-word="${view.wordId}">${view.word}</div>
      <div class="hd-buttons">
        <button class="btn hd-pass" data-act="pass" data-payload="${view.wordId}">Pass</button>
        <button class="btn hd-got" data-act="got" data-payload="${view.wordId}">Got it</button>
      </div>
      ${view.gotCount ? '' : ui.deadlyNote(NOTE)}
    </div>`;
  }
  return html`<div class="tv-stage">
    ${ui.countdown(view.timer, { ring: true, size: 380 })}
    <div class="lead-line big">${ui.avatar(g, 56)} <span><b>${ui.name(g)}</b> · ${view.gotCount} got${view.passCount ? ` · ${view.passCount} passed` : ''}</span></div>
    ${view.gotCount ? ui.deadlyNote(NOTE_END) : ui.deadlyNote(`Guess nothing and ${ui.name(g)} takes a shot`)}
  </div>${side}`;
}

// The one-line "what do I do now" strip under the top bar on phones.
export function now(view, ui) {
  const shared = ui.surface === 'shared';
  const g = view.guesser;
  const gName = ui.name(g);
  if (view.phase === 'final') {
    return shared || ui.isHost
      ? { text: 'Game over. Play again or see the standings', tone: 'act' }
      : { text: 'Game over. Host picks what\'s next', tone: 'watch' };
  }
  if (view.phase === 'turnEnd') {
    if (shared || ui.isHost) return { text: view.upNext ? 'Tap Next player when you\'re ready' : 'Tap See the results', tone: 'act' };
    if (view.upNext && view.upNext === view.me) return { text: 'You\'re up next in the hot seat', tone: 'wait' };
    return { text: view.upNext ? `Turn over. ${ui.name(view.upNext)} is up next` : 'Turn over. Results are next', tone: 'watch' };
  }
  if (shared) {
    if (view.phase === 'ready') return { text: `Pass to ${gName}, then tap Start the turn`, tone: 'act' };
    return { text: `Tap Got it when ${gName} says it`, tone: 'act' };
  }
  if (!view.me) return { text: `Watching: ${gName} is in the hot seat`, tone: 'watch' };
  const isG = view.role === 'guesser';
  if (view.phase === 'ready') {
    if (isG) return { text: 'Your turn: tap Start my turn', tone: 'act' };
    return { text: `Waiting for ${gName} to start their turn`, tone: 'wait' };
  }
  // play
  if (isG) return { text: 'Ask yes or no questions. No peeking', tone: 'act' };
  return { text: `Answer ${gName}. Tap Got it when they say it`, tone: 'act' };
}

// Heads Up style: a full-screen flash on every Got it and Pass tap.
let flashUi = null;
export function mount(el, view, ui) {
  flashUi = ui;
  if (el.dataset.hdFlash) return;
  el.dataset.hdFlash = '1';
  el.addEventListener('click', (e) => {
    // Only our own buttons: the surface element outlives this game in a Party Night.
    const b = e.target.closest && e.target.closest('.hd-buttons [data-act="got"], .hd-buttons [data-act="pass"]');
    if (!b || b.disabled || !flashUi || !flashUi.flash) return;
    if (b.dataset.act === 'got') flashUi.flash('Got it', 'good');
    else flashUi.flash('Pass', 'bad');
  });
}
