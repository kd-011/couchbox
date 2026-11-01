// Renders a game's client.js output into the page and wires it up. Used by
// the room screen, the TV and the pass-and-play runner, so a game behaves
// the same everywhere. What a client.js gets for free (docs/GAME-MODULES.md):
//   data-act="type"  (+ data-arg="str" or data-payload='json') on a button
//                    dispatches that action, with busy state and haptics
//   data-confirm="question?" asks first
//   <form data-act="type"> submits its fields as the payload object
//   data-keep="key"  keeps that DOM node (canvas, typed input) across renders
//   data-draft="key" on an input persists it to localStorage until sent
//   view.toast {id,text,kind} shows once per id
import * as ui from './ui.js';
import * as sfx from './sfx.js';
import * as fx from './fx.js';
import { morph } from './morph.js';

// onPhase(phase, prev) fires when the view's phase changes (sounds, wipes).
export function createSurface(el, { act, onPhase = null }) {
  let lastMarkup = null;
  let lastPhase = null;
  let current = null; // { client, fn, view, api }
  const seenToasts = new Set();

  async function dispatch(type, payload, btn) {
    if (btn) {
      if (btn.classList.contains('busy')) return;
      btn.classList.add('busy');
      btn.setAttribute('aria-busy', 'true');
    }
    ui.haptic('tap');
    sfx.blip();
    const r = await act(type, payload);
    if (btn && btn.isConnected) {
      btn.classList.remove('busy');
      btn.removeAttribute('aria-busy');
    }
    if (r && r.error) {
      ui.haptic('warn');
      sfx.bad();
      ui.toast(r.error, 'error', r.detail || '');
      if (btn && btn.isConnected) {
        btn.classList.add('shake');
        setTimeout(() => btn.classList.remove('shake'), 400);
      }
    }
    return r;
  }

  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || !el.contains(btn) || btn.tagName === 'FORM' || btn.disabled) return;
    e.preventDefault();
    if (btn.dataset.confirm && !(await ui.confirm(btn.dataset.confirm, { ok: btn.dataset.confirmOk || 'Yes', danger: btn.classList.contains('btn-danger') }))) return;
    let payload = null;
    if (btn.dataset.payload !== undefined) {
      try { payload = JSON.parse(btn.dataset.payload); } catch { payload = null; }
    } else if (btn.dataset.arg !== undefined) {
      payload = btn.dataset.arg;
    }
    dispatch(btn.dataset.act, payload, btn);
  });

  el.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[data-act]');
    if (!form) return;
    e.preventDefault();
    const payload = {};
    for (const [k, v] of new FormData(form).entries()) payload[k] = typeof v === 'string' ? v : '';
    const submit = form.querySelector('[type=submit]');
    const r = await dispatch(form.dataset.act, payload, submit);
    if (!r || !r.error) {
      for (const input of form.querySelectorAll('[data-draft]')) localStorage.removeItem(`games.draft.${input.dataset.draft}`);
    }
  });

  el.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.draft) localStorage.setItem(`games.draft.${t.dataset.draft}`, t.value);
  });

  function render(client, fn, view, api) {
    current = { client, fn, view, api };
    let markup;
    try {
      markup = String(client[fn](view, api) ?? '');
    } catch (err) {
      console.error(err);
      markup = String(ui.html`<div class="state-card"><h2>This screen hit a bug</h2><p class="err-detail">${String(err && err.message || err)}</p></div>`);
    }
    if (view && view.toast && view.toast.id && !seenToasts.has(view.toast.id)) {
      // Only toasts that arrive after the first render are news.
      if (lastMarkup !== null) ui.toast(view.toast.text, view.toast.kind || 'info');
      seenToasts.add(view.toast.id);
    }
    const phase = view && view.phase;
    if (markup === lastMarkup) return;

    // Preserve what the player is in the middle of: kept nodes, typed text, focus.
    const kept = new Map();
    for (const n of el.querySelectorAll('[data-keep]')) kept.set(n.dataset.keep, n);
    const typed = new Map();
    for (const n of el.querySelectorAll('input[name], textarea[name]')) {
      if (n.type !== 'radio' && n.type !== 'checkbox' && n.value !== n.defaultValue) typed.set(n.name, n.value);
    }
    const active = document.activeElement;
    const focusKey = active && el.contains(active) ? (active.name || active.id || null) : null;
    const sel = focusKey && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;

    const firstPaint = lastMarkup === null;
    // The entry animation belongs to a phase change. Within a phase the screen
    // is rebuilt for every answer that lands; leaving the class on would
    // replay the fade, lift and blur on the whole screen each time.
    // Same story for the nodes themselves: patch what changed. A client with
    // a mount() hook binds listeners to its nodes, so it keeps the full rebuild.
    const samePhase = !firstPaint && phase === lastPhase;
    if (samePhase) el.classList.remove('phase-in');
    if (samePhase && typeof client.mount !== 'function') morph(el, markup);
    else el.innerHTML = markup;
    lastMarkup = markup;

    for (const n of el.querySelectorAll('[data-keep]')) {
      const old = kept.get(n.dataset.keep);
      if (old) n.replaceWith(old);
    }
    for (const n of el.querySelectorAll('input[name], textarea[name]')) {
      if (typed.has(n.name) && !n.closest('[data-keep]')) n.value = typed.get(n.name);
      else if (n.dataset.draft && !n.value) {
        const d = localStorage.getItem(`games.draft.${n.dataset.draft}`);
        if (d) n.value = d;
      }
    }
    if (focusKey) {
      const f = el.querySelector(`[name="${CSS.escape(focusKey)}"], #${CSS.escape(focusKey)}`);
      if (f) {
        f.focus({ preventScroll: true });
        if (sel && 'setSelectionRange' in f) try { f.setSelectionRange(sel[0], sel[1]); } catch { /* not a text input */ }
      }
    }
    if (phase !== lastPhase) {
      el.classList.remove('phase-in');
      void el.offsetWidth; // restart the entry animation
      el.classList.add('phase-in');
      if (onPhase && lastPhase !== null) try { onPhase(phase, lastPhase); } catch { /* cosmetic */ }
      lastPhase = phase;
    }
    // Celebrations a client asked for (data-fx="confetti"), once per key.
    const accent = getComputedStyle(el).getPropertyValue('--accent').trim();
    fx.fromMarkup(el, [accent || '#9d7bff', '#ffb347', '#f7f3ff', ...(api.players || []).map((p) => p.color).slice(0, 6)], { silent: firstPaint });
    if (typeof client.mount === 'function') {
      try { client.mount(el, view, api); } catch (err) { console.error(err); }
    }
  }

  function reset() {
    lastMarkup = null;
    lastPhase = null;
    el.innerHTML = '';
  }

  return { render, reset, dispatch, get current() { return current; } };
}

// Build the `ui` object a client.js receives. ctx:
//   { surface: 'player'|'tv'|'shared', me, players, hostId, isHost, mode,
//     variant, act }
export function makeApi(ctx) {
  const byId = new Map((ctx.players || []).map((p) => [p.id, p]));
  const player = (id) => byId.get(id) || null;
  const name = (id) => (byId.get(id) || {}).name || 'Someone';
  return {
    ...ctx,
    interactive: ctx.surface !== 'tv',
    html: ui.html,
    raw: ui.raw,
    esc: ui.esc,
    icon: ui.icon,
    plural: ui.plural,
    player,
    name,
    avatar: (idOrPlayer, size = 40) => ui.avatar(typeof idOrPlayer === 'string' ? player(idOrPlayer) : idOrPlayer, size),
    countdown: ui.countdown,
    haptic: ui.haptic,
    toast: ui.toast,
    // Full-screen colour flash with one big word: ui.flash('Correct', 'good').
    // Only call it from an event handler (a tap), never from a render.
    flash: ui.flash,
    // Is any drinking on (Drinking or Deadly)? Is it Deadly?
    tier: ctx.variant,
    drinking: ctx.variant === 'drinking' || ctx.variant === 'deadly',
    deadly: ctx.variant === 'deadly',
    // Telegraph a Deadly rule before it lands ("Deadly: a caught imposter
    // takes a shot"). Renders nothing outside the Deadly tier.
    deadlyNote(text) {
      return ctx.variant === 'deadly' ? ui.html`<p class="deadly-note">${ui.icon('skull', 16)}<span>${text}</span></p>` : ui.raw('');
    },
    // Drink entries from the drink API: [{ playerId, n, unit, why, text? }].
    // Nulls (Standard tier) are skipped.
    drinks(list, opts = {}) {
      list = (list || []).filter(Boolean);
      if (!list.length) return ui.raw('');
      // One row per player and kind: "Cy drinks 3" not "Cy drinks 2", "Cy drinks 1".
      const merged = [];
      for (const d of list) {
        const mergeable = d.unit === 'sip' || d.unit === 'give' || d.unit === 'shot';
        const same = mergeable && merged.find((m) => m.playerId === d.playerId && m.unit === d.unit);
        if (same) { same.n += d.n; same.why = [...new Set([same.why, d.why].filter(Boolean))].join(', '); }
        else merged.push({ ...d });
      }
      const mark = (d) => {
        if (d.unit === 'shot') return ui.icon('shot', 26);
        if (d.unit === 'forfeit') return ui.icon('flag', 24);
        if (d.unit === 'waterfall' || d.unit === 'social') return ui.icon('glass', 24);
        return d.unit === 'give' ? `+${d.n}` : d.n;
      };
      const rows = merged.map((d) => ui.html`<li class="drink drink-${d.unit}">
        ${d.playerId ? ui.avatar(player(d.playerId), 36) : ui.html`<span class="drink-all">${ui.icon('users', 20)}</span>`}
        <div><strong>${ui.drinkLine(d, name(d.playerId))}</strong>${d.unit === 'forfeit'
          ? ui.html`<span class="forfeit-text">${d.text}</span>${d.why ? ui.html`<span>instead of a drink · ${d.why}</span>` : ''}`
          : d.why ? ui.html`<span>${d.why}</span>` : ''}</div>
        <span class="drink-n" aria-hidden="true">${mark(d)}</span></li>`);
      return ui.html`<ul class="drinks ${opts.big ? 'drinks-big' : ''}">${rows}</ul>`;
    },
    // Standard-variant leaderboard: list of { id, score }.
    scores(list, opts = {}) {
      if (!list || !list.length) return ui.raw('');
      // Nobody has scored yet: a table of zeros all ranked 1 says nothing.
      if (ctx.surface === 'tv' && !opts.always && list.every((r) => !r.score)) return ui.raw('');
      const top = list[0].score;
      // Ties share a rank: 1, 1, 3.
      const rows = list.slice(0, opts.limit || 99).map((r) => ui.html`<li class="${r.score === top && top > 0 ? 'lead' : ''}">
        <span class="rank">${1 + list.filter((x) => x.score > r.score).length}</span>${ui.avatar(player(r.id), 32)}<span class="nm">${name(r.id)}</span><span class="pts">${r.score}</span></li>`);
      return ui.html`<ol class="scores">${rows}</ol>`;
    },
    // A row of player chips; opts.mark: Set/array of ids to tick.
    roster(ids, opts = {}) {
      const mark = new Set(opts.mark || []);
      return ui.html`<ul class="roster">${(ids || []).map((id) => ui.html`<li class="${mark.has(id) ? 'on' : ''}">${ui.avatar(player(id), opts.size || 34)}<span>${name(id)}</span>${mark.has(id) ? ui.icon('check', 16) : ''}</li>`)}</ul>`;
    },
  };
}
