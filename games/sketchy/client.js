// Sketchy views. See docs/GAME-MODULES.md for the contract and the "canvas"
// section of the sketchy build notes for how strokes get from the drawer's
// finger to everyone else's screen.
//
// mount(el, view, ui) has no direct way to send a server action: only
// data-act elements, wired by the platform's click/submit delegation on
// `el`, can do that (see public/js/surface.js). So the pointer handlers
// below drive three hidden data-act proxy buttons (startStroke, addPoints,
// endStroke) rendered inside the live canvas board, re-queried fresh on
// every pointer event since a render can replace them at any time (the
// canvas node itself survives via data-keep, these do not need to).

const COLORS = ['#1f2430', '#ff5d73', '#51cf66', '#4dabf7', '#ffb347', '#ffffff'];
const WIDTHS = [3, 6, 11];

const DRAWER_NOTE = 'If nobody gets it, you take a shot';
const GUESSER_NOTE = 'Never guess one right all game: shot at the end';

// "Ben", "Ben and Cy", "Ana, Ben and Cy".
function nameList(ids, ui) {
  const n = ids.map((id) => ui.name(id));
  return n.length < 2 ? n.join('') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

// Ask the platform for one confetti burst, once per key.
function confetti(ui, key) {
  return ui.raw(`data-fx="confetti" data-fx-key="${ui.esc(key)}"`);
}

const lastTurn = (view) => !view.upNext;

// The one-line "what do I do now" strip the platform shows under the top
// bar on phones. Never called for the room TV. The word only ever appears
// here when this view already carries it (the drawer's own screen).
export function now(view, ui) {
  const drawer = ui.name(view.drawer);
  if (view.phase === 'final') {
    return ui.isHost ? { text: 'Game over. Tap Play again for another', tone: 'act' } : { text: 'Game over. Check the final scores', tone: 'watch' };
  }
  if (view.phase === 'turnEnd') {
    if (ui.isHost) return { text: lastTurn(view) ? 'Tap See the results when you are ready' : 'Tap Next drawer when you are ready', tone: 'act' };
    if (lastTurn(view)) return { text: 'Last turn done. Host shows the results', tone: 'watch' };
    if (view.me && view.upNext === view.me) return { text: 'You draw next. Get ready', tone: 'wait' };
    return { text: `Turn over. ${ui.name(view.upNext)} draws next`, tone: 'watch' };
  }
  if (ui.surface === 'shared') {
    if (view.phase === 'ready') return { text: `Pass the phone to ${drawer}`, tone: 'act' };
    return { text: `${drawer} draws. Tap whoever shouts it out`, tone: 'act' };
  }
  if (view.role === 'drawer') {
    if (view.phase === 'ready') return { text: 'Remember your word, then start drawing', tone: 'act' };
    return { text: view.word ? `Draw: ${view.word}` : 'Draw your word. Nobody can see it', tone: 'act' };
  }
  if (!view.me && !view.audience) return { text: `Watch ${drawer} draw`, tone: 'watch' };
  if (view.phase === 'ready') {
    return view.audience ? { text: `${drawer} draws next. Guess for fun`, tone: 'wait' } : { text: `${drawer} draws next. Get ready to guess`, tone: 'wait' };
  }
  if (view.audience) {
    return view.gotIt ? { text: 'You got it. Watch the rest', tone: 'watch' } : { text: `Type what ${drawer} is drawing`, tone: 'act' };
  }
  if (!view.gotIt) return { text: `Type what ${drawer} is drawing`, tone: 'act' };
  const left = view.players.filter((id) => id !== view.drawer && id !== view.me && !view.correctIds.includes(id));
  const named = `You got it. Waiting for ${nameList(left, ui)}`;
  return { text: left.length <= 3 && named.length <= 48 ? named : `You got it. ${left.length} still guessing`, tone: 'wait' };
}

function turnLabel(view) {
  const rot = view.rotations > 1 ? ` · lap ${view.rotation} of ${view.rotations}` : '';
  return `Turn ${view.turnNo} of ${view.turnsTotal}${rot}`;
}

// A drawable surface can be interacted with right now: the drawer on their
// own phone in a room, or the shared phone once control has come back to it
// in pass and play (the private "peek at the word" step always happens via
// playerView first, so by the time tv() renders the draw phase on the shared
// screen it IS the drawer's turn to use it).
function canDrawHere(view, ui) {
  if (view.phase !== 'draw') return false;
  if (ui.surface === 'shared') return true;
  return ui.surface === 'player' && view.role === 'drawer';
}

function canvasBoard(view, ui, interactive) {
  const { html } = ui;
  const v = `${view.canvas.strokes.length}-${view.canvas.live ? view.canvas.live.points.length : 0}`;
  return html`<div class="skt-board ${interactive ? 'is-live' : ''}">
    <canvas class="skt-canvas" data-keep="canvas" data-v="${v}" aria-label="Drawing canvas"></canvas>
    ${interactive ? html`
      <button type="button" class="skt-proxy" data-act="startStroke" hidden aria-hidden="true" tabindex="-1"></button>
      <button type="button" class="skt-proxy" data-act="addPoints" hidden aria-hidden="true" tabindex="-1"></button>
      <button type="button" class="skt-proxy" data-act="endStroke" hidden aria-hidden="true" tabindex="-1"></button>
    ` : ''}
  </div>`;
}

function toolbar(ui) {
  const { html } = ui;
  return html`<div class="skt-tools">
    <div class="skt-swatches" role="group" aria-label="Colour">
      ${COLORS.map((c, i) => html`<button type="button" class="skt-swatch ${i === 0 ? 'on' : ''}" data-color="${c}" style="--c:${c}" aria-label="Colour"></button>`)}
    </div>
    <div class="skt-widths" role="group" aria-label="Pen size">
      ${WIDTHS.map((w, i) => html`<button type="button" class="skt-width ${i === 1 ? 'on' : ''}" data-width="${w}" aria-label="Pen size"><span style="--w:${w}px"></span></button>`)}
    </div>
    <button type="button" class="btn btn-ghost skt-clear" data-act="clearCanvas">Clear</button>
  </div>`;
}

function recap(view, ui) {
  const { html } = ui;
  const r = view.recap;
  return html`<div class="skt-recap">
    <p class="tv-sub">The word was</p>
    <h2 class="skt-word-reveal" ${r.correct.length ? confetti(ui, `skt-got-${view.gameKey}-${view.rotation}-${view.turnNo}`) : ''}>${r.lastWord}</h2>
    ${r.correct.length
      ? html`<ol class="skt-got-list">${r.correct.map((c, i) => html`<li>${ui.avatar(c.id, 32)}<span>${ui.name(c.id)}</span><b>+${c.points}</b>${i === 0 ? html`<span class="skt-first">first</span>` : ''}</li>`)}</ol>`
      : html`<p class="waiting-line">Nobody got it that turn.</p>`}
    ${ui.drinks(r.drinks)}
    <p class="skt-next">${lastTurn(view)
    ? 'That was the last turn. The results are next.'
    : html`Next to draw: ${ui.avatar(view.upNext, 28)} <b>${ui.name(view.upNext)}</b>`}</p>
    ${ui.surface !== 'tv' ? html`<h3 class="sec">Scores</h3>${ui.scores(view.scores, { limit: 8 })}` : ''}
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

function final(view, ui) {
  const { html } = ui;
  const board = view.final.board;
  const best = board.length ? board[0].score : 0;
  const tops = board.filter((r) => r.score === best);
  const headline = best === 0 ? 'Game over'
    : tops.length === 1 ? `${ui.name(tops[0].id)} wins`
      : tops.length === board.length ? 'Dead heat' : `${tops.map((r) => ui.name(r.id)).join(' and ')} tie`;
  return html`<div class="skt-final">
    <div class="winner" ${best > 0 ? confetti(ui, `skt-final-${view.gameKey}`) : ''}>${best > 0 && tops.length < board.length ? html`<div class="winner-avs">${tops.map((r) => ui.avatar(r.id, 72))}</div>` : ''}<h2>${headline}</h2></div>
    ${ui.scores(view.final.board)}
    ${teamBoard(view, ui)}
    ${ui.drinks(view.final.drinks)}
  </div>`;
}

export function player(view, ui) {
  const { html } = ui;
  if (view.phase === 'final') return final(view, ui);
  if (view.phase === 'turnEnd') return recap(view, ui);
  if (!view.me && !view.audience) {
    return html`<div class="state-card">${ui.avatar(view.drawer, 56)}<h2>${ui.name(view.drawer)} is drawing</h2><p>You are watching this one.</p></div>`;
  }
  const isDrawer = view.role === 'drawer';
  if (view.phase === 'ready') {
    return isDrawer
      ? html`<div class="skt-stage">
          <p class="tv-sub">${turnLabel(view)}</p>
          <div class="skt-secret">
            <p class="skt-prompt">${ui.icon('eyeOff', 16)} Your secret word</p>
            <h2 class="skt-word">${view.word}</h2>
          </div>
          ${ui.deadlyNote(DRAWER_NOTE)}
          <button class="btn btn-primary btn-xl" data-act="start">Got it, start drawing</button>
        </div>`
      : html`<div class="skt-stage">
          <p class="tv-sub">${turnLabel(view)}</p>
          <div class="skt-spot">${ui.avatar(view.drawer, 96)}</div>
          <h2 class="skt-you">${ui.name(view.drawer)} draws next</h2>
          ${view.neverGot.includes(view.me) ? ui.deadlyNote(GUESSER_NOTE) : ''}
        </div>`;
  }
  // draw
  const live = canDrawHere(view, ui);
  if (isDrawer) {
    return html`<div class="skt-draw">
      <div class="skt-top">${ui.countdown(view.timer)}<span>${view.correctCount} of ${view.eligibleCount} got it</span></div>
      ${canvasBoard(view, ui, live)}
      ${toolbar(ui)}
      ${view.correctCount ? '' : ui.deadlyNote(DRAWER_NOTE)}
    </div>`;
  }
  return html`<div class="skt-draw">
    <div class="skt-top">${ui.avatar(view.drawer, 28)} <span>${ui.name(view.drawer)} is drawing</span>${ui.countdown(view.timer)}</div>
    ${view.audience ? html`<p class="waiting-line">${ui.icon('users', 16)} From the crowd: guess for fun, no drinks either way.</p>` : ''}
    ${canvasBoard(view, ui, live)}
    ${view.gotIt
      ? html`<p class="waiting-line">${ui.icon('check', 18)} Got it!${view.audience ? '' : html` Waiting on ${Math.max(0, view.eligibleCount - view.correctCount)} more.`}</p>`
      : html`${view.lastMiss ? html`<p class="skt-miss" role="status">Not "${view.lastMiss.text}". Keep guessing.</p>` : ''}
        <form class="skt-guess" data-act="${view.audience ? 'audienceGuess' : 'guess'}" data-miss="${view.lastMiss ? `${view.rotation}-${view.turnNo}-${view.lastMiss.n}` : ''}">
          <input class="input" type="text" name="text" placeholder="Type your guess" autocomplete="off" data-draft="sketchy-guess-${view.rotation}-${view.turnNo}">
          <button class="btn btn-primary" type="submit">Guess</button>
        </form>`}
    ${view.audience ? '' : html`<p class="skt-count">${view.correctCount} of ${view.eligibleCount} got it</p>`}
    ${!view.audience && !view.gotIt && view.neverGot.includes(view.me) ? ui.deadlyNote(GUESSER_NOTE) : ''}
  </div>`;
}

export function tv(view, ui) {
  const { html } = ui;
  const shared = ui.surface === 'shared';
  const side = ui.surface === 'tv' ? html`<aside class="tv-side">${ui.scores(view.scores, { limit: 8 })}</aside>` : '';
  if (view.phase === 'final') return html`<div class="tv-stage">${final(view, ui)}</div>`;
  if (view.phase === 'turnEnd') return html`<div class="tv-stage">${recap(view, ui)}</div>${side}`;
  if (view.phase === 'ready') {
    return html`<div class="tv-stage">
      <p class="tv-sub">${turnLabel(view)}</p>
      ${ui.avatar(view.drawer, shared ? 88 : 140)}
      <h2 class="tv-big">${shared ? `Pass the phone to ${ui.name(view.drawer)}` : `${ui.name(view.drawer)} is drawing next`}</h2>
      <p class="lead-line">${shared ? 'They look at the word alone, then hand it back to start.' : 'Get ready to guess.'}</p>
      ${ui.deadlyNote(`Nobody gets ${ui.name(view.drawer)}'s drawing: ${ui.name(view.drawer)} takes a shot`)}
    </div>${side}`;
  }
  // draw
  const live = canDrawHere(view, ui);
  if (shared) {
    const guessers = view.players.filter((id) => id !== view.drawer);
    return html`<div class="skt-draw skt-shared">
      <div class="skt-top">${ui.countdown(view.timer)}<span>${view.correctCount} of ${view.eligibleCount} got it</span></div>
      ${canvasBoard(view, ui, live)}
      ${toolbar(ui)}
      ${view.correctCount ? '' : ui.deadlyNote(`Nobody gets it: ${ui.name(view.drawer)} takes a shot`)}
      <p class="sec">Tap who shouted it out</p>
      <div class="skt-chips">
        ${guessers.map((id) => html`<button type="button" class="pick skt-chip ${view.correctIds.includes(id) ? 'on' : ''}" data-act="markGot" data-arg="${id}" ${view.correctIds.includes(id) ? 'disabled' : ''}>
          ${ui.avatar(id, 36)}<span>${ui.name(id)}</span>${view.correctIds.includes(id) ? ui.icon('check', 16) : ''}</button>`)}
      </div>
    </div>`;
  }
  return html`<div class="tv-stage">
    ${ui.countdown(view.timer, { ring: true, size: 180 })}
    <div class="lead-line big">${ui.avatar(view.drawer, 44)} <span><b>${ui.name(view.drawer)}</b> is drawing · ${view.correctCount} of ${view.eligibleCount} got it</span></div>
    ${canvasBoard(view, ui, false)}
    <p class="tv-sub">Guess on your phone</p>
    ${view.correctCount ? '' : ui.deadlyNote(`Nobody gets it: ${ui.name(view.drawer)} takes a shot`)}
  </div>${side}`;
}

// Draw every stroke from scratch, scaling the 0-1000 virtual space to the
// canvas's actual backing-store pixel size. Called on every render, which is
// cheap even for a few thousand points on a 2D context.
function paint(canvas, view) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const sx = canvas.width / 1000;
  const sy = canvas.height / 1000;
  const strokes = view.canvas.live ? [...view.canvas.strokes, view.canvas.live] : view.canvas.strokes;
  for (const s of strokes) {
    if (!s.points.length) continue;
    ctx.beginPath();
    ctx.strokeStyle = s.color;
    ctx.lineWidth = Math.max(1, s.width * Math.min(sx, sy));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const [x0, y0] = s.points[0];
    ctx.moveTo(x0 * sx, y0 * sy);
    if (s.points.length === 1) ctx.lineTo(x0 * sx + 0.1, y0 * sy + 0.1);
    for (let i = 1; i < s.points.length; i++) {
      const [x, y] = s.points[i];
      ctx.lineTo(x * sx, y * sy);
    }
    ctx.stroke();
  }
}

// Fire a server action through a hidden data-act proxy button, re-found on
// every call: a render can swap it out from under a long-lived pointer
// gesture (only the canvas itself survives renders, via data-keep).
function fireProxy(el, type, payload) {
  const btn = el.querySelector(`.skt-proxy[data-act="${type}"]`);
  if (!btn || btn.classList.contains('busy')) return;
  if (payload === undefined) delete btn.dataset.payload;
  else btn.dataset.payload = JSON.stringify(payload);
  btn.click();
}

export function mount(el, view, ui) {
  // A wrong guess came back: empty the box so the next one starts clean.
  const guessForm = el.querySelector('.skt-guess[data-miss]');
  if (guessForm && guessForm.dataset.miss && el.dataset.sktMiss !== guessForm.dataset.miss) {
    el.dataset.sktMiss = guessForm.dataset.miss;
    const input = guessForm.querySelector('input[name="text"]');
    if (input) input.value = '';
  }
  const canvas = el.querySelector('.skt-canvas');
  if (!canvas) return;
  paint(canvas, view);

  if (!canDrawHere(view, ui)) return;

  // Local pen state lives on the canvas node so it survives re-renders (the
  // node itself is preserved by data-keep).
  if (canvas.dataset.pen === undefined) canvas.dataset.pen = JSON.stringify({ color: COLORS[0], width: WIDTHS[1] });
  // A re-render redraws the toolbar with its defaults: show the pen in hand.
  const held = JSON.parse(canvas.dataset.pen);
  el.querySelectorAll('.skt-swatch').forEach((b) => b.classList.toggle('on', b.dataset.color === held.color));
  el.querySelectorAll('.skt-width').forEach((b) => b.classList.toggle('on', Number(b.dataset.width) === held.width));

  for (const btn of el.querySelectorAll('.skt-swatch')) {
    if (btn.dataset.wired) continue;
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => {
      const pen = JSON.parse(canvas.dataset.pen);
      pen.color = btn.dataset.color;
      canvas.dataset.pen = JSON.stringify(pen);
      el.querySelectorAll('.skt-swatch').forEach((b) => b.classList.toggle('on', b === btn));
    });
  }
  for (const btn of el.querySelectorAll('.skt-width')) {
    if (btn.dataset.wired) continue;
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => {
      const pen = JSON.parse(canvas.dataset.pen);
      pen.width = Number(btn.dataset.width);
      canvas.dataset.pen = JSON.stringify(pen);
      el.querySelectorAll('.skt-width').forEach((b) => b.classList.toggle('on', b === btn));
    });
  }

  if (canvas.dataset.wired) return;
  canvas.dataset.wired = '1';
  canvas.style.touchAction = 'none';

  let drawing = false;
  let batch = [];
  let flushTimer = null;
  let localLive = null; // drawn immediately for zero-latency local feedback

  const toVirtual = (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 1000);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 1000);
    return [Math.max(0, Math.min(1000, x)), Math.max(0, Math.min(1000, y))];
  };

  const drawLocalSegment = () => {
    const pts = localLive.points;
    if (pts.length < 2) return;
    const ctx = canvas.getContext('2d');
    const sx = canvas.width / 1000;
    const sy = canvas.height / 1000;
    ctx.beginPath();
    ctx.strokeStyle = localLive.color;
    ctx.lineWidth = Math.max(1, localLive.width * Math.min(sx, sy));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const [px, py] = pts[pts.length - 2];
    const [cx, cy] = pts[pts.length - 1];
    ctx.moveTo(px * sx, py * sy);
    ctx.lineTo(cx * sx, cy * sy);
    ctx.stroke();
  };

  const flush = () => {
    if (!batch.length) return;
    fireProxy(el, 'addPoints', { points: batch });
    batch = [];
  };

  const onDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ } }
    const pen = JSON.parse(canvas.dataset.pen);
    drawing = true;
    const p = toVirtual(e);
    localLive = { points: [p], color: pen.color, width: pen.width };
    batch = [];
    fireProxy(el, 'startStroke', { color: pen.color, width: pen.width });
    flushTimer = setInterval(flush, 100);
  };
  const onMove = (e) => {
    if (!drawing) return;
    e.preventDefault();
    const p = toVirtual(e);
    localLive.points.push(p);
    batch.push(p);
    drawLocalSegment();
  };
  const onUp = (e) => {
    if (!drawing) return;
    e.preventDefault();
    drawing = false;
    clearInterval(flushTimer);
    flushTimer = null;
    flush();
    fireProxy(el, 'endStroke', undefined);
    localLive = null;
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
}
