// Imposter views. Pure functions of (view, ui) returning markup; buttons
// with data-act dispatch actions (see docs/GAME-MODULES.md).

// Which round's card this device has flipped, so a re-render keeps it open,
// and which it has ever opened (Got it unlocks on the first flip).
const flipped = new Set();
const opened = new Set();

// "Ben", "Ben and Cy", "Ben, Cy and Dee"; null past three names or when
// it would not fit the status strip.
function nameList(ids, ui) {
  if (!ids.length || ids.length > 3) return null;
  const n = ids.map((id) => ui.name(id));
  const s = n.length === 1 ? n[0] : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
  return s.length > 30 ? null : s;
}

// A short stable key for a confetti moment.
function fxKey(...parts) {
  let h = 0;
  for (const c of parts.join('|')) h = (h * 31 + c.charCodeAt(0)) | 0;
  return `imp-${(h >>> 0).toString(36)}`;
}

function card(view, ui) {
  const { html } = ui;
  const c = view.card;
  const key = `${view.round}:${view.me}`;
  // One phone: the "I'm Ana, show me" gate already confirmed who is
  // looking, so the card opens itself instead of needing a second tap.
  const auto = ui.mode === 'pass' && !opened.has(key);
  if (auto) { flipped.add(key); opened.add(key); }
  const back = c.role === 'imposter'
    ? html`<div class="imp-face imp-back is-imposter">
        <span class="imp-role">You are the</span>
        <strong class="imp-word">Imposter</strong>
        <span class="imp-cat">Category: ${c.category}</span>
      </div>`
    : html`<div class="imp-face imp-back">
        <span class="imp-role">The word is</span>
        <strong class="imp-word">${c.word}</strong>
        <span class="imp-cat">${c.category}</span>
      </div>`;
  return html`<button class="imp-card ${flipped.has(key) ? 'flipped' : ''} ${auto ? 'auto-flip' : ''}" data-flip="${key}" aria-label="Your secret card. Tap to flip.">
    <span class="imp-inner">
      <span class="imp-face imp-front"><span class="imp-mark">?</span><span class="imp-front-cta">${ui.icon('eye', 22)} Tap to see your card</span></span>
      ${back}
    </span>
  </button>`;
}

function peek(view, ui) {
  const { html } = ui;
  const c = view.card;
  return html`<button class="imp-peek" data-peek aria-label="Hold to peek at your card">
    <span class="peek-hide">${ui.icon('eyeOff', 20)} Hold to peek</span>
    <span class="peek-show">${c.role === 'imposter' ? html`<b>Imposter</b> · ${c.category}` : html`<b>${c.word}</b> · ${c.category}`}</span>
  </button>`;
}

function outcome(view, ui) {
  const { html } = ui;
  const r = view.result;
  const many = r.imposters.length > 1;
  const names = r.imposters.map((id) => ui.name(id)).join(' and ');
  const headline = r.crewWin ? 'Caught' : r.accused ? 'Wrong person' : 'Nobody voted out';
  const sub = r.crewWin
    ? `${ui.name(r.accused)} was ${many ? 'an' : 'the'} imposter.`
    : r.accused ? `${ui.name(r.accused)} was innocent. ${names} got away with it.` : `${names} got away with it.`;
  const votes = Object.entries(r.votes || {});
  // The platform throws confetti at game over; a caught imposter mid-game is ours.
  const fx = r.crewWin && !view.over ? fxKey('caught', view.round, r.word, r.accused) : '';
  return html`<div class="imp-result ${r.crewWin ? 'win' : 'lose'}">
    <h2 class="imp-headline" ${fx ? ui.raw(`data-fx="confetti" data-fx-key="${fx}"`) : ''}>${headline}</h2>
    <p class="imp-sub">${sub}</p>
    <div class="imp-reveal">
      <div class="imp-reveal-word"><span>The word</span><strong>${r.word}</strong></div>
      <div class="imp-reveal-who"><span>Imposter${many ? 's' : ''}</span><strong class="imp-who">${r.imposters.map((id) => html`<span>${ui.avatar(id, 44)} ${ui.name(id)}</span>`)}</strong></div>
    </div>
    ${votes.length ? html`<ul class="imp-votes">${votes.map(([v, t]) => html`<li>${ui.avatar(v, 24)}<span>${ui.name(v)}</span>${ui.icon('back', 14)}<span class="${r.imposters.includes(t) ? 'hit' : 'miss'}">${ui.name(t)}</span></li>`)}</ul>` : ''}
    ${ui.drinks(r.drinks)}
    ${view.scores ? html`<h3 class="sec">${view.over ? `Final scores after ${view.round} rounds` : `Scores after round ${view.round} of ${view.rounds}`}</h3>${ui.scores(view.scores)}` : ''}
    ${ui.surface === 'tv' && !view.over ? html`<p class="waiting-line">Next round when the host is ready</p>` : ''}
  </div>`;
}

export function player(view, ui) {
  const { html } = ui;
  if (!view.me) {
    if (view.phase === 'result' && view.result) {
      return html`${outcome(view, ui)}<p class="waiting-line">${ui.icon('users', 18)} You are in from the next round</p>`;
    }
    return html`<div class="state-card">
      ${ui.icon('users', 36)}
      <h2>You are in from the next round</h2>
      <p>Round ${view.round} is under way. Hang tight.</p>
    </div>`;
  }
  switch (view.phase) {
    case 'reveal': {
      const key = `${view.round}:${view.me}`;
      const markup = card(view, ui); // first: on one phone it opens the card
      const ready = opened.has(key);
      return html`<div class="imp-stage">
        ${markup}
        ${view.seenMe
          ? html`<div class="waiting-line">${ui.icon('check', 18)} Got it. ${view.seen.length} of ${view.players.length} ready</div>
                 ${ui.mode === 'room' ? ui.roster(view.players, { mark: view.seen, size: 28 }) : ''}`
          : html`<button class="btn btn-primary btn-xl" data-act="seen" data-ready-label="${ui.mode === 'pass' ? 'Got it, hide my card' : 'Got it'}" ${ready ? '' : 'disabled'}>${ready ? (ui.mode === 'pass' ? 'Got it, hide my card' : 'Got it') : 'Flip your card first'}</button>`}
      </div>`;
    }
    case 'discuss':
      return html`<div class="imp-stage">
        ${ui.countdown(view.timer, { ring: true, size: 240 })}
        <p class="lead-line big">${ui.avatar(view.firstSpeaker, 44)} <span><b>${ui.name(view.firstSpeaker)}</b> goes first</span></p>
        ${peek(view, ui)}
      </div>`;
    case 'vote':
      return html`<div class="imp-stage">
        <h2 class="q">Who is the imposter?</h2>
        <div class="pick-grid">
          ${view.players.filter((id) => id !== view.me).map((id) => html`<button class="pick ${view.myVote === id ? 'on' : ''}" data-act="vote" data-arg="${id}" aria-pressed="${view.myVote === id}">
            ${ui.avatar(id, 56)}<span>${ui.name(id)}</span></button>`)}
        </div>
        <div class="waiting-line">${view.myVote ? html`${ui.icon('check', 18)} Vote in for ${ui.name(view.myVote)}. ` : ''}${view.voted.length} of ${view.players.length} voted</div>
        ${ui.deadlyNote('Vote out the imposter and they take a shot')}
        ${peek(view, ui)}
      </div>`;
    case 'result':
      return outcome(view, ui);
    default:
      return '';
  }
}

export function tv(view, ui) {
  const { html } = ui;
  const scores = view.scores && ui.surface === 'tv' ? html`<aside class="tv-side">${ui.scores(view.scores, { limit: 8 })}</aside>` : '';
  switch (view.phase) {
    case 'reveal':
      return html`<div class="tv-stage">
        <h2 class="tv-big">Check your card</h2>
        <p class="tv-sub">Round ${view.round} of ${view.rounds} · ${view.category}${view.impostersCount > 1 ? ` · ${view.impostersCount} imposters` : ''}</p>
        ${ui.roster(view.players, { mark: view.seen })}
      </div>${scores}`;
    case 'discuss':
      return html`<div class="tv-stage">
        ${ui.countdown(view.timer, { ring: true, size: ui.surface === 'tv' ? 360 : 220 })}
        <p class="lead-line big">${ui.avatar(view.firstSpeaker, 44)} <span><b>${ui.name(view.firstSpeaker)}</b> goes first</span></p>
        <p class="tv-sub">${view.category} · one word each, round the circle</p>
      </div>${scores}`;
    case 'vote':
      if (ui.surface === 'shared') {
        return html`<div class="tv-stage">
          <h2 class="q">Who got voted out?</h2>
          <div class="pick-grid">
            ${view.players.map((id) => html`<button class="pick" data-act="accuse" data-arg="${id}" data-confirm="Vote out ${ui.name(id)}?">${ui.avatar(id, 44)}<span>${ui.name(id)}</span></button>`)}
          </div>
          <button class="btn btn-secondary" data-act="accuse" data-payload="null" data-confirm="Nobody voted out?">It was a tie</button>
          ${ui.deadlyNote('Vote out the imposter and they take a shot')}
        </div>`;
      }
      return html`<div class="tv-stage">
        <h2 class="tv-big">Vote on your phone</h2>
        ${ui.roster(view.players, { mark: view.voted })}
        ${ui.deadlyNote('Vote out the imposter and they take a shot')}
      </div>${scores}`;
    case 'result':
      return html`<div class="tv-stage tv-result">${outcome({ ...view, scores: ui.surface === 'tv' ? null : view.scores }, ui)}</div>${scores}`;
    default:
      return '';
  }
}

export function mount(el) {
  const c = el.querySelector('[data-flip]');
  if (c && !c.dataset.wired) {
    c.dataset.wired = '1';
    c.addEventListener('click', () => {
      const k = c.dataset.flip;
      if (flipped.has(k)) flipped.delete(k); else flipped.add(k);
      opened.add(k);
      c.classList.remove('auto-flip');
      c.classList.toggle('flipped');
      const got = el.querySelector('[data-act="seen"][disabled]');
      if (got) { got.disabled = false; got.textContent = got.dataset.readyLabel || 'Got it'; }
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
}

// The one-line "what do I do now" strip under the top bar on phones.
export function now(view, ui) {
  const shared = ui.surface === 'shared';
  const over = view.phase === 'result' && view.over;
  if (view.phase === 'result') {
    if (shared || ui.isHost) return { text: over ? 'Game over. Tap Standings when ready' : 'Tap Next round when you\'re ready', tone: 'act' };
    if (!view.me) return { text: 'You\'re in from the next round', tone: 'wait' };
    return { text: over ? 'Game over. Host shows the standings' : 'Round over. Host starts the next one', tone: 'watch' };
  }
  if (!shared && !view.me) return { text: 'You\'re in from the next round', tone: 'wait' };
  const first = ui.name(view.firstSpeaker);
  switch (view.phase) {
    case 'reveal': {
      if (shared) return { text: 'Pass the phone round to check cards', tone: 'wait' };
      if (!view.seenMe) {
        return ui.mode === 'pass'
          ? { text: 'Remember your card, then tap Got it', tone: 'act' }
          : { text: 'Tap your card to see it, then Got it', tone: 'act' };
      }
      const left = view.players.filter((id) => !view.seen.includes(id));
      if (!left.length) return { text: 'Everyone\'s ready. Starting the talk', tone: 'wait' };
      const names = nameList(left, ui);
      return { text: names ? `Waiting for ${names} to check` : `Waiting for ${left.length} more to check`, tone: 'wait' };
    }
    case 'discuss':
      if (!shared && view.me === view.firstSpeaker) return { text: 'You go first: say one word about it', tone: 'act' };
      return { text: `Out loud: ${first} goes first, one word each`, tone: 'watch' };
    case 'vote': {
      if (shared || ui.mode === 'pass') return { text: 'Vote out loud, then tap who went out', tone: 'act' };
      if (!view.myVote) return { text: 'Vote for the imposter', tone: 'act' };
      const left = view.players.filter((id) => !view.voted.includes(id));
      if (!left.length) return { text: 'Vote in. Counting the votes', tone: 'wait' };
      const names = nameList(left, ui);
      return { text: names ? `Vote in. Waiting for ${names}` : `Vote in. Waiting for ${left.length} more votes`, tone: 'wait' };
    }
    default:
      return null;
  }
}
