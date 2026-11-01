// Host Box voice lines: short, templated text for game events. Pure (no I/O,
// no Date.now/Math.random by default, rng is injectable for tests) so these
// are unit tested without a TTS server. lib/tts.mjs turns the text into
// audio; lib/rooms.mjs decides when to call these. No LLM flavour in v1 (see
// docs/HOSTBOX-PROTOCOL.md) — the templates below are the whole voice.

function pick(list, rng = Math.random) {
  return list[Math.floor(rng() * list.length)];
}

function names(ids, nameOf) {
  const list = (ids || []).map((id) => nameOf(id)).filter(Boolean);
  if (list.length === 0) return '';
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

export function roundStart({ name, variant }, rng = Math.random) {
  const tier = variant === 'deadly' ? ' Deadly tier is live, so mind the shot cap.' : '';
  return pick([
    `Here we go. ${name} starts now.${tier}`,
    `${name}. Eyes up.${tier}`,
    `Round's on. Playing ${name}.${tier}`,
  ], rng);
}

export function deadlyMoment(moment, nameOf, rng = Math.random) {
  const who = names(moment.targets, nameOf);
  switch (moment.kind) {
    case 'roulette':
      return who
        ? pick([`The wheel has spoken. ${who}, that's you.`, `Roulette lands on ${who}.`], rng)
        : 'The wheel spins.';
    case 'last':
      return who ? `Last place. ${who}, down it goes.` : 'Last place takes the shot.';
    case 'card':
      return who ? `${moment.title}. ${who}.` : `${moment.title}. Everyone's in.`;
    case 'shot':
    default:
      return who
        ? pick([`${who}, that's a shot.`, `Shot time for ${who}.`, `${who} is up. Bottoms up.`], rng)
        : 'Shots all round.';
  }
}

export function gameOver(board, nameOf, rng = Math.random) {
  if (!board || !board.length) return "That's the game.";
  const top = Math.max(...board.map((r) => r.score));
  const winners = board.filter((r) => r.score === top).map((r) => r.id);
  const who = names(winners, nameOf);
  if (!who) return "That's the game. No clear winner tonight.";
  return pick([`${who} takes it.`, `Winner: ${who}.`, `That's the game. ${who} on top.`], rng);
}

export function recap(night, nameOf) {
  const ids = Object.keys((night && night.points) || {});
  if (!ids.length) return 'Awards time.';
  const top = Math.max(...ids.map((id) => night.points[id] || 0));
  const leaders = ids.filter((id) => (night.points[id] || 0) === top);
  const who = names(leaders, nameOf);
  return who ? `Awards time. ${who} is leading the night.` : 'Awards time.';
}
