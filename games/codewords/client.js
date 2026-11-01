// Codewords views. See docs/GAME-MODULES.md for the contract. A contestant
// is always a team here (never a solo "team of one" rendered as an
// individual), so teamAvatar-style rendering is used unconditionally.
function byId(view) {
  return Object.fromEntries(view.contestants.map((c) => [c.id, c]));
}

function teamBadge(c, ui, size = 32) {
  const { html } = ui;
  const initials = (c.name || '?').replace(/^Team\s+/i, 'T').slice(0, 2).toUpperCase();
  return html`<span class="av" style="--c:${c.color};--s:${size}px" aria-hidden="true">${initials}</span>`;
}

function tileColor(view, color) {
  if (!color) return null;
  if (color === 'bomb') return 'var(--deadly)';
  if (color === 'neutral') return 'var(--faint)';
  const c = byId(view)[color];
  return c ? c.color : 'var(--dim)';
}

// Room mode: only a player whose own canGuess the engine computed may tap
// (their teammates and the TV cannot). Pass mode has no "me": the shared
// screen (ui.surface === 'shared') speaks for whichever team is up, the
// same way the physical game is a phone on the table everyone taps in turn
// - a real room's own TV (ui.surface === 'tv') must stay view-only either way.
function canTapBoard(view, ui) {
  return view.phase === 'guess' && (view.canGuess || ui.surface === 'shared');
}

function tile(view, ui, t, canTap, i) {
  const { html } = ui;
  const color = tileColor(view, t.color);
  const mode = t.revealed ? 'revealed' : (t.color ? 'key' : 'hidden');
  const kind = t.color === 'bomb' ? 'cw-bomb' : t.color === 'neutral' ? 'cw-neutral' : '';
  // Only the tile that was just tapped flips; the rest are already face up.
  const just = t.revealed && view.lastGuess && view.lastGuess.word === t.word ? 'cw-just' : '';
  const style = `${color ? `--c:${color};` : ''}--i:${i}`;
  const tappable = canTap && !t.revealed;
  return html`<button class="cw-tile cw-${mode} ${t.revealed ? kind : ''} ${just} ${t.word.length > 10 ? 'cw-long cw-xlong' : t.word.length > 8 ? 'cw-long' : ''}" style="${style}" data-act="guess" data-arg="${t.word}" ${tappable ? '' : 'disabled'} aria-pressed="${t.revealed}">
    <span class="cw-word">${t.word}</span>
    ${t.color === 'bomb' ? html`<span class="cw-bomb-mark">${ui.icon('skull', 18)}</span>` : ''}
  </button>`;
}

function board(view, ui) {
  const { html } = ui;
  const canTap = canTapBoard(view, ui);
  return html`<div class="cw-board cw-size-${view.tiles.length} ${canTap ? 'can-tap' : ''}">${view.tiles.map((t, i) => tile(view, ui, t, canTap, i))}</div>`;
}

function teamStrip(view, ui) {
  const { html } = ui;
  const map = byId(view);
  return html`<div class="cw-teams">${view.contestants.map((c) => html`
    <div class="cw-team ${(view.phase === 'final' ? view.result && view.result.winner : view.active) === c.id ? 'active' : ''}" style="--c:${c.color}">
      ${teamBadge(c, ui, 34)}
      <div class="cw-team-info">
        <strong>${c.name}</strong>
        <span class="cw-team-sub">${ui.name(view.callerOf[c.id])} calls</span>
      </div>
      <span class="cw-left" aria-label="${view.remaining[c.id] ?? 0} words left">${view.remaining[c.id] ?? 0}</span>
    </div>`)}</div>`;
}

function clueBanner(view, ui) {
  const { html } = ui;
  if (!view.clue) return '';
  const left = view.turnGuessesLeft === null ? 'Unlimited guesses' : ui.plural(view.turnGuessesLeft, 'guess', 'guesses');
  const team = byId(view)[view.active];
  return html`<div class="cw-clue" style="--c:${team ? team.color : 'var(--accent)'}">
    <span class="cw-clue-word">${view.clue.word}</span>
    <span class="cw-clue-count">${view.clue.count === 0 ? '∞' : view.clue.count}</span>
  </div>
  <p class="cw-left-line">${left} left</p>`;
}

// Feedback on the last tap: what the word turned out to be and what that
// means for the turn, so nobody has to read the board's colours to know.
function lastGuessLine(view, ui) {
  const { html } = ui;
  const g = view.lastGuess;
  if (!g) return '';
  const map = byId(view);
  const teamName = (id) => (map[id] ? map[id].name : 'A team');
  if (!g.word) {
    if (!g.team) return '';
    if (g.endedTurn === 'stopped guessing') return html`<p class="waiting-line cw-last">${teamName(g.team)} stopped guessing</p>`;
    if (g.endedTurn === 'skipped') return html`<p class="waiting-line cw-last">${teamName(g.team)}'s turn was skipped</p>`;
    return '';
  }
  const label = g.color === 'bomb' ? 'the Bomb' : g.color === 'neutral' ? 'a neutral word' : `${teamName(g.color)}'s word`;
  const next = {
    'a neutral word': 'Turn over.',
    'the other team’s word': 'Turn over.',
    'no guesses left': 'Out of guesses.',
    'stopped guessing': 'They stopped there.',
  }[g.endedTurn] || (g.color === view.active ? 'Keep going.' : '');
  const good = !g.endedTurn && g.color === view.active;
  return html`<p class="waiting-line cw-last ${good ? 'is-good' : ''}">"${g.word}" was ${label}. ${next}</p>`;
}

function clueForm(view, ui) {
  const { html } = ui;
  // A lone Caller (3 players) is held to a clue of 1, so the form offers only that.
  const counts = view.maxCount ? [view.maxCount] : [0, 1, 2, 3, 4, 5];
  return html`<form class="cw-clue-form" data-act="giveClue">
    ${view.maxCount ? html`<p class="cw-left-line">Only you on this side, so the number stays at ${view.maxCount}.</p>` : ''}
    <input name="word" class="input" placeholder="One word clue" autocomplete="off" maxlength="24" required>
    <div class="cw-count-row">
      ${counts.map((n) => html`<label class="chip cw-count-chip">
        <input type="radio" name="count" value="${n}" ${n === 1 ? 'checked' : ''}>
        <span aria-label="${n === 0 ? 'Unlimited' : n}">${n === 0 ? '∞' : n}</span>
      </label>`)}
    </div>
    <button class="btn btn-primary btn-xl" type="submit">Give the clue</button>
  </form>`;
}

function clueScreen(view, ui) {
  const { html } = ui;
  const map = byId(view);
  const activeTeam = map[view.active];
  if (view.isCaller && view.myTeamId === view.active) {
    return html`<div class="cw-stage">
      <p class="cw-left-line">${ui.icon('eye', 16)} Only you can see the colours</p>
      ${board(view, ui)}
      ${clueForm(view, ui)}
    </div>`;
  }
  return html`<div class="cw-stage">
    <h2 class="cw-thinking" style="--c:${activeTeam ? activeTeam.color : 'var(--text)'}">${ui.name(view.callerOf[view.active])} is thinking</h2>
    ${lastGuessLine(view, ui)}
    ${board(view, ui)}
  </div>`;
}

function guessScreen(view, ui) {
  const { html } = ui;
  const map = byId(view);
  const activeTeam = map[view.active];
  return html`<div class="cw-stage">
    ${clueBanner(view, ui)}
    ${lastGuessLine(view, ui)}
    ${board(view, ui)}
    ${canTapBoard(view, ui) ? html`<button class="btn btn-secondary" data-act="stopGuessing">Stop guessing, end the turn</button>` : ''}
  </div>`;
}

// A game-series scoreboard: contestant ids are synthetic team ids
// ('team-1'/a room's real team id), never real player ids, so the generic
// ui.scores() (which looks players up by id) can't render them - same
// problem quiz-show's scoreboard() solves the same way.
function teamScores(view, ui) {
  const { html } = ui;
  const map = byId(view);
  if (!view.scores.length) return ui.raw('');
  const top = view.scores[0].score;
  const rows = view.scores.map((r) => html`<li class="${r.score === top && top > 0 ? 'lead' : ''}">
    <span class="rank">${1 + view.scores.filter((x) => x.score > r.score).length}</span>
    ${teamBadge(map[r.id], ui, 32)}<span class="nm">${map[r.id]?.name || 'Team'}</span><span class="pts">${r.score}</span></li>`);
  return html`<ol class="scores">${rows}</ol>`;
}

function resultWhy(view) {
  return {
    bomb: 'The other team hit the Bomb',
    'found-all': 'Every one of their words found',
    'the other team left': 'The other team left',
  }[view.result && view.result.reason] || '';
}

function finalScreen(view, ui) {
  const { html } = ui;
  const r = view.result || {};
  const winner = byId(view)[r.winner];
  return html`<div class="cw-stage cw-final">
    ${winner ? html`<div class="winner-avs">${teamBadge(winner, ui, 72)}</div>` : ''}
    <h2 class="cw-win" style="--c:${winner ? winner.color : 'var(--text)'}" ${winner ? html`data-fx="confetti" data-fx-key="cw-win-${r.winner}-${view.tiles.slice(0, 4).map((t) => t.word).join('-')}"` : ''}>${winner ? `${winner.name} wins` : 'No winner'}</h2>
    ${resultWhy(view) ? html`<p class="cw-why">${resultWhy(view)}</p>` : ''}
    ${ui.drinks(r.drinks)}
    ${board(view, ui)}
    ${teamScores(view, ui)}
  </div>`;
}

function renderPhase(view, ui) {
  switch (view.phase) {
    case 'clue': return clueScreen(view, ui);
    case 'guess': return guessScreen(view, ui);
    case 'final': return finalScreen(view, ui);
    default: return '';
  }
}

export function player(view, ui) {
  const { html } = ui;
  if (!view.me) return html`<div class="state-card">${ui.icon('users', 36)}<h2>Watching this one</h2><p>You're in from the next game.</p></div>`;
  return html`${teamStrip(view, ui)}${ui.drinks(view.drinks)}${renderPhase(view, ui)}`;
}

export function tv(view, ui) {
  const { html } = ui;
  return html`<div class="cw-tv">${teamStrip(view, ui)}${ui.drinks(view.drinks)}${renderPhase(view, ui)}</div>`;
}

// The one-line "what do I do right now" strip under the top bar on phones.
// Only the Caller's own clue screen ever shows the key; this line never
// mentions a colour, only whose turn it is and the public clue.
export function now(view, ui) {
  const map = byId(view);
  const team = (id) => (map[id] ? map[id].name : 'The other team');
  const caller = ui.name(view.callerOf[view.active]);
  const final = () => (ui.isHost
    ? { text: 'Game over. Tap Standings or Play again', tone: 'act' }
    : { text: 'Game over. The host picks what is next', tone: 'wait' });
  if (ui.surface === 'shared') {
    if (view.phase === 'clue') return { text: `Pass the phone to ${caller}`, tone: 'act' };
    if (view.phase === 'guess') return { text: `${team(view.active)}: tap your guesses for "${view.clue.word}"`, tone: 'act' };
    if (view.phase === 'final') return final();
    return null;
  }
  if (!view.me) return { text: "Watching. You're in from the next game", tone: 'watch' };
  const mine = view.myTeamId === view.active;
  switch (view.phase) {
    case 'clue':
      if (view.isCaller && mine) return { text: 'Give your team a one-word clue', tone: 'act' };
      return { text: mine ? `Waiting for ${caller}'s clue` : `Waiting for ${caller} to clue ${team(view.active)}`, tone: 'wait' };
    case 'guess':
      if (view.canGuess) return { text: `Tap the words that fit "${view.clue.word}"`, tone: 'act' };
      if (mine) return { text: 'Your team is guessing. No hints', tone: 'watch' };
      return { text: `${team(view.active)} is guessing. Watch the board`, tone: 'watch' };
    case 'final':
      return final();
    default:
      return null;
  }
}
