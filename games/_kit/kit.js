// Shared helpers for game engines. Isomorphic: imported by the server (Node)
// and by the browser for pass-and-play, so no Node or DOM APIs in here.
// Engines import it as '../_kit/kit.js', which resolves both on disk and as
// the URL /games/_kit/kit.js.

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pick(arr, rng = Math.random) {
  return arr[Math.floor(rng() * arr.length)];
}

export function sample(arr, n, rng = Math.random) {
  return shuffle(arr, rng).slice(0, n);
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

// Return this from act() to reject an action. The state is rolled back and
// the message is shown to whoever tried it.
export function fail(message) {
  return { error: message };
}

// The drink engine (tiers, tallies, Deadly moments, safety rails) and the
// Party Night hooks. Games call sip/shot/giveOut/waterfall/social, which
// record into the room's ledger and return entries for ui.drinks(list).
// See docs/GAME-MODULES.md, "Drinking".
export {
  TIERS, SHOT_SIPS, isDrinking, isDeadly, isOut,
  sip, shot, giveOut, waterfall, social,
  deadlyReady, deadlyMoment, shotRoulette, lastPlaceShot, deadlyCard,
  stat, gameOver,
  teamOf, teamSip, teamShot,
} from './drinks.js';

// A transient message for everyone ("Sam sips 1"). Put it on state.toast;
// the platform shows it once per id. Views should copy state.toast through.
let toastSeq = 0;
export function toast(state, text, kind = 'info') {
  state.toast = { id: `${Date.now().toString(36)}${(toastSeq++).toString(36)}`, text, kind };
}

export function addScore(state, playerId, n) {
  state.scores = state.scores || {};
  state.scores[playerId] = (state.scores[playerId] || 0) + n;
}

// Sorted [{ id, score }] best first, for leaderboards.
export function leaderboard(state, ids) {
  const scores = state.scores || {};
  return ids.map((id) => ({ id, score: scores[id] || 0 })).sort((a, b) => b.score - a.score);
}

// Team standings for a game that scores individuals (fake-out, wyr, mlt,
// sketchy): each team's score is the sum of its members'. A game that scores
// teams directly (quiz-show's contestants) has no need for this.
export function teamLeaderboard(state, teams) {
  const scores = state.scores || {};
  return (teams || [])
    .map((t) => ({ id: t.id, score: (t.memberIds || []).reduce((n, id) => n + (scores[id] || 0), 0) }))
    .sort((a, b) => b.score - a.score);
}

/* Timers
   A timer lives in state.timer so every view can show it and the platform
   can fire the engine's timeout action. Shape:
     { endsAt, remaining, total, paused, onEnd }
   Clients render it with ui.countdown(view.timer). */

export function startTimer(state, ms, now, onEnd = 'timeUp') {
  state.timer = { endsAt: now + ms, remaining: ms, total: ms, paused: false, onEnd };
}

export function pauseTimer(state, now) {
  const t = state.timer;
  if (!t || t.paused) return;
  t.remaining = Math.max(0, t.endsAt - now);
  t.paused = true;
}

export function resumeTimer(state, now) {
  const t = state.timer;
  if (!t || !t.paused) return;
  t.endsAt = now + t.remaining;
  t.paused = false;
}

export function addTime(state, ms, now) {
  const t = state.timer;
  if (!t) return;
  if (t.paused) t.remaining += ms;
  else t.endsAt = Math.max(t.endsAt, now) + ms;
  t.total += ms;
}

export function stopTimer(state) {
  state.timer = null;
}

// Default deadline(): fire state.timer.onEnd when a running timer runs out.
export function timerDeadline(state) {
  const t = state.timer;
  if (!t || t.paused) return null;
  return { at: t.endsAt, type: t.onEnd };
}
