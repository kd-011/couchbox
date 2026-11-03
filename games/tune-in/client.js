// Tune In views. The dial is the whole game, so it gets its own small
// component (below). See docs/GAME-MODULES.md for the render contract and
// games/sketchy/client.js for the pattern this follows: a persisted DOM node
// (data-keep) painted imperatively from mount(), driven by hidden data-act
// proxy buttons, so a mid-drag gesture survives a re-render triggered by
// someone else's move (another guesser submitting, in a room).

function header(view, ui) {
  const { html } = ui;
  return html`<p class="tv-sub">Round ${view.round} of ${view.rounds}</p>`;
}

function endsRow(view, ui) {
  const { html } = ui;
  return html`<div class="ti-ends"><span class="ti-end ti-end-left">${view.spectrum.left}</span><span class="ti-end ti-end-right">${view.spectrum.right}</span></div>`;
}

// A draggable gauge: the current value (your own dial in a room, the one
// shared dial on one phone) plus the two end labels. `actionType` is the
// proxy button mount() fires on release ('setDial' in a room, 'nudgeDial' on
// one phone). The track carries data-keep so an in-progress drag survives a
// re-render pushed by somebody else's move.
function liveGauge(view, ui, actionType, value) {
  const { html } = ui;
  return html`<div class="ti-dial">
    ${endsRow(view, ui)}
    <div class="ti-track ti-track-live" data-keep="ti-track-guess" role="slider" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value}" aria-label="Dial guess" tabindex="0">
      <div class="ti-fill" style="width:${value}%"></div>
      <div class="ti-marker is-you" style="left:${value}%"><span class="ti-marker-dot"></span></div>
      <button type="button" class="ti-proxy" data-act="${actionType}" hidden aria-hidden="true" tabindex="-1"></button>
    </div>
    <p class="ti-readout">${value}</p>
  </div>`;
}

// A static, non-interactive gauge with just the target marker: the
// Psychic's own preview while they think of a clue.
function targetPreviewGauge(view, ui) {
  const { html } = ui;
  return html`<div class="ti-dial">
    ${endsRow(view, ui)}
    <div class="ti-track ti-track-static" aria-hidden="true">
      <div class="ti-marker is-target" style="left:${view.target}%"><span class="ti-marker-dot"></span><span class="ti-marker-tag">Target</span></div>
    </div>
  </div>`;
}

// A neutral gauge with no markers at all: the TV in a room during guessing,
// so the table has the spectrum for context without anyone's value leaking.
function neutralGauge(view, ui) {
  const { html } = ui;
  return html`<div class="ti-dial">
    ${endsRow(view, ui)}
    <div class="ti-track ti-track-neutral" aria-hidden="true"></div>
  </div>`;
}

// The reveal: a half-moon dial. The needle sweeps up from the left to the
// table's guess, then the scoring bands light up around the hidden target
// (okay, close, bullseye), with the band the needle landed in glowing.
const CX = 100;
const CY = 100;
const R = 92;
const ZONES = [['okay', 20], ['close', 10], ['bullseye', 3]];

function pt(v, r) {
  const a = Math.PI * (1 - Math.max(0, Math.min(100, v)) / 100);
  return `${(CX + r * Math.cos(a)).toFixed(2)} ${(CY - r * Math.sin(a)).toFixed(2)}`;
}

function wedge(a, b, r = R) {
  const lo = Math.max(0, a);
  const hi = Math.min(100, b);
  return `M${CX} ${CY}L${pt(lo, r)}A${r} ${r} 0 0 1 ${pt(hi, r)}Z`;
}

function revealGauge(view, ui) {
  const { html } = ui;
  const r = view.result;
  const zones = ZONES.map(([band, w]) => html`<path class="ti-zone ti-zone-${band} ${r.band === band ? 'lit' : ''}" d="${wedge(r.target - w, r.target + w)}"/>`);
  return html`<div class="ti-dial ti-reveal">
    <svg class="ti-arc" viewBox="0 0 200 112" role="img" aria-label="${r.finalValue} guessed, ${r.target} was the target">
      <path class="ti-arc-track" d="${wedge(0, 100)}"/>
      <g class="ti-zones">${zones}</g>
      <path class="ti-arc-tick" d="M${pt(50, R - 4)}L${pt(50, R)}"/>
      <g class="ti-needle" style="--deg:${((r.finalValue - 50) * 1.8).toFixed(1)}deg">
        <path d="M${CX} ${CY}L${CX} ${CY - R + 10}"/>
        <circle cx="${CX}" cy="${CY}" r="7"/>
      </g>
    </svg>
    ${endsRow(view, ui)}
    <p class="ti-readout">${r.finalValue} guessed &middot; ${r.target} was the target</p>
  </div>`;
}

const BAND_TEXT = {
  bullseye: 'Bullseye!',
  close: 'So close',
  okay: 'Not bad',
  miss: 'Miles off',
};

function clueHero(view, ui, label = 'Clue') {
  const { html } = ui;
  return html`<div class="ti-clue"><span>${label}</span><strong>${view.clue}</strong></div>`;
}

function winnerLine(view, ui) {
  const top = view.scores.length ? view.scores[0].score : 0;
  const tops = view.scores.filter((x) => x.score === top).map((x) => ui.name(x.id));
  if (!top) return `Final scores after ${view.round} rounds`;
  if (tops.length === 1) return `Game over: ${tops[0]} wins`;
  return `Game over: ${tops.slice(0, -1).join(', ')} and ${tops[tops.length - 1]} tie`;
}

function resultBlock(view, ui) {
  const { html } = ui;
  const r = view.result;
  return html`<div class="ti-result">
    ${clueHero(view, ui)}
    ${revealGauge(view, ui)}
    <h2 class="ti-band ti-band-${r.band}" ${!view.over && r.band === 'bullseye' ? html`data-fx="confetti" data-fx-key="ti-bull-${view.round}-${r.target}-${r.finalValue}-${view.clue}"` : ''}>${BAND_TEXT[r.band]}</h2>
    <p class="lead-line">Off by ${r.distance}${r.points ? html` &middot; <b>+${r.points}</b> each for ${ui.name(view.psychic)} and the table` : html` &middot; nobody scores this round`}</p>
    ${ui.drinks(r.drinks)}
    ${view.over ? html`<h3 class="ti-over" data-fx="confetti" data-fx-key="ti-over-${view.round}-${view.scores.map((x) => `${x.id}.${x.score}`).join('-')}">${winnerLine(view, ui)}</h3>` : ''}
    ${ui.scores(view.scores, { limit: 8 })}
  </div>`;
}

function watching(view, ui) {
  const { html } = ui;
  return html`<div class="state-card"><h2>Watching this round</h2><p>You'll be dealt in next round.</p></div>`;
}

export function player(view, ui) {
  const { html } = ui;
  if (!view.me) return watching(view, ui);
  if (view.phase === 'result') return html`<div class="tv-stage">${header(view, ui)}${resultBlock(view, ui)}</div>`;
  if (view.phase === 'clue') {
    if (view.isPsychic) {
      return html`<div class="tv-stage">
        ${header(view, ui)}
        <p class="ti-role">You're the Psychic</p>
        ${targetPreviewGauge(view, ui)}
        <form class="ti-clue-form" data-act="giveClue">
          <input class="input" type="text" name="text" placeholder="Your clue" maxlength="40" autocomplete="off" data-draft="tune-in-clue-${view.round}">
          <button class="btn btn-primary btn-xl" type="submit">Give this clue</button>
        </form>
      </div>`;
    }
    return html`<div class="tv-stage">
      ${header(view, ui)}
      <div class="ti-up">${ui.avatar(view.psychic, 88)}<h2 class="ti-big">${ui.name(view.psychic)} is thinking of a clue</h2></div>
    </div>`;
  }
  // guess (room mode only: on one phone the shared screen handles the dial)
  if (view.isPsychic) {
    return html`<div class="tv-stage">
      ${header(view, ui)}
      ${clueHero(view, ui, 'Your clue')}
      ${targetPreviewGauge(view, ui)}
      <p class="waiting-line">${ui.countdown(view.timer)}</p>
      ${ui.deadlyNote('A wild miss and you take a shot')}
    </div>`;
  }
  const pending = view.players.filter((id) => id !== view.psychic && id !== view.me && !view.submitted.includes(id));
  return html`<div class="tv-stage">
    ${header(view, ui)}
    ${clueHero(view, ui)}
    ${liveGauge(view, ui, 'setDial', view.myDial ?? 50)}
    <p class="waiting-line">${ui.countdown(view.timer)} ${view.myDial !== null
      ? html`<span class="ti-in">${ui.icon('check', 16)} Guess in. Drag again to change it</span>` : ''}</p>
    ${pending.length && view.myDial !== null ? html`<p class="tv-sub">Still guessing: ${pending.map((id) => ui.name(id)).join(', ')}</p>` : ''}
    ${ui.deadlyNote('A wild miss and the Psychic takes a shot')}
  </div>`;
}

export function tv(view, ui) {
  const { html } = ui;
  const shared = ui.surface === 'shared';
  const side = ui.surface === 'tv' && view.scores.some((x) => x.score) ? html`<aside class="tv-side">${ui.scores(view.scores, { limit: 8 })}</aside>` : '';

  if (view.phase === 'result') {
    return html`<div class="tv-stage">${resultBlock(view, ui)}</div>${side}`;
  }

  if (view.phase === 'clue') {
    // On one phone the private peek owns the screen while this phase runs;
    // a room's TV shows who everyone is waiting on.
    return html`<div class="tv-stage">
      ${header(view, ui)}
      <div class="ti-up">${ui.avatar(view.psychic, shared ? 88 : 140)}</div>
      <h2 class="tv-big">${shared ? `Pass to ${ui.name(view.psychic)}` : `${ui.name(view.psychic)} is thinking of a clue`}</h2>
    </div>${side}`;
  }

  // guess
  if (shared) {
    return html`<div class="tv-stage">
      ${header(view, ui)}
      ${clueHero(view, ui)}
      ${liveGauge(view, ui, 'nudgeDial', view.sharedDial ?? 50)}
      ${ui.deadlyNote('A wild miss and the Psychic takes a shot')}
    </div>`;
  }
  const guessers = view.players.filter((id) => id !== view.psychic);
  return html`<div class="tv-stage">
    ${header(view, ui)}
    ${clueHero(view, ui)}
    ${neutralGauge(view, ui)}
    ${ui.countdown(view.timer, { ring: true, size: 180 })}
    <p class="tv-sub">Set your dial on your phone</p>
    ${ui.roster(guessers, { mark: view.submitted })}
    ${ui.deadlyNote('A wild miss and the Psychic takes a shot')}
  </div>${side}`;
}

/* the dial drag: local-first feedback, proxy data-act */

function paintTrack(track, value) {
  track.dataset.painted = '1';
  track.dataset.lastValue = String(value);
  const fill = track.querySelector('.ti-fill');
  if (fill) fill.style.width = `${value}%`;
  const marker = track.querySelector('.ti-marker');
  if (marker) marker.style.left = `${value}%`;
  track.setAttribute('aria-valuenow', String(value));
  const readout = track.parentElement && track.parentElement.querySelector('.ti-readout');
  if (readout) readout.textContent = String(value);
}

function fireProxy(el, type, payload) {
  const btn = el.querySelector(`.ti-proxy[data-act="${type}"]`);
  if (!btn || btn.classList.contains('busy')) return;
  btn.dataset.payload = JSON.stringify(payload);
  btn.click();
}

// Interactive right now: your own dial in a room (nobody else's), or the
// shared screen's dial on one phone.
function canDragHere(view, ui) {
  if (view.phase !== 'guess') return false;
  if (view.mode === 'pass') return ui.surface === 'shared';
  return ui.surface === 'player' && !!view.me && view.me !== view.psychic;
}

export function mount(el, view, ui) {
  const track = el.querySelector('.ti-track-live');
  if (!track) return;

  // Resync the persisted node from the authoritative value, unless a local
  // gesture is mid-flight (an unrelated re-render must never snap it back).
  if (track.dataset.dragging !== '1') {
    if (view.mode === 'pass') paintTrack(track, view.sharedDial ?? 50);
    else if (view.myDial !== null && view.myDial !== undefined) paintTrack(track, view.myDial);
    else if (track.dataset.painted !== '1') paintTrack(track, 50);
  }

  if (!canDragHere(view, ui)) return;
  if (track.dataset.wired) return;
  track.dataset.wired = '1';
  track.style.touchAction = 'none';

  const valueFromEvent = (e) => {
    const rect = track.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    return Math.round(Math.max(0, Math.min(1, pct)) * 100);
  };

  let dragging = false;
  let pending = Number(track.dataset.lastValue || 50);
  let flushTimer = null;
  const live = view.mode === 'pass'; // one phone: send continuously, it's local

  const onDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    if (track.setPointerCapture) { try { track.setPointerCapture(e.pointerId); } catch { /* ignore */ } }
    track.dataset.dragging = '1';
    dragging = true;
    pending = valueFromEvent(e);
    paintTrack(track, pending);
    if (live) {
      fireProxy(el, 'nudgeDial', { value: pending });
      flushTimer = setInterval(() => fireProxy(el, 'nudgeDial', { value: pending }), 90);
    }
  };
  const onMove = (e) => {
    if (!dragging) return;
    e.preventDefault();
    pending = valueFromEvent(e);
    paintTrack(track, pending);
  };
  const onUp = (e) => {
    if (!dragging) return;
    e.preventDefault();
    dragging = false;
    delete track.dataset.dragging;
    if (live) {
      clearInterval(flushTimer);
      flushTimer = null;
      fireProxy(el, 'nudgeDial', { value: pending });
    } else {
      fireProxy(el, 'setDial', { value: pending });
    }
  };

  // Arrow keys nudge by 1 (5 with Shift); the guess sends on key release.
  track.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 5 : 1;
    const dir = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step, Home: -100, End: 100 }[e.key];
    if (dir === undefined) return;
    e.preventDefault();
    pending = Math.max(0, Math.min(100, Number(track.dataset.lastValue || 50) + dir));
    paintTrack(track, pending);
  });
  track.addEventListener('keyup', (e) => {
    if (!['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    fireProxy(el, live ? 'nudgeDial' : 'setDial', { value: pending });
  });
  track.addEventListener('pointerdown', onDown);
  track.addEventListener('pointermove', onMove);
  track.addEventListener('pointerup', onUp);
  track.addEventListener('pointercancel', onUp);
}

/* the "what do I do right now" strip */

// Never mentions the target, only the public clue and whose move it is.
function waitingFor(ids, ui) {
  if (!ids.length) return 'Waiting for the others';
  if (ids.length > 3) return `Waiting for ${ids.length} more players`;
  const names = ids.map((id) => ui.name(id));
  return `Waiting for ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`}`;
}

export function now(view, ui) {
  const psy = ui.name(view.psychic);
  if (view.phase === 'result') {
    if (ui.isHost) return { text: view.over ? 'Game over. Tap Standings when ready' : "Tap Next round when you're ready", tone: 'act' };
    return { text: view.over ? 'Game over. The host shows the standings' : 'Round over. The host starts the next one', tone: 'wait' };
  }
  if (ui.surface === 'shared') {
    if (view.phase === 'clue') return { text: `Pass the phone to ${psy}`, tone: 'act' };
    if (view.phase === 'guess') return { text: 'Agree on a spot, then tap Lock it in', tone: 'act' };
    return null;
  }
  if (!view.me) return { text: "Watching. You're dealt in next round", tone: 'watch' };
  if (view.phase === 'clue') {
    if (view.isPsychic) return { text: 'Give a clue that points at the target', tone: 'act' };
    return { text: `Waiting for ${psy}'s clue`, tone: 'wait' };
  }
  if (view.phase === 'guess') {
    if (view.mode !== 'room') return { text: 'Talk it out and set the dial together', tone: 'watch' };
    const pending = view.players.filter((id) => id !== view.psychic && !view.submitted.includes(id));
    if (view.isPsychic) return { text: waitingFor(pending, ui), tone: 'wait' };
    if (view.myDial === null || view.myDial === undefined) return { text: String(view.clue).length > 22 ? 'Set the dial for the clue' : `Set the dial for "${view.clue}"`, tone: 'act' };
    return { text: waitingFor(pending.filter((id) => id !== view.me), ui), tone: 'wait' };
  }
  return null;
}
