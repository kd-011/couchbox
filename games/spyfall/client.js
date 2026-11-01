// Spyfall views. Pure functions of (view, ui) returning markup; buttons
// with data-act dispatch actions (see docs/GAME-MODULES.md).

// Which round's card this device has flipped / opened the guess panel on,
// so a re-render (the discuss timer ticks every second) keeps it open.
const flipped = new Set();
const guessOpen = new Set();

function card(view, ui) {
  const { html } = ui;
  const c = view.card;
  const key = `${view.round}:${view.me}`;
  const back = c.role === 'spy'
    ? html`<div class="sf-face sf-back is-spy">
        <span class="sf-role">You are the</span>
        <strong class="sf-loc">Spy</strong>
        <span class="sf-sub">You don't know the location. Blend in, and listen for it.</span>
      </div>`
    : html`<div class="sf-face sf-back">
        <span class="sf-role">The location is</span>
        <strong class="sf-loc">${c.location.label}</strong>
        <span class="sf-sub">You are the ${c.roleName}</span>
      </div>`;
  return html`<button class="sf-card ${flipped.has(key) ? 'flipped' : ''}" data-flip="${key}" aria-label="Your secret card. Tap to flip.">
    <span class="sf-inner">
      <span class="sf-face sf-front">${ui.icon('eye', 40)}<span>Tap to see your card</span></span>
      ${back}
    </span>
  </button>`;
}

function peek(view, ui) {
  const { html } = ui;
  const c = view.card;
  return html`<button class="sf-peek" data-peek aria-label="Hold to peek at your card">
    <span class="peek-hide">${ui.icon('eyeOff', 20)} Hold to peek</span>
    <span class="peek-show">${c.role === 'spy' ? html`<b>Spy</b> · no location` : html`<b>${c.location.label}</b> · ${c.roleName}`}</span>
  </button>`;
}

function locationGrid(view, ui) {
  const { html } = ui;
  return html`<div class="pick-grid sf-loc-grid">
    ${view.locations.map((l) => html`<button class="pick" data-act="spyGuess" data-arg="${l.key}" data-confirm="Guess ${l.label}? Get it wrong and you're caught.">${l.label}</button>`)}
  </div>`;
}

function outcome(view, ui) {
  const { html } = ui;
  const r = view.result;
  const spyName = ui.name(r.spyId);
  const headline = r.spyWins ? 'The spy wins' : 'Spy caught';
  const subs = {
    voluntaryCorrect: `${spyName} named ${r.location.label} outright.`,
    voluntaryWrong: `${spyName} guessed wrong and gave themself away.`,
    wrongAccusation: `${r.accusedId ? ui.name(r.accusedId) : 'Nobody'} wasn't the spy. ${spyName} slipped away.`,
    lastChanceCorrect: `${spyName} named ${r.location.label} with seconds to spare.`,
    lastChanceWrong: `${spyName} couldn't name the location in time.`,
  };
  const roleRows = Object.entries(r.roles || {});
  // One burst per moment: the game ending, else the crew catching the spy.
  const fxKey = `sf-${view.over ? 'over' : 'caught'}-${view.round}-${r.spyId}-${r.location.key}`;
  const fx = view.over || !r.spyWins ? html` data-fx="confetti" data-fx-key="${fxKey}"` : '';
  return html`<div class="sf-result ${r.spyWins ? 'lose' : 'win'}">
    <h2 class="sf-headline"${fx}>${headline}</h2>
    <p class="sf-sub2">${subs[r.reason] || ''}</p>
    <div class="sf-reveal">
      <div><span>The location</span><strong>${r.location.label}</strong></div>
      <div><span>The spy</span><strong class="sf-who">${ui.avatar(r.spyId, 28)} ${spyName}</strong></div>
    </div>
    ${roleRows.length ? html`<ul class="sf-roles">${roleRows.map(([id, role], i) => html`<li style="--i:${i}">${ui.avatar(id, 24)}<span>${ui.name(id)}</span><span class="role">${role}</span></li>`)}</ul>` : ''}
    ${ui.drinks(r.drinks)}
    ${view.scores ? html`<h3 class="sec">${view.over ? `Final scores after ${view.round} rounds` : `Scores after round ${view.round} of ${view.rounds}`}</h3>${ui.scores(view.scores)}` : ''}
  </div>`;
}

export function player(view, ui) {
  const { html } = ui;
  if (!view.me) {
    return html`<div class="state-card">
      ${ui.icon('users', 36)}
      <h2>You are in from the next round</h2>
      <p>Round ${view.round} is under way. Hang tight.</p>
    </div>`;
  }
  switch (view.phase) {
    case 'reveal':
      return html`<div class="sf-stage">
        ${card(view, ui)}
        ${view.seenMe
          ? html`<div class="waiting-line">${ui.icon('check', 18)} ${view.seen.length} of ${view.players.length} ready</div>
                 ${ui.mode === 'room' ? ui.roster(view.players, { mark: view.seen, size: 28 }) : ''}`
          : html`<button class="btn btn-primary btn-xl" data-act="seen">${ui.mode === 'pass' ? 'Got it, hide my card' : 'Got it'}</button>`}
      </div>`;
    case 'discuss': {
      const isSpy = view.card.role === 'spy';
      const canGuessNow = isSpy && ui.mode === 'room';
      const key = `${view.round}:${view.me}`;
      const open = guessOpen.has(key);
      return html`<div class="sf-stage">
        ${ui.countdown(view.timer, { ring: true, size: 200 })}
        ${canGuessNow ? html`<div class="sf-guess-wrap ${open ? 'open' : ''}" data-key="${key}">
          <button class="btn btn-amber sf-guess-btn" data-guess-open>${ui.icon('eye', 18)} I know it</button>
          <div class="sf-guess-panel">
            <h3 class="sec">Name the location. Wrong and you're caught</h3>
            ${locationGrid(view, ui)}
            <button class="btn btn-ghost" data-guess-cancel>Never mind, keep listening</button>
          </div>
        </div>` : ''}
        ${peek(view, ui)}
      </div>`;
    }
    case 'vote':
      return html`<div class="sf-stage">
        <h2 class="q">Who is the spy?</h2>
        <div class="pick-grid">
          ${view.players.filter((id) => id !== view.me).map((id) => html`<button class="pick ${view.myVote === id ? 'on' : ''}" data-act="vote" data-arg="${id}" aria-pressed="${view.myVote === id}">
            ${ui.avatar(id, 44)}<span>${ui.name(id)}</span></button>`)}
        </div>
        <div class="waiting-line">${view.myVote ? html`${ui.icon('check', 18)} Vote in, tap again to change.` : ''} ${view.voted.length} of ${view.players.length} voted</div>
        ${ui.deadlyNote('Caught and stumped, the spy takes a shot')}
        ${peek(view, ui)}
      </div>`;
    case 'spyLastChance': {
      if (view.card.role === 'spy') {
        return html`<div class="sf-stage">
          <h2 class="sf-last">Caught. Last chance</h2>
          ${ui.countdown(view.timer, { ring: true, size: 150 })}
          ${locationGrid(view, ui)}
        </div>`;
      }
      return html`<div class="sf-stage">
        <h2 class="sf-last">${ui.name(view.accused)} was the spy</h2>
        ${ui.countdown(view.timer, { ring: true, size: 180 })}
        ${ui.deadlyNote('Guess wrong and the spy takes a shot')}
      </div>`;
    }
    case 'result':
      return outcome(view, ui);
    default:
      return '';
  }
}

export function tv(view, ui) {
  const { html } = ui;
  const scores = view.scores && view.scores.some((x) => x.score) && ui.surface === 'tv' ? html`<aside class="tv-side">${ui.scores(view.scores, { limit: 8 })}</aside>` : '';
  switch (view.phase) {
    case 'reveal':
      return html`<div class="tv-stage">
        <h2 class="tv-big">Check your phone</h2>
        <p class="tv-sub">Round ${view.round} of ${view.rounds}</p>
        ${ui.roster(view.players, { mark: view.seen })}
      </div>${scores}`;
    case 'discuss':
      return html`<div class="tv-stage">
        ${ui.countdown(view.timer, { ring: true, size: ui.surface === 'tv' ? 300 : 200 })}
        ${ui.surface === 'tv' ? html`<p class="tv-sub">Ask questions in character. Shout when you want a vote.</p>` : ''}
        <ul class="sf-board" aria-label="Possible locations">${view.locations.map((l, i) => html`<li style="--i:${i}">${l.label}</li>`)}</ul>
      </div>${scores}`;
    case 'vote':
      if (ui.surface === 'shared') {
        return html`<div class="tv-stage">
          <h2 class="q">Who got voted out?</h2>
          <div class="pick-grid">
            ${view.players.map((id) => html`<button class="pick" data-act="accuse" data-arg="${id}" data-confirm="Vote out ${ui.name(id)}?">${ui.avatar(id, 44)}<span>${ui.name(id)}</span></button>`)}
          </div>
          <button class="btn btn-secondary" data-act="accuse" data-payload="null" data-confirm="Nobody voted out?">It was a tie</button>
          ${ui.deadlyNote('Caught and stumped, the spy takes a shot')}
        </div>`;
      }
      return html`<div class="tv-stage">
        <h2 class="tv-big">Vote on your phone</h2>
        ${ui.roster(view.players, { mark: view.voted })}
        ${ui.deadlyNote('Caught and stumped, the spy takes a shot')}
      </div>${scores}`;
    case 'spyLastChance':
      return html`<div class="tv-stage">
        <h2 class="sf-last">${ui.name(view.accused)} was the spy</h2>
        ${ui.countdown(view.timer, { ring: true, size: ui.surface === 'tv' ? 320 : 200 })}
        ${ui.surface === 'tv' ? html`<p class="tv-sub">One last guess at the location</p>` : ''}
        ${ui.deadlyNote('Guess wrong and the spy takes a shot')}
      </div>${scores}`;
    case 'result':
      return html`<div class="tv-stage tv-result">${outcome({ ...view, scores: ui.surface === 'tv' ? null : view.scores }, ui)}</div>${scores}`;
    default:
      return '';
  }
}

export function mount(el, view) {
  const c = el.querySelector('[data-flip]');
  if (c && !c.dataset.wired) {
    c.dataset.wired = '1';
    c.addEventListener('click', () => {
      const k = c.dataset.flip;
      if (flipped.has(k)) flipped.delete(k); else flipped.add(k);
      c.classList.toggle('flipped');
      navigator.vibrate && navigator.vibrate(8);
    });
  }
  const p = el.querySelector('[data-peek]');
  if (p && !p.dataset.wired) {
    p.dataset.wired = '1';
    const on = (e) => { e.preventDefault(); p.classList.add('show'); };
    const off = () => p.classList.remove('show');
    p.addEventListener('pointerdown', on);
    p.addEventListener('pointerup', off);
    p.addEventListener('pointerleave', off);
    p.addEventListener('pointercancel', off);
    p.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') on(e); });
    p.addEventListener('keyup', off);
  }
  const wrap = el.querySelector('.sf-guess-wrap');
  if (wrap && !wrap.dataset.wired) {
    wrap.dataset.wired = '1';
    const key = wrap.dataset.key || `${view.round}:${view.me}`;
    wrap.querySelector('[data-guess-open]')?.addEventListener('click', () => {
      guessOpen.add(key);
      wrap.classList.add('open');
    });
    wrap.querySelector('[data-guess-cancel]')?.addEventListener('click', () => {
      guessOpen.delete(key);
      wrap.classList.remove('open');
    });
  }
}

// The one-line "what do I do right now" strip under the top bar on phones.
// Never says anything this device's view does not already show: in
// particular nothing here differs between the spy and the crew until the
// spy is public (spyLastChance), so a glance at the strip outs nobody.
function waitingFor(ids, ui) {
  if (!ids.length) return 'Waiting for the others';
  if (ids.length > 3) return `Waiting for ${ids.length} more players`;
  const names = ids.map((id) => ui.name(id));
  return `Waiting for ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`}`;
}

function resultNow(view, ui) {
  if (ui.isHost) return { text: view.over ? 'Game over. Tap Standings when ready' : "Tap Next round when you're ready", tone: 'act' };
  return { text: view.over ? 'Game over. The host shows the standings' : 'Round over. The host starts the next one', tone: 'wait' };
}

export function now(view, ui) {
  if (ui.surface === 'shared') {
    switch (view.phase) {
      case 'reveal': return { text: 'Pass the phone round to check cards', tone: 'act' };
      case 'discuss': return { text: 'Ask each other questions out loud', tone: 'watch' };
      case 'vote': return { text: 'Vote out loud, then tap who went out', tone: 'act' };
      case 'spyLastChance': return { text: `Hand the phone to ${ui.name(view.accused)}`, tone: 'act' };
      case 'result': return resultNow(view, ui);
      default: return null;
    }
  }
  if (!view.me) return { text: "Watching. You're dealt in next round", tone: 'watch' };
  switch (view.phase) {
    case 'reveal':
      if (!view.seenMe) return { text: 'Flip your card, then tap Got it', tone: 'act' };
      return { text: waitingFor(view.players.filter((id) => !view.seen.includes(id)), ui), tone: 'wait' };
    case 'discuss':
      return { text: 'Ask each other questions out loud', tone: 'watch' };
    case 'vote':
      if (ui.mode !== 'room') return { text: 'Vote out loud', tone: 'watch' };
      if (!view.myVote) return { text: 'Vote for who you think is the spy', tone: 'act' };
      return { text: waitingFor(view.players.filter((id) => !view.voted.includes(id)), ui), tone: 'wait' };
    case 'spyLastChance':
      if (view.me === view.spyId) return { text: 'Name the location before time runs out', tone: 'act' };
      return { text: `${ui.name(view.accused)} gets one last guess`, tone: 'watch' };
    case 'result':
      return resultNow(view, ui);
    default:
      return null;
  }
}
