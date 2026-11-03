// The drink engine: one ledger per room (or one-phone night) that every game
// writes to through these calls, instead of making up its own sip text.
// Isomorphic like the rest of _kit: no Node, no DOM, no Date.now().
//
// Tiers (state.variant):
//   standard  no drinking. Every call here returns null and records nothing.
//   drinking  sips. A shot() becomes SHOT_SIPS sips.
//   deadly    sips plus shots, as rare, telegraphed moments (a TV takeover).
//
// Safety rails live here, not in the games:
//   - a shot cap per player per rolling hour (host-set; over it, sips instead)
//   - a water-break nudge every WATER_EVERY sips per player, and one for the
//     whole table every GROUP_WATER_MS
//   - "I'm out": that player's drinks come back as forfeits
//   - the host can drop the tier mid-game (the platform rewrites state.variant)
//   - random Deadly events are at least MOMENT_GAP_MS apart
//
// The ledger lives on state.$drink while a game runs. The runtime stamps the
// clock on it before every action and settles it after (turns queued shots
// into one Deadly moment, emits water nudges). Between games the room keeps
// it, so tallies carry across a whole Party Night.

export const TIERS = ['standard', 'drinking', 'deadly'];
export const SHOT_SIPS = 3;
export const DEFAULT_SHOT_CAP = 2;
export const MAX_SHOT_CAP = 5;
export const WATER_EVERY = 10;
export const GROUP_WATER_MS = 45 * 60_000;
export const MOMENT_GAP_MS = 3 * 60_000;
export const MOMENT_SHOW_MS = 20_000;
const HOUR = 60 * 60_000;

// Original forfeits for players who are out. Props are welcome.
export const FORFEITS = [
  'Do 10 star jumps',
  'Hold a plank for 20 seconds',
  'Balance a spoon on your nose for 5 seconds',
  'Talk in an accent the group picks until your next turn',
  'Sing the chorus of the last song you listened to',
  'Swap one sock with the player on your left',
  'Do your best impression of someone in the room',
  'Speak only in questions until your next turn',
  'Pay every player a one-line compliment',
  'Wear something from the table as a hat until the next game',
  'Read the back of the nearest packet like a movie trailer',
  'Give a 20-second talk on a topic the group picks',
  'Stand on one leg until your next turn',
  'Hum a song until someone guesses it',
  'Do 5 push-ups (knees count)',
  'Fetch a glass of water for anyone who wants one',
  'Commentate the next round like a sports broadcaster',
  'Hold an ice cube until it melts or your next turn',
  'Do the robot for 10 seconds',
  'Let the player on your right restyle your hair',
  'Tell the group your most embarrassing school moment',
  'Swap seats with a player the group picks',
  'Say the alphabet backwards from M',
  'Hold a wall sit for 20 seconds',
  'Do a slow-motion replay of your last turn',
  'Serenade the player on your left for 10 seconds',
  'Talk without showing your teeth until your next turn',
  'Build a tower from three things on the table',
];

export function newLedger({ tier = 'standard', shotCap = DEFAULT_SHOT_CAP, now = 0 } = {}) {
  return {
    tier: TIERS.includes(tier) ? tier : 'standard',
    shotCap: clampCap(shotCap),
    out: {},          // id -> true: drinks become forfeits
    tally: {},        // id -> { sips, shots, gives, forfeits }
    shotTimes: {},    // id -> [t, ...] shots in the last hour
    sinceWater: {},   // id -> sips since their last water nudge
    groupWaterAt: now,
    lastMoment: null, // when the last Deadly moment fired
    moment: null,     // the latest Deadly moment (TV takeover)
    nudges: [],       // recent water nudges [{ id, playerIds, text, at }]
    pending: [],      // shots queued this action, settled into one moment
    seq: 0,
    mark: 0,
    now,
  };
}

export function clampCap(n) {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(MAX_SHOT_CAP, Math.max(0, v)) : DEFAULT_SHOT_CAP;
}

// The ledger for this state, created on first use (engines in unit tests run
// without the runtime).
export function ledgerOf(state) {
  if (!state.$drink) state.$drink = newLedger({ tier: state.variant });
  const l = state.$drink;
  if (TIERS.includes(state.variant)) l.tier = state.variant;
  return l;
}

const tierOf = (state) => (TIERS.includes(state.variant) ? state.variant : 'standard');
export const isDrinking = (state) => tierOf(state) !== 'standard';
export const isDeadly = (state) => tierOf(state) === 'deadly';
export const isOut = (state, id) => !!(state.$drink && state.$drink.out[id]);

export function playerIdsOf(state) {
  return (state.players || []).map((p) => (typeof p === 'string' ? p : p && p.id)).filter(Boolean);
}

function tallyOf(l, id) {
  if (!l.tally[id]) l.tally[id] = { sips: 0, shots: 0, gives: 0, forfeits: 0 };
  return l.tally[id];
}

function nextSeq(l) {
  l.seq += 1;
  return l.seq;
}

function nudge(l, playerIds, text) {
  const id = `w${nextSeq(l)}`;
  l.nudges = [...l.nudges.slice(-4), { id, playerIds, text, at: l.now }];
}

function addSips(l, id, n) {
  tallyOf(l, id).sips += n;
  l.sinceWater[id] = (l.sinceWater[id] || 0) + n;
  if (l.sinceWater[id] >= WATER_EVERY) {
    l.sinceWater[id] = 0;
    nudge(l, [id], 'Water break: @{0}, have a glass of water before your next drink.');
  }
}

function forfeit(l, id, n, why) {
  tallyOf(l, id).forfeits += 1;
  const text = FORFEITS[(nextSeq(l) * 7) % FORFEITS.length];
  return { playerId: id, n, unit: 'forfeit', why, text };
}

// the drink event API (what games call)

// `id` drinks n sips. Returns a drink entry for your result list, or null in
// Standard. Render lists with ui.drinks(list); nulls are skipped.
export function sip(state, id, n = 1, why = '') {
  if (!isDrinking(state) || !id) return null;
  const l = ledgerOf(state);
  n = Math.max(1, Math.round(n));
  if (l.out[id]) return forfeit(l, id, n, why);
  addSips(l, id, n);
  return { playerId: id, n, unit: 'sip', why };
}

// `id` hands out n sips to whoever they like (out loud). Counts for nothing
// against the giver; tracked so the recap knows who was generous.
export function giveOut(state, id, n = 1, why = '') {
  if (!isDrinking(state) || !id) return null;
  const l = ledgerOf(state);
  n = Math.max(1, Math.round(n));
  tallyOf(l, id).gives += n;
  return { playerId: id, n, unit: 'give', why };
}

// `id` takes a shot. Only Deadly pours shots: in Drinking it is SHOT_SIPS
// sips, over the hourly cap it is sips with a note, and for a player who is
// out it is a forfeit. Every real shot queues a Deadly moment (TV takeover)
// that the runtime fires once the action finishes, so three shots at once
// are one moment, not three.
export function shot(state, id, why = '') {
  if (!isDrinking(state) || !id) return null;
  const l = ledgerOf(state);
  if (l.out[id]) {
    // Out players still get their moment, with a forfeit instead of a shot.
    const f = forfeit(l, id, 1, why);
    if (isDeadly(state)) l.pending.push({ playerId: id, text: `does a forfeit: ${f.text}`, why });
    return f;
  }
  if (!isDeadly(state)) return sip(state, id, SHOT_SIPS, why);
  const recent = (l.shotTimes[id] || []).filter((t) => l.now - t < HOUR);
  if (recent.length >= l.shotCap) {
    l.shotTimes[id] = recent;
    const e = sip(state, id, SHOT_SIPS, why ? `${why} (shot cap reached, sips instead)` : 'shot cap reached, sips instead');
    l.pending.push({ playerId: id, text: `drinks ${SHOT_SIPS} instead (shot cap)`, why });
    return e;
  }
  l.shotTimes[id] = [...recent, l.now];
  tallyOf(l, id).shots += 1;
  l.sinceWater[id] = (l.sinceWater[id] || 0) + SHOT_SIPS;
  if (l.sinceWater[id] >= WATER_EVERY) {
    l.sinceWater[id] = 0;
    nudge(l, [id], 'Water break: @{0}, have a glass of water before your next drink.');
  }
  l.pending.push({ playerId: id, text: 'takes a shot', why });
  return { playerId: id, n: 1, unit: 'shot', why };
}

// Waterfall: everyone starts drinking with `starterId`, and nobody stops
// before the person on their right. Tallied as 2 sips each.
export function waterfall(state, starterId, why = '') {
  if (!isDrinking(state)) return null;
  const l = ledgerOf(state);
  for (const id of playerIdsOf(state)) if (!l.out[id]) addSips(l, id, 2);
  return { playerId: starterId || null, n: 0, unit: 'waterfall', why };
}

// Social: the whole table drinks n together.
export function social(state, n = 1, why = '') {
  if (!isDrinking(state)) return null;
  const l = ledgerOf(state);
  n = Math.max(1, Math.round(n));
  for (const id of playerIdsOf(state)) if (!l.out[id]) addSips(l, id, n);
  return { playerId: null, n, unit: 'social', why };
}

// teams
// A team is { id, name, color, memberIds }. Only meaningful for engines that
// declare meta.teams: true; everyone else never sees state.teams (it stays
// null). Find the team a player belongs to, or null (solo / not on one).
export function teamOf(teams, playerId) {
  return (teams || []).find((t) => t.memberIds.includes(playerId)) || null;
}

// Every member of `team` drinks n sips together (not a Deadly event; use
// teamShot for the dramatic version). Returns the drink entries.
export function teamSip(state, team, n = 1, why = '') {
  if (!team) return [];
  return (team.memberIds || []).map((id) => sip(state, id, n, why)).filter(Boolean);
}

// The whole team takes a shot together: a team shot is a Deadly event, one
// takeover naming the team, not each member separately. In Drinking (not
// Deadly) it falls back to everyone sipping SHOT_SIPS, same as shot().
export function teamShot(state, team, why = '') {
  if (!team || !isDrinking(state)) return [];
  if (!isDeadly(state)) return teamSip(state, team, SHOT_SIPS, why);
  const l = ledgerOf(state);
  const entries = [];
  const lines = [];
  for (const id of team.memberIds || []) {
    const before = l.pending.length;
    const e = shot(state, id, why);
    if (e) entries.push(e);
    if (l.pending.length > before) {
      const p = l.pending.pop();
      lines.push({ playerId: p.playerId, text: p.text });
    }
  }
  if (lines.length) deadlyMoment(state, { kind: 'shot', title: `${team.name} takes shots`, sub: why, targets: lines.map((x) => x.playerId), lines });
  return entries;
}

// Deadly moments

// True when a random or optional Deadly event may fire now: Deadly tier and
// at least MOMENT_GAP_MS since the last one. Rule-based shots (the ones your
// meta.variants.deadly line promises) do not need to check this.
export function deadlyReady(state) {
  if (!isDeadly(state)) return false;
  const l = ledgerOf(state);
  return l.lastMoment === null || l.now - l.lastMoment >= MOMENT_GAP_MS;
}

// Fire a big telegraphed moment on every screen. `lines` are
// [{ playerId, text }]; `text` may mention players as @{index-into-targets}.
// kind: 'shot' | 'roulette' | 'last' | 'card' | 'streak' | 'water'.
export function deadlyMoment(state, { kind = 'card', title, sub = '', text = '', targets = [], candidates = [], lines = [] }) {
  const l = ledgerOf(state);
  const m = { id: `m${nextSeq(l)}`, seq: l.seq, kind, title: String(title || 'Deadly'), sub, text, targets, candidates, lines, at: l.now };
  l.moment = m;
  if (kind !== 'water') l.lastMoment = l.now;
  return m;
}

// Spin the Shot Roulette wheel over `candidates`; whoever it lands on takes
// a shot. Returns the drink entries (empty outside Deadly).
export function shotRoulette(state, candidates, why = '', rng = Math.random, { title = 'Shot Roulette', sub = '' } = {}) {
  const pool = (candidates || []).filter(Boolean);
  if (!isDeadly(state) || !pool.length) return [];
  const l = ledgerOf(state);
  const target = pool[Math.floor(rng() * pool.length)];
  const before = l.pending.length;
  const e = shot(state, target, why);
  const line = l.pending[before] || { playerId: target, text: 'takes a shot', why };
  l.pending = l.pending.slice(0, before);
  deadlyMoment(state, { kind: 'roulette', title, sub: sub || why, targets: [target], candidates: pool, lines: [{ playerId: target, text: line.text }] });
  return e ? [e] : [];
}

// Whoever has the lowest score in `board` ([{ id, score }]) takes a shot; a
// tie for last spins the roulette between them.
export function lastPlaceShot(state, board, why = 'last place', rng = Math.random) {
  if (!isDeadly(state) || !board || board.length < 2) return [];
  const low = Math.min(...board.map((r) => r.score));
  if (board.every((r) => r.score === low)) return [];
  const last = board.filter((r) => r.score === low).map((r) => r.id);
  if (last.length > 1) return shotRoulette(state, last, why, rng, { title: 'Last Place', sub: `Tied for last: the wheel decides` });
  const e = shot(state, last[0], why);
  const l = ledgerOf(state);
  const line = l.pending.pop() || { playerId: last[0], text: 'takes a shot' };
  deadlyMoment(state, { kind: 'last', title: 'Last Place', sub: why, targets: [last[0]], lines: [{ playerId: last[0], text: line.text }] });
  return e ? [e] : [];
}

const CARDS = [
  { key: 'roulette', weight: 3 },
  { key: 'poppy', weight: 2 },
  { key: 'waterfall', weight: 2 },
  { key: 'social', weight: 2 },
  { key: 'mercy', weight: 1 },
];
export const CARD_CHANCE = 0.35;

// Between rounds, maybe draw a Deadly card. Call it once whenever your game
// moves to its next round; it fires about one round in three and never
// within MOMENT_GAP_MS of the last moment. Returns the moment or null.
export function deadlyCard(state, rng = Math.random, { chance = CARD_CHANCE } = {}) {
  if (!deadlyReady(state)) return null;
  if (rng() >= chance) return null;
  const ids = playerIdsOf(state);
  if (ids.length < 2) return null;
  const total = CARDS.reduce((s, c) => s + c.weight, 0);
  let r = rng() * total;
  const card = CARDS.find((c) => (r -= c.weight) < 0) || CARDS[0];
  const l = ledgerOf(state);
  if (card.key === 'roulette') {
    shotRoulette(state, ids, 'Deadly card', rng, { title: 'Shot Roulette', sub: 'Deadly card: the wheel picks one of you' });
  } else if (card.key === 'poppy') {
    const scores = state.scores || {};
    const top = Math.max(...ids.map((id) => scores[id] || 0));
    const leaders = ids.filter((id) => (scores[id] || 0) === top);
    if (top <= 0 || leaders.length === ids.length) {
      shotRoulette(state, ids, 'Deadly card', rng, { title: 'Shot Roulette', sub: 'Deadly card: the wheel picks one of you' });
    } else if (leaders.length > 1) {
      shotRoulette(state, leaders, 'Tall Poppy', rng, { title: 'Tall Poppy', sub: 'Joint leaders: the wheel picks which one' });
    } else {
      const e = shot(state, leaders[0], 'Tall Poppy');
      const line = l.pending.pop() || { text: 'takes a shot' };
      deadlyMoment(state, { kind: 'card', title: 'Tall Poppy', sub: 'Deadly card: whoever is winning takes a shot', targets: [leaders[0]], lines: [{ playerId: leaders[0], text: line.text }] });
    }
  } else if (card.key === 'waterfall') {
    const starter = ids[Math.floor(rng() * ids.length)];
    waterfall(state, starter, 'Deadly card');
    deadlyMoment(state, { kind: 'card', title: 'Waterfall', sub: 'Deadly card', text: 'It starts with @{0}. Everyone joins in, and nobody stops before the person on their right.', targets: [starter] });
  } else if (card.key === 'social') {
    social(state, 2, 'Deadly card');
    deadlyMoment(state, { kind: 'card', title: 'Social', sub: 'Deadly card', text: 'Everybody drinks 2. Together. Now.', targets: [] });
  } else {
    deadlyMoment(state, { kind: 'water', title: 'Mercy Round', sub: 'Deadly card', text: 'Water round: everyone has a glass of water before the next round.', targets: [] });
    l.groupWaterAt = l.now;
  }
  return l.moment;
}

// platform hooks (the runtime and rooms call these)

// Before an action: stamp the clock and remember where this action starts.
export function beginDrinks(state, now) {
  if (!state.$drink) return;
  const l = state.$drink;
  l.now = now;
  l.mark = l.seq;
  l.pending = [];
}

// After an action: queued shots become one Deadly moment (or join the one
// the game fired this action), and the table gets its periodic water nudge.
export function settleDrinks(state, now) {
  if (!state.$drink) return;
  const l = state.$drink;
  l.now = now;
  if (l.pending.length) {
    const fresh = l.moment && l.moment.seq > l.mark ? l.moment : null;
    if (fresh) {
      for (const p of l.pending) {
        if (!fresh.targets.includes(p.playerId)) {
          fresh.targets.push(p.playerId);
          fresh.lines.push({ playerId: p.playerId, text: p.text });
        }
      }
    } else {
      const whys = [...new Set(l.pending.map((p) => p.why).filter(Boolean))];
      deadlyMoment(state, {
        kind: 'shot',
        title: l.pending.length > 1 ? 'Shots' : 'Shot',
        sub: whys.join(' · '),
        targets: l.pending.map((p) => p.playerId),
        lines: l.pending.map((p) => ({ playerId: p.playerId, text: p.text })),
      });
    }
    l.pending = [];
  }
  if (l.tier !== 'standard' && now - l.groupWaterAt >= GROUP_WATER_MS) {
    l.groupWaterAt = now;
    nudge(l, [], 'Water break for the whole table. Grab a glass before the next round.');
  }
}

// What every screen may see: none of it is secret (drinks happen out loud).
export function publicDrink(l, now) {
  if (!l) return null;
  return {
    tier: l.tier,
    shotCap: l.shotCap,
    out: Object.keys(l.out).filter((id) => l.out[id]),
    tally: l.tally,
    moment: l.moment && now - l.moment.at < MOMENT_SHOW_MS ? l.moment : null,
    nudges: l.nudges.filter((n) => now - n.at < MOMENT_SHOW_MS),
  };
}

// Platform-only edits (host drops the tier, a player taps "I'm out"). Return
// a new ledger so callers can treat the old one as immutable.
export function withLedger(l, patch) {
  const next = structuredClone(l);
  if (patch.tier !== undefined && TIERS.includes(patch.tier)) next.tier = patch.tier;
  if (patch.shotCap !== undefined) next.shotCap = clampCap(patch.shotCap);
  if (patch.out) {
    const [id, on] = patch.out;
    if (on) next.out[id] = true;
    else delete next.out[id];
  }
  if (patch.reset) {
    next.tally = {};
    next.shotTimes = {};
    next.sinceWater = {};
    next.moment = null;
    next.nudges = [];
    next.lastMoment = null;
    next.groupWaterAt = patch.now ?? next.now;
  }
  return next;
}

// stats and game end (feed the Party Night awards)

// Count something a player did, for the end-of-night awards. Keys the
// platform turns into awards: liar, guilty, sleuth, quiz, brave, chicken,
// artist, guesser, crowd, rebel. Record a stat only once it is public: stats
// of a running game never leave the server, but they are shown at the end.
export function stat(state, id, key, n = 1) {
  if (!id || typeof key !== 'string') return;
  state.$stats = state.$stats || {};
  state.$stats[id] = state.$stats[id] || {};
  state.$stats[id][key] = (state.$stats[id][key] || 0) + n;
}

// Mark the game finished. `board` ([{ id, score }], best first) is what the
// Party Night standings use; default is the kit scoreboard.
export function gameOver(state, board = null) {
  const ids = playerIdsOf(state);
  const scores = state.scores || {};
  const b = Array.isArray(board) ? board : ids.map((id) => ({ id, score: scores[id] || 0 })).sort((a, b2) => b2.score - a.score);
  state.$over = { board: b.map((r) => ({ id: r.id, score: Number(r.score) || 0 })) };
}
