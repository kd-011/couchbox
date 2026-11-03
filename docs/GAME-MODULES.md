# Game modules: the contract

Every game on the site is one folder, `games/<id>/`. The platform
discovers it at server start, lists it on the home page, runs it on one
phone (pass and play, offline) and in rooms (everyone on their own phone,
plus a `/tv/CODE` big screen), in all three tiers (Standard, Drinking,
Deadly), and as one game of a Party Night.

Adding a game never touches a shared file. No registry to edit, no
router, no stylesheet, no test list. If you find yourself editing anything
outside `games/<id>/`, stop: the contract is missing something, so note it
in your PR instead of patching the platform.

The smallest complete game is `games/_example/` (High Card, about 150 lines
in total). Read it first; it is reproduced in full at the end of this doc.
The two real ports, `games/imposter/` and `games/heads/`, show everything
else: private roles, voting, timers, turn rotation, late joiners.

## Folder layout

```
games/<id>/
  engine.js     required  pure state machine, runs on the server AND in the browser
  client.js     required  renders views to HTML strings
  content.json  optional  words, prompts, questions (loaded for you)
  rules.md      required  short how-to-play, shown in the app
  e2e.mjs       required  browser driver that plays one full round (see Testing)
  icon.svg      optional  48x48 artwork for the game card (else meta.emoji)
  style.css     optional  game-specific CSS, auto-loaded when the game loads
  packs/        optional  curated packs, one JSON file each (see Curated packs)
```

- `<id>` is lowercase `a-z0-9-`, and equals `meta.id`. Folders starting with
  `_` are not games (`_kit` is shared code, `_example` is the example).
- Everything in the folder with a `.js .json .css .md .svg .png .webp .jpg`
  extension is public at `/games/<id>/...` and precached for offline play.
  Never put anything secret in a game folder. Test files (`*.test.mjs`) and
  `e2e.mjs` are not served. `packs/` is folded into one precached bundle,
  `/games/<id>/packs.json`, instead of being precached file by file.
- `engine.js` may import only `../_kit/kit.js` (and its own folder's files).
  No Node APIs, no DOM, no `fetch`, no `Date.now()`/`Math.random()` for game
  logic: use `ctx.now` and `ctx.rng`. It runs identically on the server and
  in the browser.

## How it runs

```
            one phone (pass and play)               own phones (room)
            browser: public/js/pass.js              server: lib/rooms.mjs
                     \                                  /
                      games/_kit/runtime.js  (createGame, applyAction,
                      deadlines, views)  ->  your engine.js
                     /                                  \
   shared screen  = client.tv(tvView)        each phone = client.player(playerView(me))
   private turn   = client.player(...)       TV         = client.tv(tvView)
   host controls  = hostActions()            host phone = hostActions() bar
```

The server is authoritative in rooms: clients send actions, the server runs
your `act()`, then sends each player only their own `playerView` and the
TV only `tvView`. Anything you leave out of a view never leaves the server.

## engine.js

```js
export const meta = { ... };                       // required
export function init(ctx) { return state; }        // required
export function act(state, action, ctx) { }        // required
export function playerView(state, playerId, ctx)   // required
export function tvView(state, ctx)                 // required
export function hostActions(state, ctx)            // required (may return [])
export function bot(state, playerId, ctx)          // required (tests)
export function passTurn(state, ctx)               // optional, pass and play
export function deadline(state)                    // optional, timers
export function addPlayer(state, player, ctx)      // optional, late joiners
export function removePlayer(state, playerId, ctx) // optional, leavers/kicks
export function boxButton(state, ctx)              // optional, Host Box (see below)
```

### boxButton: claiming the Host Box's one arcade button

A paired Deadly Host Box (docs/HOSTBOX-PROTOCOL.md) always has a button that
does *something*: by default the platform fires whichever of your
`hostActions()` has `tone: 'primary'` and no `confirm`, run as the host, with
no code of yours required. Export `boxButton` only when a game wants the
button to mean something else, as Quiz Show does for its buzzer:

```js
export function boxButton(state, ctx) {
  if (state.mode === 'room' && state.phase === 'buzzer' && !state.round.buzzActive) {
    return { mode: 'buzzer', label: 'Buzz in', action: { type: 'buzz', payload: null }, asHost: false };
  }
  return null; // fall back to the default primary-action button
}
```

Return `{ mode, label, action: { type, payload }, asHost }` or `null`.
`asHost: false` (the default) runs `action` as the box's *assigned* player
(an otherwise ordinary room player the host picks when pairing the box; a
physical stand-in for whoever is closest to the table's buzzer), so write
your `act()` case exactly as you would for that player's own phone. Only set
`asHost: true` for a genuine host-only move.

### meta

```js
export const meta = {
  id: 'high-card',             // = folder name
  name: 'High Card',
  emoji: '🃏',                 // fallback icon
  tagline: 'Highest secret card wins.',   // one line on the home card
  blurb: 'One or two sentences for search engines and the picker.',
  minPlayers: 2,
  maxPlayers: 12,
  order: 30,                   // home page position (Imposter 10, Heads 20)
  accent: '#4dabf7',           // the game's colour: its home deck, start screen, and every
                               // screen it is played on (--accent / --accent-ink). Never magenta.
  pitch: 'Highest secret card wins',  // optional: the home card's one line (60 chars max,
                               // no em dashes). Falls back to the tagline
  minutes: [10, 20],           // optional: typical length, shown as "10-20 min" on the card.
                               // Games topping out at 20 show up under the Quick filter
  vibes: ['brain'],            // optional kind tags for the home filter: bluff | brain | silly
  howto: [                     // exactly 3 short steps (max ~70 chars, no em dashes): the
    'Everyone gets a secret card',          // first-time how-to sheet and the TV lobby show them
    'Highest card wins the round',
    'Most rounds won takes the game',
  ],
  modes: ['pass', 'room'],     // drop one if the game truly cannot work that way
  variants: {                  // one line each, shown when picking the tier
    standard: 'Highest card scores a point.',
    drinking: 'Lowest card drinks 2.',
    deadly: 'Lowest card takes a shot.',   // the game's own Deadly moment
  },
  options: [ /* see Options */ ],
  teams: true,                 // optional: the host can split a room into teams
  audience: true,              // optional: overflow players can vote/bet from the crowd
};
```

`teams` and `audience` default to false. Leave them off unless your game actually
reads `ctx.teams` / `ctx.audience` (see "Teams and audience" below).

### Options

Settings the host picks before starting (set-up screen on one phone, the
lobby in a room). The platform renders them, clamps them with
`normaliseOptions`, and hands them to `init` as `ctx.options` (also on
`state.options`). Four types:

```js
{ key: 'seconds', label: 'Turn length', type: 'stepper', min: 30, max: 120, step: 15, default: 60, suffix: 's' }
{ key: 'category', label: 'Category', type: 'choice', default: 'random',
  choices: [{ value: 'random', label: 'Random' }, { value: 'movies', label: 'Movies' }] }
{ key: 'categories', label: 'Categories', type: 'multi', default: ['movies', 'animals'],
  choices: [{ value: 'movies', label: 'Movies' }, { value: 'animals', label: 'Animals' }] }
{ key: 'spicy', label: 'Spicy questions', type: 'toggle', default: false }
```

Keep it to three or four options with good defaults; most groups never
touch them. A `multi` always keeps at least one choice on.

### State

`init(ctx)` returns a plain JSON-serialisable object. It is deep-cloned
before every action (`structuredClone`), persisted to localStorage in pass
and play, and must survive a JSON round-trip. Rules:

- `state.phase` (string) is required. The UI animates when it changes.
- `state.players` is required: the array of `{ id, name, color }` taking part
  in this game. The platform reads it to tell who is in the game vs watching.
- `state.mode` (`'pass' | 'room'`), `state.variant` (the drinking tier:
  `'standard' | 'drinking' | 'deadly'`) and `state.options` are set by the
  platform. Read them, never write them. The host can drop the tier
  mid-game, so read `state.variant` (or `isDrinking(state)`) when you
  resolve, not once in `init`.
- `state.teams` (`[{ id, name, color, memberIds }] | null`) and
  `state.audience` (`[playerId] | null`) are set by the platform from the
  room's setup, only for a game that declares `meta.teams` / `meta.audience`.
  Always null in pass and play. See "Teams and audience" below.
- Keys starting with `$` (`$drink`, `$stats`, `$over`) belong to the
  platform; touch them only through the kit calls below.
- Keep views small (under 64 KB; the contract test enforces it).

`ctx` for `init`: `{ players, variant, mode, options, content, rng, now }`.
`ctx` for everything else: `{ players, content, rng, now }`, where `players`
is the current room roster (may include people not in your game).

### act(state, action, ctx)

```js
action = { type, payload, from, host, system }
```

- `from`: the player id who sent it, or `null` from the shared screen in pass
  and play.
- `host`: true when sent by the room host, or from the shared screen in pass
  and play. Gate host-only moves on `action.host`.
- `system`: true only for timer deadlines.
- Mutate `state` in place and return nothing, or `return fail('message')`
  (from kit) to reject: the state rolls back and the sender sees the message.
  A throw is treated the same way and logged.
- Validate everything: phase, who sent it, and the payload. Payloads come
  from the network. Never trust `payload` to be the right type.
- Make taps idempotent. Two phones can tap the same button at once. Put
  an item id in the payload and ignore stale ones (Heads sends `wordId`;
  a mismatch returns quietly without an error).

### Views: what each screen gets

`playerView(state, playerId, ctx)` is that player's private screen.
`tvView(state, ctx)` is the public screen: the TV in a room, and the shared
phone in pass and play.

- Secrets go only into the owner's playerView. Imposter puts the word in
  `card` only for crew; Heads puts the live word in everyone's view except
  the guesser's. Never put a secret in `tvView` during play.
- `tvView` may depend on `state.mode`: in pass and play the shared screen IS
  the public phone (Heads shows the word there, because the phone is on the
  guesser's forehead; a room TV never shows it).
- Include `phase` in every view. Reference players by id; the client
  turns ids into names and avatars (`ui.name(id)`, `ui.avatar(id)`).
- `playerView` must cope with an id that is not in the game (a late joiner):
  return the public info with `me: null` and render a "watching" state.
- Optional `toast: { id, text, kind }` in a view shows once per id on every
  screen (`kind: 'drink'` styles it as a drink call). Use `toast(state, text, kind)`
  from kit and copy `state.toast` into your views.
- Timers: copy `state.timer` into views and render it with `ui.countdown()`.

### hostActions(state, ctx)

The buttons in the host bar (room host's phone; the shared screen in pass
and play). Return an array for the current phase:

```js
[{ type: 'startVote', label: 'Vote now', tone: 'primary' },
 { type: 'addMinute', label: '+1 min', tone: 'secondary', payload: null },
 { type: 'endTurn', label: 'End turn', tone: 'secondary', confirm: 'End this turn now?' }]
```

`tone`: `primary` (one per phase, the obvious next step), `secondary`,
`danger`. `confirm` asks first. The platform sends them as normal actions with
`host: true`. Platform-level host controls (start, back to lobby, restart,
pass host, remove player) are not yours to implement.

### Tiers and the drink API

Every game has three tiers, picked at creation and droppable mid-game by the
host. All three run the same engine.

| Tier | `state.variant` | What happens |
|---|---|---|
| Standard | `'standard'` | No drinking. Points, forfeits or just fun. |
| Drinking | `'drinking'` | Sips, written into the flow. |
| Deadly | `'deadly'` | Sips plus shots, as rare, telegraphed moments. |

Always keep score with `addScore` in every tier: the Party Night
standings are built from your scoreboard, so a drinking game with no points
gives the night nothing to rank. Show the scores wherever they make sense.

Never invent drink text. Call the drink engine from `act()` (not `init()`);
it records every drink in the night's ledger (per-player sip, shot, give and
forfeit tallies that carry across games), applies the safety rails, and
returns an entry for your result list:

```js
import { sip, shot, giveOut, waterfall, social, isDrinking, isDeadly } from '../_kit/kit.js';

sip(state, id, n, why)          // id drinks n sips
shot(state, id, why)            // id takes a shot (Deadly only, see below)
giveOut(state, id, n, why)      // id hands out n sips to whoever they like
waterfall(state, starterId, why)// everyone drinks, starting with starterId
social(state, n, why)           // the whole table drinks n together
isDrinking(state)               // Drinking or Deadly
isDeadly(state)                 // Deadly
```

Each returns a drink entry `{ playerId, n, unit, why, text? }`, or `null` in
Standard. Collect them into a view (`result.drinks`) and render with
`ui.drinks(list)` (it skips nulls, merges repeats, and styles shots,
forfeits, gives and socials). For a mid-turn call, also show a toast:
`toast(state, 'Sam sips 1', 'drink')`.

What the engine does for you, so your game never has to:

- Tier: in Standard every call is a no-op. In Drinking a `shot()` becomes
  3 sips (`SHOT_SIPS`). Write `shot()` where your Deadly line says shot and
  `sip()` everywhere else.
- I'm out: any player can tap "I'm out" in the drinks sheet. Every call
  for them returns a `unit: 'forfeit'` entry with a forfeit to do instead.
  Render it like any other entry.
- Shot cap: the host sets a cap per player per rolling hour (default 2).
  Over it, `shot()` pours 3 sips instead and says so.
- Water: every 10 sips a player gets a water-break nudge, and the whole
  table gets one every 45 minutes.
- Drink calls also work from `addPlayer` / `removePlayer` (a leaver can
  complete a vote): the platform settles those too.
- Tallies are public, so never call the drink API for a secret reason
  before it is revealed (a wolf drinking at night would out them).

### Deadly moments

Shots arrive as big, telegraphed moments: a full-screen takeover on every
phone and the TV, a stinger sound, and a strong buzz on the target's phone.
You do not render them. Every `shot()` in one action is gathered into one
moment ("Sam takes a shot"), fired after `act()` returns. Each game needs at
least one moment of its own, named in `meta.variants.deadly`. Telegraph it in
your views before it lands (a "Deadly round" badge, a streak warning) where
the game allows. The tools:

```js
shotRoulette(state, candidateIds, why, ctx.rng, { title, sub }) // the wheel spins, lands on one
lastPlaceShot(state, board, why, ctx.rng)   // lowest score takes a shot; a tie spins the wheel
deadlyCard(state, ctx.rng)                  // between rounds: maybe a random Deadly card
deadlyMoment(state, { kind, title, sub, text, targets, lines })  // any custom takeover
deadlyReady(state)                          // Deadly tier and no moment in the last 3 min
```

- Rule shots (the ones your Deadly line promises: "caught imposters take a
  shot") always happen; the shot cap keeps them sane. Make them rare by
  design: a big event, not every wrong answer.
- Optional shots (bonus wheels, streak gambles) check `deadlyReady(state)`
  first so moments never come back-to-back.
- Between rounds, call `deadlyCard(state, ctx.rng)` once whenever your game
  moves to its next round. About one round in three it draws a card: Shot
  Roulette, Tall Poppy (the leader takes a shot), Waterfall, Social, or a
  Mercy round of water. It does nothing outside Deadly or within 3 minutes
  of the last moment.

The platform shows the one-time 18+ confirm (and a Deadly one that spells
out the rails). Do not add your own. Keep amounts sane: single-digit sips.

### Teams and audience

Both are room-only (always `null` in pass and play) and both are opt-in:
a game only ever sees `ctx.teams` / `ctx.audience` when it declares
`meta.teams: true` / `meta.audience: true`. Leave the flag off and the room
never bothers you with either.

Teams: in the lobby the host can split the room into teams (or
auto-balance), or leave it off. `ctx.teams` at `init` is `null` (no teams:
play as individuals) or `[{ id, name, color, memberIds }]`. Two shapes of
support, pick whichever fits your game:

- Score teams directly (Quiz Show): build your scoring unit from
  `ctx.teams` instead of one per player, falling back to one contestant per
  player when `ctx.teams` is null. Map an incoming player action to their
  contestant with `kit.teamOf(state.teams, action.from)` (falls back to
  solo contestants transparently, since a solo contestant's `memberIds` is
  `[playerId]`). `addScore`/`leaderboard` work unchanged on contestant ids.
- Score individuals, roll up teams (Fake Out, Would You Rather, Most
  Likely To, Sketchy): keep scoring players as you already do, and add
  `kit.teamLeaderboard(state, state.teams)` to your views for a team
  standings table (each team's score is the sum of its members').

Either way, when a drinking consequence should land on a whole team at once
(a last-place team, nobody on a team ever guessed right), use
`teamSip`/`teamShot` from the kit instead of looping `sip`/`shot` yourself:
a team shot is one Deadly takeover naming the team, not one per member.

```js
import { teamOf, teamSip, teamShot, teamLeaderboard } from '../_kit/kit.js';

const team = teamOf(state.teams, playerId);        // null if teams are off
teamSip(state, team, 2, 'last place');             // every member, together
teamShot(state, team, 'wiped out');                // Deadly: one takeover, "Team Red takes shots"
teamLeaderboard(state, state.teams);               // [{ id, score }] for a team table
```

`addPlayer`/`removePlayer` still add/remove the player; if you score teams
directly, also add them to (or drop them from) the smallest team's
`memberIds` so nobody is left without a side.

Audience: the room always fits more people than a game's `maxPlayers`:
anyone past the cap watches from the crowd automatically, on their own
phone, with no error and no lost players. `ctx.audience` at `init` is `null`
(room not over the cap, or the game doesn't declare support) or the array of
players watching this run; the platform stores their ids on
`state.audience`. They are never in `state.players`, so by default every
game already shows them its existing "watching" screen (the same one a late
joiner gets) with no extra work.

Declaring `meta.audience: true` means your `act()` additionally accepts
moves `from` an id in `state.audience` for your own vote/bet action types
(check `(state.audience || []).includes(action.from)`), and your
`playerView` renders them something to do instead of just "watching" (a vote
alongside the players', a bet on the outcome). Settle a bet with the normal
drink API: `sip` the ones who guessed wrong, nothing (or `giveOut`) for the
ones who got it right. Never let an audience vote change who wins or scores
among the real players; they are watching the game, not playing it.

Every room also gets a platform-level reaction bar (a handful of emoji,
mostly useful for the audience since the players are busy with the game) that
floats across every screen. It needs nothing from your game: skip it.

### Party Night: stats and the end of a game

A room (or one phone) can play several games in a row. Between games the
platform shows the standings (3/2/1 placement points per game from your
scoreboard) and at the end an awards ceremony. Two calls feed it:

```js
import { stat, gameOver } from '../_kit/kit.js';

stat(state, id, 'liar')        // count something a player did, for the awards
gameOver(state)                // the game is finished; board = your scores
gameOver(state, board)         // or pass [{ id, score }] best first
```

- Call `gameOver` when your game reaches its natural end (your `final`
  phase). The host bar then leads with "Standings". If play carries on
  (any action that changes the phase, like "Play again" or an extra
  round) the game counts as running again until you call `gameOver` again.
  Games without a natural end should offer one (a rounds option).
- Award stats the platform knows: `liar` (got away with a bluff), `sleuth`
  (caught a liar, found the truth), `guilty` (owned up, got picked),
  `quiz` (right answers), `artist` (drawing guessed), `guesser` (guessed
  right), `brave` (did the dare), `chicken` (skipped), `crowd` (sided with
  the majority), `rebel` (the lone pick). Sips, shots, gives, forfeits and
  the overall champion come from the ledger and standings for free.
- Record a stat once it is public (at the reveal), never mid-secret.

### Pass and play: passTurn(state, ctx)

One phone, handed round. Return the id of the player who must look at
something private right now, or `null` for the shared screen.

- When it returns an id, the runner shows a full-screen "Pass to Sam"
  gate, then `client.player(playerView(state, sam))`. Sam's taps are sent with
  `from: sam`. When `passTurn` changes to someone else, the next gate shows;
  when it returns `null`, the shared screen (`client.tv`, interactive) comes
  back with the host bar.
- Design the private step to end with an action (Imposter: "Got it, hide my
  card" sends `seen`), so the next gate appears straight away.
- Things that are private in a room but done out loud on one phone (voting)
  can branch on `state.mode`: Imposter lets the shared screen record who the
  group voted out (`accuse`) instead of passing the phone for votes.
- If the game never needs a private look (Heads), return `null` always or
  omit `passTurn`.

### Timers: deadline(state)

Use the kit timer helpers; they store `state.timer = { endsAt, remaining,
total, paused, onEnd }`:

```js
startTimer(state, 60_000, ctx.now, 'timeUp');   // in act() or init()
pauseTimer(state, ctx.now); resumeTimer(state, ctx.now); addTime(state, ms, ctx.now);
export const deadline = timerDeadline;          // fires { type: 'timeUp', system: true }
```

The server (and the pass runner) dispatches the `onEnd` action at `endsAt`.
Handle it in `act()` and check `action.system`. Clients render the countdown
from the view with the server clock offset applied.

### Late joiners and leavers

`addPlayer(state, player, ctx)`: someone joined the room mid-game. Either
deal them in now (Heads appends them to the rotation) or queue them for the
next round (Imposter). Without it they watch until the host starts a new game.

`removePlayer(state, playerId, ctx)`: someone left or was removed. Clean up
everything that waits on them (votes, turns, "everyone has seen it" checks)
so the game can never get stuck.

### bot(state, playerId, ctx)

Return a random legal action for that player right now, or `null`.
`playerId === null` means the host / shared screen: return one of your host
actions or a shared-screen move. Used by `test/contract.test.mjs` to play
400 random steps in every mode and variant; a bot move that your own `act()`
rejects fails the test.

## content.json

Loaded once and passed as `ctx.content` (server and browser). Shape is up to
you. Every word, prompt and question must be original or properly licensed;
never paste question sets from other games, apps or books. Facts are fine;
someone else's wording is not. Note any licensed source in `rules.md`.

## pack: custom and AI-made content packs

Optional. A game whose content is a flat list of simple items (words,
prompts, pairs) can let the host swap in their own deck, built by hand or by
the AI pack maker, loaded by a short share code when creating a game. Skip
this entirely for a game whose content doesn't reduce to that shape (a
trivia board, a drawing word list with difficulty tiers): there is no
obligation for every game to support packs.

```js
export const pack = {
  label: 'Would-you-rather pairs',      // shown in the pack UI
  itemLabel: 'pair',                    // singular noun for one item
  fields: [                             // the shape of one item
    { key: 'a', label: 'Option A', type: 'textarea', maxLength: 100 },
    { key: 'b', label: 'Option B', type: 'textarea', maxLength: 100 },
  ],
  minItems: 6,
  maxItems: 150,
  aiHint: 'Tells the AI pack maker what to invent and in what voice.',
  apply(content, items, title) {        // pure: pack items -> this game's content shape
    return { pairs: items.map((it) => ({ a: it.a, b: it.b })) };
  },
};
```

- `fields`: each is `{ key, label, type: 'text' | 'textarea', maxLength?,
  optional? }`. `optional: true` lets a field stay blank (Imposter's
  category, say); everything else is required.
- `apply(content, items, title)` is a pure function, same purity rules as
  `engine.js`: it builds this game's `ctx.content` shape from the pack's
  items, replacing the built-in deck outright (a pack is a deck, not an
  addition to one). It runs on the server (`lib/packs.mjs`) and in the
  browser (pass and play, `public/js/pass.js`), so it must not reach outside
  its own folder.
- `aiHint` is one or two sentences telling the AI pack maker what kind of
  item to invent and the tone, written as if briefing a person: name the
  game, what each field means, what to avoid.
- Packs are stored server-side as JSON files (`lib/packs.mjs`), unlisted,
  found only by their short code: a per-IP rate limit and a basic profanity
  filter apply to every pack regardless of how it was made. The AI pack
  maker (`lib/ai-packs.mjs`) calls OpenRouter with a JSON-schema response
  built from `fields`, under its own daily spend cap and per-IP limit, and
  degrades to a plain "taking a break today" message rather than erroring
  when the key, the cap or the rate limit says no.
- The host picks a pack (or builds or AI-generates one on the spot) in the
  create wizard's "Content pack" section, and can change it from the lobby
  before starting, exactly like options. Nothing about this touches
  `act()`, views, or any other part of the contract: a pack only changes
  what `ctx.content` holds.

## Curated packs: built-in themed decks

Every game with a deck ships hand-written themed packs (Would You Rather:
Office Life, Food Fights; Imposter: Aussie Icons...) that a host picks with
one tap in the pack browser, on the start screen, in one-phone set-up, in
the room lobby and between Party Night games. Adding a pack is adding one
JSON file. No code, no registry, no test list.

```
games/<id>/packs/<pack-id>.json
{
  "id": "office-life",              // = the file name: lowercase a-z 0-9 -
  "title": "Office Life",           // <= 32 characters
  "emoji": "💼",                     // one emoji, the pack's art
  "blurb": "Meetings, deadlines and the office fridge.",   // <= 100 characters
  "tags": ["work"],                 // optional, up to 4 short lowercase words (filter chips)
  "order": 10,                      // optional, sort position (default 100, then title)
  "content": { "pairs": [ ... ] }   // the game's own content.json shape, only the keys you bring
}
```

A pack's `content` is shallow-merged over `content.json`: every
top-level key the pack provides replaces the built-in one, every key it
leaves out keeps the built-in deck (`withCurated` in
`games/_kit/runtime.js`, used by the server and by pass and play). So per
game:

| Game | A pack brings | Left to the built-in deck |
|---|---|---|
| Would You Rather, Most Likely To, Tune In, Fake Out, Codewords, Paranoia | the one deck (`pairs`, `prompts`, `spectrums`, `words`, `questions`) | nothing |
| Imposter, Celebrity Heads | its own `categories` (1 to 4); the Category option falls back to all of the pack's | nothing |
| Quiz Show | its own `categories`; the Categories option falls back to all of the pack's | the `emoji` round, unless the pack brings `emoji` |
| Never Have I Ever | `prompts`, optionally `spicy` | `spicy`, if the pack has none |
| Truth or Dare | any of `mild`, `spicy`, `wild` (each with `truth` and `dare`) | the levels it leaves out |
| Sketchy | all of `easy`, `medium`, `hard` (required) | nothing |
| Spyfall | its own `locations` (10 or more, 8 roles each) | nothing |

Salad Bowl and Werewolf have no deck (players write their own clues; roles
only), so they have no packs.

The `curated` export is optional. A game needs no code to take curated
packs, but it can export `curated` from `engine.js` to tune them:

```js
export const curated = {
  itemLabel: 'question',          // one item in the picker ("34 questions"); default 'card'
  minItems: 25,                   // smallest pack (default 25 deck entries)
  spicyKeys: ['spicy', 'wild'],   // top-level content keys that only play when the game's spicy setting is on
  required: ['easy', 'medium', 'hard'],  // keys every pack must bring
  apply(content, packContent) {}, // rare: replace the shallow merge (pure, same rules as engine.js)
  check(mergedContent, packContent) { return []; },  // rare: extra problems to report
};
```

Validation is learnt from `content.json`. `lib/curated.mjs` derives the
schema from the built-in deck, so a pack must match it: the same item shape
(record keys, required fields, value types), string caps of about 1.4x the
longest built-in string at that path, one-word fields stay one word,
enum-like fields (Quiz Show `difficulty`, `True`/`False`) stay in their
set, numbers stay in the built-in range, lists inside an item (a question's
4 options, a location's 8 roles) keep the built-in length. On top: id = file
name, no unknown fields, at least `minItems` non-spicy deck entries (a pack
of only spicy keys counts its spicy ones), at least 5 entries per deck list,
no duplicates anywhere in the pack, unique `id`s across the merged deck, no
em dashes, and the profanity gate (`lib/profanity.mjs`) on everything except
spicy material (`spicyKeys` and items with `"spicy": true`). A pack's
`spicy` badge ("Spicy extras") is computed, never declared.

`test/curated.test.mjs` runs that validator on every pack of every game and
then plays each pack with the bots in both modes, so a pack that would crash
or stall a game fails `npm test`. A bad pack is skipped at server start
(logged), never taking the game down.

In rooms and in pass and play, a curated pack travels as the code `c:<pack-id>`
in the same `packCode` field custom packs use (custom codes are plain
`[a-z0-9]`, so they never collide): `create` and the lobby's `setPack`
validate it against the game's own catalogue, the room keeps one choice per
game (`packByGame`, so each game of a Party Night plays its own), and
`room.pack` is `{ code, title, emoji, count, curated }`. In pass and play the
phone resolves the choice from the bundle (`packContent` in
`public/js/packs.js`) and saves the merged content with the game, so it
plays offline and survives a refresh. The choice persists per game for the
tab (sessionStorage).

## client.js

```js
export function player(view, ui) { return ui.html`...`; }  // required
export function tv(view, ui) { return ui.html`...`; }      // required
export function mount(el, view, ui) { }                    // optional
export function now(view, ui) { return { text, tone }; }   // optional, strongly encouraged
```

### now(): what do I do right now

Every phone screen shows one line under the top bar telling this person what
to do. `now(view, ui)` returns `null` or `{ text, tone }`:

- `tone: 'act'`: this device must do something ("Vote for the imposter"). The
  strip fills with the game colour and the phone buzzes once when it changes to act.
- `tone: 'wait'`: nothing to do until others act; name them when it's three or
  fewer ("Waiting for Ben and Cy to vote").
- `tone: 'watch'`: follow along out loud or look up ("Look at the TV").

It runs for `ui.surface` `'player'` and `'shared'` (the one-phone table
screen), never `'tv'`. Keep it under ~48 characters, sentence case, no em
dashes, no emoji, and never reveal anything the view doesn't already show
this device. Cover every phase, results and game over included.

### Celebrations and flashes

- `data-fx="confetti" data-fx-key="<unique per moment>"` on an element fires
  one confetti burst from it, once per key per device (never on a fresh page
  load). Use it for game over and at most one per-round moment.
- `ui.flash(word, 'good' | 'bad' | 'accent' | '#hex')`: a full-screen colour
  flash with one giant word plus a sound and buzz. Only from an event handler
  in `mount()`, never from a render.
- The platform already plays a fanfare and confetti when `$over` turns true,
  a stage wipe and whoosh on the TV/shared screen when `view.phase` changes,
  and the last five seconds of any countdown beep on the TV/shared screen.

Render functions are pure: view in, HTML string out. They run on every
state update; the platform skips the DOM write when the HTML is unchanged.

- Always build markup with ``ui.html`...` ``. It escapes every interpolation
  (names are user input). Nest with `ui.html` again; `ui.raw()` only for
  markup you built yourself.
- `ui.surface` is `'player'`, `'tv'` (room big screen, view only, 1440x900
  and up) or `'shared'` (pass-and-play phone, interactive). `tv()` must look
  right as both a TV and a phone.

### Actions without wiring

```html
<button class="btn btn-primary" data-act="vote" data-arg="${id}">Vote</button>
<button data-act="got" data-payload="${view.wordId}">Got it</button>   <!-- JSON payload -->
<button data-act="accuse" data-arg="${id}" data-confirm="Vote out Sam?">Sam</button>
<form data-act="answer"><input name="text" data-draft="fake-${view.round}"><button type="submit">Send</button></form>
```

The platform handles the click or submit, shows a busy state, sends the
action, buzzes, and shows the real error inline if it is rejected. A form's
fields arrive as a `{ name: value }` payload.

- `data-keep="key"` keeps that exact DOM node across re-renders (a canvas, a
  half-typed answer). Typed input in named fields is also preserved.
- `data-draft="key"` saves the field to localStorage until it is sent, so a
  refresh never loses an answer.
- `mount(el, view, ui)` runs after each render for anything custom (canvas
  drawing, hold-to-peek). Check `dataset.wired` to avoid double listeners.
- Re-renders within one phase are patched into the live DOM, not rebuilt
  (`public/js/morph.js`): only the nodes whose markup changed are touched, so
  someone else's answer never replays an entry animation, drops a press or
  resets scroll. Rendering stays a pure function of the view; do not rely on a
  fresh node to restart a CSS animation (change a class instead). A client with
  a `mount()` hook, and every phase change, still gets a full rebuild.

### The ui object

| | |
|---|---|
| `ui.html`, `ui.raw`, `ui.esc` | templating |
| `ui.me` | `{ id, name, color }` of this screen's player, or null |
| `ui.players`, `ui.player(id)`, `ui.name(id)` | the roster |
| `ui.avatar(id, size)` | the player's face (emoji picked on join) in their colour; initials if none |
| `ui.isHost`, `ui.mode`, `ui.variant` (= `ui.tier`), `ui.drinking`, `ui.deadly`, `ui.surface`, `ui.interactive` | context |
| `ui.countdown(timer, { ring, size })` | live countdown (ring = progress ring) |
| `ui.drinks(list)` | drink entries from the drink API (skips nulls) |
| `ui.deadlyNote(text)` | a pulsing "Deadly: ..." pill that telegraphs your Deadly rule; empty outside Deadly |
| `ui.scores(board, { limit })` | leaderboard from `leaderboard()` |
| `ui.roster(ids, { mark, size })` | chips, ticked for ids in `mark` |
| `ui.icon(name, size)` | line icons: back close more share copy qr tv crown users check plus minus leave book glass phone phones star eye eyeOff wifiOff refresh pause play expand edit smile |
| `ui.toast(text, kind)`, `ui.haptic(kind)` | feedback (`tap success warn danger`) |
| `ui.flash(word, kind)` | full-screen colour flash (see Celebrations) |
| `ui.plural(n, word)` | "1 vote", "2 votes" |

### Shared CSS (public/style.css)

Reuse these before writing your own; the site should read as one product.

- Layout: `.tv-stage` (centred column, fills the screen), `.tv-big` (huge
  display heading), `.tv-sub`, `.q` (question heading), `.lead-line`
  (`.big`), `.waiting-line`, `.state-card` (empty / waiting states), `.sec`.
- Buttons: `.btn` + `.btn-primary | .btn-secondary | .btn-ghost | .btn-danger
  | .btn-amber`, `.btn-xl` (full width, 60px). Every target is 44px or more.
- Picking: `.pick-grid` > `.pick` (`.on` when selected), `.chips` > `.chip`.
- People and results: `.roster`, `.scores`, `.drinks`, `.pill`, `.pill-amber`,
  `.pill-deadly`, `.deadly-note`.
- Tokens: `--accent` (the game's colour, set on every screen it's played on)
  and `--accent-ink` (readable text on it), `--amber --deadly --water --good
  --bad --text --dim --faint --surface --surface-2 --surface-3 --display`
  (Bricolage Grotesque; squeeze it with `font-stretch: 78-86%` for big type)
  `--ease --spring --press` (the pressable bottom edge buttons use).

Put game-only CSS in `games/<id>/style.css`, prefix every class with a short
game prefix (`.imp-`, `.hd-`), and scale TV sizes under `.tv-surface` with
`vw` units. Respect `prefers-reduced-motion` (the global rule already cuts
animations). The house style: no gradient text, no coloured left-border accents,
no tinted outline rings as emphasis (use fills), no magenta, no hint-text
subtitles (the `now()` strip says what to do), no emoji standing in for icons
in the UI (player faces are content, not icons), no em dashes in copy.

## Testing

1. `npm test` runs `test/contract.test.mjs` against every folder in `games/`:
   it validates `meta`, then plays 400 random `bot()` moves in each of
   pass/room x standard/drinking/deadly (dropping the tier halfway through
   the Deadly runs), checking every view is JSON-safe and small,
   no bot move is rejected, the game never gets stuck (a move or a deadline
   is always available), and `addPlayer`/`removePlayer` leave valid views.
   Add your own `games/<id>/*.test.mjs` for game rules if useful; run them
   with `npm test` (it picks up `games/**/*.test.mjs`).
   `test/teams-audience.test.mjs` runs a second, shorter bot session in room
   mode for every game that declares `meta.teams` / `meta.audience`, with
   teams set up and extra players over the cap, so `bot()` needs to drive
   your team-mapped and audience action types too (see an existing
   `meta.teams`/`meta.audience` game's `bot()` for the pattern).
2. Secret isolation: write a test like the Imposter and Heads ones in
   `test/rooms.test.mjs` if your game has secrets, but put it in your own
   folder (`games/<id>/secrets.test.mjs`), driving `RoomManager` the same way.
3. `games/<id>/e2e.mjs` drives a real browser. The harness (`e2e/play.mjs`)
   does everything up to the first game screen: wizard, 18+ gate, names or
   room create, 3 players joining on separate contexts at 390x844, the TV at
   1440x900, then calls your driver:

   ```js
   export async function setup({ page, mode, h }) {}            // optional: tweak options
   export async function pass({ page, variant, h }) {}         // one phone, full round
   export async function room({ players, host, tv, variant, h }) {}   // 3 phones + TV
   ```

   `variant` is `'standard' | 'drinking' | 'deadly'`. Deadly takeovers are
   dismissed for you on phones (and logged), so they never block a click.
   `await h.expectMoment(page, /takes a shot/i, 'name')` asserts a takeover
   showed (or was already tapped away) on that page; titles render upper
   case, so match case-insensitively.

   `h.shot(page, name)`, `h.hostClick(page, label)`, `h.confirmSheet(page)`,
   `h.tap(page, selector)`, `h.log()`. Throw on anything wrong, and assert
   your secrets are absent from the wrong pages (`await page.content()`).

   ```
   GAMES_PORT=8979 node server.mjs &          # GAMES_EXAMPLE=1 also lists _example
   node e2e/play.mjs http://127.0.0.1:8979 <id>
   ```

   Screenshots land in `/tmp/games-e2e/`. Look at them at both sizes.

## Checklist before you open the PR

- [ ] `meta` complete, `id` = folder, `accent` set, all three tier lines written.
- [ ] Works on one phone AND own phones, in Standard, Drinking AND Deadly.
- [ ] Drinks go through the drink API (`sip`, `shot`, ...), never hand-made
      text; at least one Deadly moment of your own; `deadlyCard` between rounds.
- [ ] Scores kept in every tier; `gameOver` at the end; award `stat`s recorded.
- [ ] No secret in `tvView` or in another player's `playerView`.
- [ ] Host-only moves check `action.host`; every payload validated.
- [ ] `removePlayer` can never leave the game stuck.
- [ ] Content is original or licensed (and credited in `rules.md`).
- [ ] If `meta.teams`/`meta.audience` are set: `state.teams`/`state.audience`
      read, never written; `bot()` drives the new action types.
- [ ] `npm test` green; `node e2e/play.mjs <base> <id>` green; screenshots
      checked at 390x844 and 1440x900.
- [ ] Nothing outside `games/<id>/` changed.

## Full example: High Card (`games/_example/`)

### engine.js

```js
import {
  shuffle, fail, sip, shot, isDeadly, deadlyCard, gameOver, addScore, leaderboard, startTimer, stopTimer, timerDeadline,
} from '../_kit/kit.js';

export const meta = {
  id: '_example',
  name: 'High Card',
  emoji: '🃏',
  tagline: 'Highest secret card wins.',
  minPlayers: 2,
  maxPlayers: 12,
  modes: ['pass', 'room'],
  variants: {
    standard: 'Highest card scores a point.',
    drinking: 'Lowest card drinks 2.',
    deadly: 'Lowest card takes a shot.',
  },
  options: [
    { key: 'seconds', label: 'Look time', type: 'stepper', min: 5, max: 60, step: 5, default: 15, suffix: 's' },
  ],
};

const ids = (s) => s.players.map((p) => p.id);

function deal(state, ctx) {
  const deck = shuffle(ctx.content.cards, ctx.rng);
  state.cards = Object.fromEntries(ids(state).map((id, i) => [id, deck[i % deck.length]]));
  state.looked = {};
  state.result = null;
  state.phase = 'look';
  startTimer(state, state.options.seconds * 1000, ctx.now, 'flip');
}

export function init(ctx) {
  const state = { players: ctx.players, scores: {}, round: 1, mode: ctx.mode, variant: ctx.variant, options: ctx.options };
  deal(state, ctx);
  return state;
}

function flip(state) {
  stopTimer(state);
  const values = ids(state).map((id) => [id, state.cards[id].value]).sort((a, b) => b[1] - a[1]);
  const [hiId] = values[0];
  const [loId] = values[values.length - 1];
  addScore(state, hiId, 1); // score in every tier: Party Night ranks on it
  const d = isDeadly(state) ? shot(state, loId, 'lowest card') : sip(state, loId, 2, 'lowest card');
  state.result = { winner: hiId, drinks: [d] };
  state.phase = 'flip';
  if (state.scores[hiId] >= 3) gameOver(state); // first to 3
}

export function act(state, a, ctx) {
  switch (a.type) {
    case 'looked':
      if (state.phase !== 'look') return fail('Too late, the cards are flipped.');
      if (!state.cards[a.from]) return fail('You are not in this round.');
      state.looked[a.from] = true;
      return;
    case 'flip':
      if (!a.host && !a.system) return fail('Only the host can flip.');
      if (state.phase !== 'look') return fail('Already flipped.');
      flip(state);
      return;
    case 'next':
      if (!a.host) return fail('Only the host can deal.');
      if (state.phase !== 'flip') return fail('Flip first.');
      state.round += 1;
      deadlyCard(state, ctx.rng);
      deal(state, ctx);
      return;
    default:
      return fail('Unknown move.');
  }
}

export const deadline = timerDeadline;

export function playerView(state, playerId) {
  const mine = state.cards[playerId];
  return {
    phase: state.phase,
    round: state.round,
    timer: state.timer,
    me: mine ? playerId : null,
    myCard: mine || null, // only this player's card, never anyone else's
    looked: Object.keys(state.looked),
    players: ids(state),
    reveal: state.phase === 'flip' ? { cards: state.cards, ...state.result } : null,
    scores: leaderboard(state, ids(state)),
  };
}

export function tvView(state) {
  return {
    phase: state.phase,
    round: state.round,
    timer: state.timer,
    looked: Object.keys(state.looked),
    players: ids(state),
    reveal: state.phase === 'flip' ? { cards: state.cards, ...state.result } : null,
    scores: leaderboard(state, ids(state)),
  };
}

export function hostActions(state) {
  if (state.phase === 'look') return [{ type: 'flip', label: 'Flip the cards', tone: 'primary' }];
  return [{ type: 'next', label: 'Deal again', tone: 'primary' }];
}

// One phone: each player peeks privately in turn, then the shared screen.
export function passTurn(state) {
  if (state.phase !== 'look') return null;
  return ids(state).find((id) => !state.looked[id]) || null;
}

export function bot(state, playerId) {
  if (playerId === null) return hostActions(state)[0];
  if (state.phase === 'look' && state.cards[playerId] && !state.looked[playerId]) return { type: 'looked' };
  return null;
}
```

### client.js

```js
function reveal(view, ui) {
  const { html } = ui;
  const r = view.reveal;
  return html`<h2 class="q">${ui.name(r.winner)} wins round ${view.round}</h2>
    <ul class="roster">${view.players.map((id) => html`<li>${ui.avatar(id, 34)}<span>${ui.name(id)}: <b>${r.cards[id].label}</b></span></li>`)}</ul>
    ${ui.drinks(r.drinks)}${ui.scores(view.scores)}`;
}

export function player(view, ui) {
  const { html } = ui;
  if (view.phase === 'flip') return reveal(view, ui);
  if (!view.me) return html`<div class="state-card"><h2>Next round</h2></div>`;
  return html`<div class="tv-stage">
    <div class="tv-big">${view.myCard.label}</div>
    ${view.looked.includes(view.me)
      ? html`<p class="waiting-line">Waiting for the flip ${ui.countdown(view.timer)}</p>`
      : html`<button class="btn btn-primary btn-xl" data-act="looked">Seen it</button>`}
  </div>`;
}

export function tv(view, ui) {
  const { html } = ui;
  if (view.phase === 'flip') return html`<div class="tv-stage">${reveal(view, ui)}</div>`;
  return html`<div class="tv-stage">
    ${ui.countdown(view.timer, { ring: true })}
    ${ui.roster(view.players, { mark: view.looked })}
  </div>`;
}
```

### content.json, rules.md, e2e.mjs

```json
{ "cards": [{ "value": 4, "label": "Ace of Hearts" }, ...] }
```

```md
# High Card
Everyone gets a secret card. Look at yours, then the host flips them all. Highest card wins.
Highest card scores a point; first to 3 wins.
**Drinking:** lowest card drinks 2. **Deadly:** lowest card takes a shot.
```

```js
export async function pass({ page, h }) {
  for (let i = 0; i < 3; i++) {
    await page.locator('#gate-go').click();
    await page.locator('[data-act="looked"]').click();
  }
  await h.hostClick(page, 'Flip the cards');
  await page.getByText(/wins round 1/).waitFor();
}
export async function room({ players, host, tv, h }) {
  for (const p of players) await p.locator('[data-act="looked"]').click();
  await h.hostClick(host, 'Flip the cards');
  for (const p of [...players, tv]) await p.getByText(/wins round 1/).waitFor();
}
```

## Platform reference (for the curious, not for editing)

- `lib/registry.mjs`: discovery and validation, `/games/index.json`.
- `games/_kit/runtime.js`: createGame, applyAction (clone, run, roll back),
  deadlines, view helpers. Shared by both modes.
- `lib/rooms.mjs`: rooms, the wire protocol, host hand-over and failover,
  rejoin tokens, expiry, team setup (`setTeams`), the audience cap overflow
  and forced audience (`setAudience`), reactions (`react`). `test/rooms.test.mjs`
  covers it; `test/teams-audience.test.mjs` covers the per-game contract.
- `public/js/pass.js`: the pass-and-play runner and the hide-and-pass gate.
- `public/js/room.js`, `public/js/tv.js`: room screens and the big screen.
- `public/js/surface.js`: the `data-act` wiring and the `ui` object.
- `games/_kit/drinks.js`: the drink engine (tiers, ledger, tallies, shot
  cap, water nudges, I'm out, Deadly moments). `test/drinks.test.mjs`.
- `games/_kit/night.js`: Party Night (placement points, standings, awards).
- `public/js/drinkui.js`: the Deadly takeover, water nudges, the drinks chip
  and sheet. `public/js/nightui.js`: standings, the awards ceremony, the
  recap image. `public/js/sfx.js`: synthesised sound (no audio files).
- `e2e/night.mjs`: plays a whole Party Night (queue, standings, I'm out, a
  tier drop, awards, recap image) in a room and on one phone.
- `lib/curated.mjs`: curated packs (loading, the learnt-schema validator,
  the per-game bundle served at `/games/<id>/packs.json`). `test/curated.test.mjs`,
  `test/rooms-curated.test.mjs`.
- `lib/packs.mjs`: custom pack storage, validation, profanity gate, per-IP
  rate limit (`test/packs.test.mjs`). `lib/ai-packs.mjs`: the AI pack maker
  (OpenRouter, daily spend cap, per-IP limit, `test/ai-packs.test.mjs`).
  `public/js/packs.js`: the pack API client and the pack browser sheet
  (curated pack cards with search and filter chips, the built-in deck
  first, then load by code, build your own and the AI pack maker) used by
  the start screen, one-phone set-up, the room lobby and Party Night.
- `public/js/app.js`: home (game decks with a player-count filter), a game's
  start screen (tier tiles, then one tap to host on everyone's phones or pass
  one phone; name, face and tier are remembered), one-phone set-up, `/join`,
  and `/tv` (enter a room code with a TV remote).
- `public/js/fx.js`: confetti and the stage wipe. `public/js/howto.js`: the
  first-time how-to sheet (from `meta.howto`). `public/js/install.js`: the
  "Add to home screen" offer after the first finished game (Android prompt,
  iPhone/iPad Share steps; 30-day snooze; hidden when installed).
  `public/js/tvcast.js`: "Show on TV" (Presentation API cast where a display
  is available, else the short `/tv` address, code and QR; warns against
  screen mirroring).
- Lobby protocol extras in `lib/rooms.mjs`: player faces (`avatar` on
  create/join/profile), `{ t:'ready', on }` (lobby only, a signal for the host,
  never a gate; reset at every start) and `{ t:'peek', code }` (what a join
  link leads to, before joining).
- `e2e/screens.mjs`: a screenshot tour of every platform screen at 390x844 and
  1440x900 (`node e2e/screens.mjs [baseUrl] [outDir]`).
