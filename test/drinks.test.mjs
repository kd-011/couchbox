// The drink engine and Party Night maths, without any game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newLedger, sip, shot, giveOut, waterfall, social, shotRoulette, lastPlaceShot, deadlyCard,
  deadlyReady, beginDrinks, settleDrinks, publicDrink, withLedger, stat, gameOver,
  SHOT_SIPS, WATER_EVERY, MOMENT_GAP_MS, GROUP_WATER_MS,
} from '../games/_kit/drinks.js';
import { newNight, archiveGame, standings, awards, placementPoints } from '../games/_kit/night.js';

const HOUR = 60 * 60_000;
function game(tier, now = 1_000_000) {
  const state = { variant: tier, players: ['a', 'b', 'c'].map((id) => ({ id })), scores: {}, $drink: newLedger({ tier, now }) };
  beginDrinks(state, now);
  return state;
}
// Run fn as one action at time t, like the runtime does.
function action(state, t, fn) {
  beginDrinks(state, t);
  const r = fn();
  settleDrinks(state, t);
  return r;
}

test('Standard records nothing and returns null', () => {
  const s = game('standard');
  assert.equal(sip(s, 'a', 2, 'x'), null);
  assert.equal(shot(s, 'a', 'x'), null);
  assert.equal(social(s, 1), null);
  assert.deepEqual(s.$drink.tally, {});
});

test('Drinking: sips tally, a shot becomes sips, no takeover', () => {
  const s = game('drinking');
  action(s, 1_000_000, () => { sip(s, 'a', 2, 'x'); shot(s, 'b', 'y'); giveOut(s, 'c', 3); });
  assert.equal(s.$drink.tally.a.sips, 2);
  assert.equal(s.$drink.tally.b.sips, SHOT_SIPS);
  assert.equal(s.$drink.tally.b.shots, 0);
  assert.equal(s.$drink.tally.c.gives, 3);
  assert.equal(s.$drink.moment, null);
});

test('Deadly: shots in one action become one takeover naming every target', () => {
  const s = game('deadly');
  action(s, 1_000_000, () => { shot(s, 'a', 'caught'); shot(s, 'b', 'caught'); sip(s, 'c', 1); });
  const m = s.$drink.moment;
  assert.equal(m.kind, 'shot');
  assert.deepEqual(m.targets, ['a', 'b']);
  assert.equal(m.lines.length, 2);
  assert.equal(s.$drink.tally.a.shots, 1);
  assert.equal(publicDrink(s.$drink, 1_000_500).moment.id, m.id);
  assert.equal(publicDrink(s.$drink, 1_000_000 + 60_000).moment, null, 'old moments stop showing');
});

test('Shot cap per rolling hour turns extra shots into sips, then resets', () => {
  const s = game('deadly');
  s.$drink.shotCap = 2;
  let t = 1_000_000;
  for (let i = 0; i < 2; i++) action(s, (t += 60_000), () => shot(s, 'a', 'x'));
  const e = action(s, (t += 60_000), () => shot(s, 'a', 'x'));
  assert.equal(e.unit, 'sip');
  assert.equal(e.n, SHOT_SIPS);
  assert.match(e.why, /shot cap/);
  assert.equal(s.$drink.tally.a.shots, 2);
  const later = action(s, t + HOUR, () => shot(s, 'a', 'x'));
  assert.equal(later.unit, 'shot', 'the cap is per rolling hour');
  const zero = game('deadly');
  zero.$drink.shotCap = 0;
  assert.equal(action(zero, 2_000_000, () => shot(zero, 'a', 'x')).unit, 'sip', 'cap 0 = no shots at all');
});

test("I'm out turns every drink into a forfeit", () => {
  const s = game('deadly');
  s.$drink = withLedger(s.$drink, { out: ['a', true] });
  const e1 = action(s, 1_000_000, () => sip(s, 'a', 2, 'x'));
  const e2 = action(s, 1_000_000, () => shot(s, 'a', 'y'));
  assert.equal(e1.unit, 'forfeit');
  assert.ok(e1.text.length > 5);
  assert.equal(e2.unit, 'forfeit');
  assert.equal(s.$drink.tally.a.sips, 0);
  assert.equal(s.$drink.tally.a.shots, 0);
  assert.equal(s.$drink.tally.a.forfeits, 2);
  action(s, 1_000_000, () => social(s, 2));
  assert.equal(s.$drink.tally.a.sips, 0, 'out players sit out socials');
  s.$drink = withLedger(s.$drink, { out: ['a', false] });
  assert.equal(action(s, 1_000_000, () => sip(s, 'a', 1)).unit, 'sip');
});

test('Water nudges: per player every WATER_EVERY sips, and for the table on a timer', () => {
  const s = game('drinking');
  action(s, 1_000_000, () => { for (let i = 0; i < WATER_EVERY; i++) sip(s, 'a', 1); });
  assert.equal(s.$drink.nudges.length, 1);
  assert.deepEqual(s.$drink.nudges[0].playerIds, ['a']);
  action(s, 1_000_000 + GROUP_WATER_MS, () => sip(s, 'b', 1));
  assert.equal(s.$drink.nudges.at(-1).playerIds.length, 0, 'whole-table nudge');
});

test('Roulette lands on a candidate; last place spins only on a tie', () => {
  const s = game('deadly');
  action(s, 1_000_000, () => shotRoulette(s, ['a', 'b', 'c'], 'x', () => 0.5));
  assert.equal(s.$drink.moment.kind, 'roulette');
  assert.deepEqual(s.$drink.moment.candidates, ['a', 'b', 'c']);
  assert.deepEqual(s.$drink.moment.targets, ['b']);
  const s2 = game('deadly');
  action(s2, 1_000_000, () => lastPlaceShot(s2, [{ id: 'a', score: 5 }, { id: 'b', score: 1 }, { id: 'c', score: 3 }], 'last', () => 0));
  assert.equal(s2.$drink.moment.kind, 'last');
  assert.deepEqual(s2.$drink.moment.targets, ['b']);
  const s3 = game('deadly');
  action(s3, 1_000_000, () => lastPlaceShot(s3, [{ id: 'a', score: 5 }, { id: 'b', score: 1 }, { id: 'c', score: 1 }], 'last', () => 0.9));
  assert.equal(s3.$drink.moment.kind, 'roulette');
  assert.deepEqual(s3.$drink.moment.candidates, ['b', 'c']);
  const s4 = game('deadly');
  assert.deepEqual(action(s4, 1_000_000, () => lastPlaceShot(s4, [{ id: 'a', score: 2 }, { id: 'b', score: 2 }], 'last')), [], 'all tied: nobody');
});

test('Deadly cards respect the gap between moments and only fire in Deadly', () => {
  const s = game('deadly');
  const m = action(s, 1_000_000, () => deadlyCard(s, () => 0.01));
  assert.ok(m, 'a card fires when the dice say so');
  assert.equal(deadlyReady(s), false);
  assert.equal(action(s, 1_000_000 + 60_000, () => deadlyCard(s, () => 0.01)), null, 'too soon');
  assert.ok(action(s, 1_000_000 + MOMENT_GAP_MS, () => deadlyCard(s, () => 0.01)));
  const d = game('drinking');
  assert.equal(action(d, 1_000_000, () => deadlyCard(d, () => 0.01)), null);
});

test('waterfall and social tally everyone', () => {
  const s = game('drinking');
  action(s, 1_000_000, () => { waterfall(s, 'a'); social(s, 1); });
  for (const id of ['a', 'b', 'c']) assert.equal(s.$drink.tally[id].sips, 3);
});

test('Party Night: placement points, standings, archive and awards', () => {
  assert.deepEqual(placementPoints([{ id: 'a', score: 3 }, { id: 'b', score: 3 }, { id: 'c', score: 1 }]), { a: 3, b: 3, c: 1 });
  assert.deepEqual(placementPoints([{ id: 'a', score: 0 }, { id: 'b', score: 0 }]), {}, 'all tied: no points');
  const s = game('deadly');
  s.scores = { a: 4, b: 2, c: 0 };
  stat(s, 'a', 'liar');
  stat(s, 'a', 'liar');
  stat(s, 'c', 'sleuth');
  action(s, 1_000_000, () => { shot(s, 'c', 'x'); sip(s, 'b', 4); });
  gameOver(s);
  let night = archiveGame(newNight(0), { gameId: 'imposter', name: 'Imposter', state: s });
  assert.equal(night.played.length, 1);
  assert.ok(night.played[0].finished);
  const s2 = game('deadly');
  s2.scores = { c: 9 };
  night = archiveGame(night, { gameId: 'heads', name: 'Celebrity Heads', state: s2 }); // ended early: board from scores
  assert.equal(night.played[1].finished, false);
  const st = standings(night, ['a', 'b', 'c']);
  // Game 1: a 3, b 2, c 1. Game 2 (c won, a and b tied second): c 3, a 2, b 2.
  assert.deepEqual(st.map((r) => [r.id, r.points, r.delta]), [['a', 5, 2], ['b', 4, 2], ['c', 4, 3]]);
  assert.equal(st[2].rank, 2, 'ties share a rank');
  const aw = awards(night, s.$drink.tally, ['a', 'b', 'c']);
  const by = Object.fromEntries(aw.map((x) => [x.key, x]));
  assert.deepEqual(by.liar.winners, ['a']);
  assert.equal(by.liar.label, '2 bluffs');
  assert.deepEqual(by.sleuth.winners, ['c']);
  assert.deepEqual(by.shots.winners, ['c']);
  assert.deepEqual(by.sips.winners, ['b']);
  assert.equal(aw.at(-1).key, 'points', 'the champion comes last');
  assert.ok(!by.quiz, 'no award nobody earned');
});

test('runtime: a game is un-ended when play carries on, and roster hooks settle drinks', async () => {
  const rt = await import('../games/_kit/runtime.js');
  const engine = {
    meta: { name: 'T', minPlayers: 2, maxPlayers: 8, options: [] },
    init: (ctx) => ({ phase: 'play', players: ctx.players, scores: {} }),
    act(s, a) {
      if (a.type === 'end') { s.phase = 'final'; gameOver(s); }
      if (a.type === 'again') s.phase = 'play';
      if (a.type === 'poke') s.poked = true;
    },
    removePlayer(s, id) { shot(s, id, 'walked out'); },
  };
  const players = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  let s = rt.createGame(engine, { players, variant: 'deadly', mode: 'room', options: {}, content: {}, now: 1000 }).state;
  const ctx = (now) => ({ players, content: {}, rng: Math.random, now });
  s = rt.applyAction(engine, s, { type: 'end' }, ctx(2000)).state;
  assert.ok(s.$over);
  s = rt.applyAction(engine, s, { type: 'poke' }, ctx(3000)).state;
  assert.ok(s.$over, 'same phase: still over');
  s = rt.applyAction(engine, s, { type: 'again' }, ctx(4000)).state;
  assert.equal(s.$over, undefined, 'play again un-ends the game');
  s = rt.removePlayerFrom(engine, s, 'b', ctx(5000));
  assert.equal(s.$drink.moment.at, 5000, 'a drink in removePlayer is settled at the right time');
  assert.deepEqual(s.$drink.moment.targets, ['b']);
});
