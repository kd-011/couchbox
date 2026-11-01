# Host Box protocol

The Deadly Host Box (a hardware idea, designed but not built: six
shot glasses in a glowing LED ring round one 60 mm arcade button, a speaker,
USB-C power, an ESP32-S3 brain) is a table-top peripheral for a room on
the Games site. It has no screen and no keyboard, so every decision it
needs is either made by the host from their phone, or made for it by the
server. This document is the server side of that contract: the games server
never talks to the box's firmware directly, only over the room protocol
already described at the top of `lib/rooms.mjs`. This file is the detail on
the `device`/`press`/`longpress`/`heartbeat`/pairing slice of it.

A box is **one physical thing per room**. It is not a player: it never has a
name or a vote, and nothing it does is a secret. It is the room's hardware
remote and its party atmosphere, nothing more.

## Why one device role, not a second server

Adding the box as a connection role next to players and TVs (`lib/rooms.mjs`)
means it gets rejoin, host failover interaction, room expiry and the rate
limiter for free, and the box's button presses are dispatched through the
exact same `hostOp`/`act` code path a phone tap would use (see "Pressing the
button" below) — there is no second, parallel way for the room to change.

## Pairing

The box has no screen, so it can never show a code for a human to type on
the website (the usual room-join direction). There is exactly **one** way a
box becomes trusted for a room: an explicit `pairBox` from that room's host.
A remembered room code is only ever a *reconnect* shortcut for a box that
has already been through that approval once — never a second way to get
approved in the first place.

**Why this matters.** A room code is deliberately low-trust and shared
broadly (a QR code, an invite link, a code read off a shared screen) so
anyone can join as a regular player. The Host Box is not a regular player:
its button fires host-level actions (start, standings, next) and its
long-press can hand host to another player. If knowing the room code were
ever enough to attach as the box, anyone who saw that code could open a raw
WebSocket, send `{ t: 'device', boxId: 'anything', code }` and immediately
acquire host-level control with no pairing ceremony at all. So the code path
below only ever *resumes* a pairing the host already made; it can never
*create* one.

**1. From the lobby ("Add a Host Box"), every box's first time.** The box
says `{ t: 'device', boxId }` (no room code, or a room code the host has not
yet approved for that room — same outcome either way), so the server holds
its connection in `pendingBoxes` waiting to be claimed. The host opens "Add
a Host Box" in the lobby, enters or scans the short ID printed on the box
(or shown by the simulator, see below), and the client sends
`{ t: 'host', op: 'pairBox', boxId }`. The server looks the connection up by
that ID and attaches it. Nothing is sent to the box to make this happen; it
simply starts receiving `scene`/`button`/`audio` for this room on the
connection it already has open.

**2. Reconnecting, once approved.** The box's own setup flow (a captive
wifi portal on first boot, firmware's problem, not this server's) can let
someone type in a room code once, which the firmware remembers in flash and
sends on every later `{ t: 'device', boxId, code }`. The server only honours
that code if `room.box` already exists **and its id matches this boxId** —
i.e. a host already ran `pairBox` for this exact box in this exact room, so
this is a resume, not a new trust decision. A wifi blip, a reboot, or the
simulator reloading all hit this path and reattach with no host action. A
box with a remembered code for a room nobody has approved it for (its very
first boot, or a room it was never paired to) falls straight back to flow 1
and waits in `pendingBoxes` like any other unknown box. If the room itself
is gone (ended, restarted), the server replies `{ code: 'noroom' }` instead;
either way the firmware's job is to fall back to "waiting to be paired"
rather than retrying forever.

Both flows call the same internal `attachBox()`. Only one box can be paired
to a room at a time; a second `pairBox`, or a second device's code-based
hello, is an error until the first one is unpaired (`unpairBox`).

```
Box boot ------------------------------------------------------------------+
  |                                                                        |
  | has a remembered room code for a box this room has already approved?  |
  |-- yes --> { t:'device', boxId, code } --> reattached, or noroom -------+
  |                                                                        |
  |-- no (new box, new room, or not yet approved) ---+
                                                      |
                              { t:'device', boxId [, code] } --> held in pendingBoxes
                                                      |
                              host: "Add a Host Box", enters/scans boxId
                                                      |
                              { t:'host', op:'pairBox', boxId } --> attached
                                                      |
                              (now flow 2 applies on every future reconnect)
```

`boxId` is a short id the box (or the simulator) makes up for itself and
keeps for its own lifetime (`/^[A-Za-z0-9]{4,12}$/`); it identifies the
physical box, not a room. A room code identifies the party; the two are
unrelated and a box can be unpaired and re-paired to a different room freely
(`unpairBox`, then pair again — which starts back at flow 1 for the new
room, since the old room's approval does not carry over).

## Seating: mapping glasses to players

"The landed slot number maps to the player whose glass sits there" is
configuration, not telemetry: the host sets it, `room.box.slots` is an array
of 6 entries (`playerId | null`), one per physical glass, via
`{ t: 'host', op: 'setBoxSlots', slots }`. Scenes that target specific
players (`deadlyTakeover`, `roulette`, `winner`) translate those player ids
to slot indices server-side before telling the box anything, so the box's
firmware never needs to know who anyone is — only "light slot 3". A targeted
player with no assigned glass is simply left out of that scene's `slots`;
the moment still happens (voice, LEDs on the slots that *are* known), it is
just not shown on an unassigned glass.

`{ t: 'host', op: 'assignBoxPlayer', playerId }` sets which room player the
box's button acts as for anything that is not a host-level move (see
below) — it defaults to whoever is host. This is also who the box's
long-press hands host to.

## Wire messages

All of this rides the same `/ws` connection and JSON envelope as players and
TVs (`lib/rooms.mjs` header comment has the full room protocol). Only the
box-specific messages are detailed here.

### Box -> server

| Message | When | Notes |
|---|---|---|
| `{ t:'device', boxId, code? }` | On connect, and again any time it wants to (re)identify | `code` attaches straight to that room; omit it to wait for `pairBox` |
| `{ t:'press' }` | Short press of the arcade button | Server looks up what the button currently means and does that (see below) |
| `{ t:'longpress' }` | Long press (≈800ms+; the firmware's threshold, not the server's) | Passes host to the box's assigned player |
| `{ t:'heartbeat' }` | Periodically (a few times a minute) | Just updates `lastSeen`; the transport-level ping in `server.mjs` already detects a dead socket, this is for the box to report its own liveness/health later (battery, etc.) without overloading `ping` |

### Server -> box

| Message | When | Payload |
|---|---|---|
| `{ t:'paired', code }` | Pairing succeeds | The room code, mostly for the box's own logs |
| `{ t:'unpaired', reason }` | Host unpairs it, or the room closes/expires | The box should go back to its idle scene and start listening for a new pairing |
| `{ t:'scene', name, params }` | Whenever the computed scene changes (deduped; see below) | `name` one of `idle \| teamColours \| countdown \| roulette \| deadlyTakeover \| winner` |
| `{ t:'button', mode, label }` | Whenever what the button would do changes | `mode` a short tag for the firmware's lamp colour/animation; `label` human text, mostly for the simulator |
| `{ t:'audio', url, text }` | A voice line was rendered | `url` is a path on this same server (`/hostbox/voice/<hash>.wav`); `text` is what it says, for a simulator/log, not for the box to re-derive anything from |
| `{ t:'buttonResult', ok, message? }` | Right after a `press` is handled | So the box can flash the lamp red briefly on a rejected press (e.g. buzzed a split second too late); not sent for `longpress` |

## Scenes

Computed fresh on every room broadcast by `lib/hostbox.mjs`'s `sceneFor()`
(pure, unit tested in `test/hostbox.test.mjs`), and only sent to the box when
it actually changed from the last one sent (`sameDescriptor`), so pairing a
box does not mean a message on every single tap in the room. Precedence,
highest first:

1. **`winner`** — the game just ended. `params.slots`: the winning
   glass(es) (from `$over.board`'s top score).
2. **`roulette`** — a Shot Roulette or a last-place-tie spin
   (`games/_kit/drinks.js`'s `shotRoulette`/`lastPlaceShot`).
   `params.candidateSlots`: every glass in the spin; `params.landedSlot`: the
   one it lands on (the drink engine already knows the outcome by the time
   the moment is created, so there is no live random spin to drive from the
   server — the box animates "spin, then land on landedSlot" however looks
   good for the roughly 3 seconds `MOMENT_SHOW_MS` allows, see
   `games/_kit/drinks.js`).
3. **`deadlyTakeover`** — any other Deadly moment with a shot in it (a plain
   shot, a Tall Poppy, a team shot, a Deadly card). `params.slots`: every
   glass that drinks.
4. **`countdown`** — a game deadline (`engine.deadline()`) inside its last 15
   seconds. `params.seconds`: whole seconds left.
5. **`teamColours`** — teams are set for the room and nothing more urgent is
   happening. `params.teams`: `[{ color, slots }]`.
6. **`idle`** — the fallback: nothing going on, breathe gently.

A Mercy Round (`kind: 'water'`) is deliberately **not** a Deadly moment on
the box: it is a calm pause, not a spotlight, so it resolves to `idle`.

## Pressing the button

`buttonModeFor()` in `lib/hostbox.mjs` decides, from the room's current
state, what a press does right now, and the same function decides the
`label`/`mode` the box is told about so a press and the message that
preceded it always agree:

- **Lobby, nobody started**: `start`, runs `{ host: 'start' }` as the host.
- **Between games (Party Night) waiting on the next game**: `next`, runs
  `{ host: 'next' }` as the host (defaults to the queue's head).
- **Recap screen**: `idle` — nothing sensible to auto-trigger (starting a
  new night wipes the scores, so that stays a deliberate tap on a phone).
- **A game just finished**: `standings`, runs `{ host: 'standings' }`.
- **A game is running**: an engine may export `boxButton(state, ctx)` to
  claim the button (see `docs/GAME-MODULES.md`); Quiz Show is the one
  example today, turning a live buzzer race into a physical buzzer for the
  box's assigned player. Without that, the platform falls back to whichever
  of the game's own `hostActions()` is `tone: 'primary'` with no `confirm`
  (every game has exactly one of these at any moment — it is the "move my
  own flow along" button already in the host bar on every phone), run as the
  host. An action with `confirm` is never auto-fired by the box; there is no
  screen on it to show the confirmation on.
- **Nothing matches any of the above**: `idle`.

A press is dispatched by literally constructing the same `{ room, playerId }`
pair a phone's connection would carry and calling the exact same
`hostOp`/`act` methods `lib/rooms.mjs` already uses for a tap on a phone —
the box is not a second way to mutate a room, it is the same way, with the
button standing in for whichever player (host, or the box's assigned player
for a non-host move) would otherwise have tapped it.

**Long press** has one fixed v1 meaning: pass host to the box's assigned
player (a literal "hand over the baton", since the box sits at the middle of
the table). A no-op if that player is not connected or is already host.

## Voice

`lib/voice.mjs` holds short, templated lines (pure text, unit tested,
several phrasings per event picked at random so the box does not say the
exact same thing every time) for:

- a new round starting (game name, a Deadly-tier mention when relevant)
- every Deadly moment (`games/_kit/drinks.js`'s `moment` object: a shot, a
  roulette landing, a last-place shot, a Deadly card)
- the game ending (names the winner from `$over.board`)
- the Party Night recap starting (names whoever is leading on points)

`lib/tts.mjs` renders a line through a Kokoro TTS server you run
(`KOKORO_SERVER_URL`, default
`http://127.0.0.1:8124`, `POST /tts { text, voice, speed }` returning a WAV;
`HOSTBOX_VOICE` picks the voice, default `af_sky`) and caches the result on
disk under `data/hostbox-voice/<sha1-of-voice-speed-text>.wav`, so a
repeated line (there are only a few dozen distinct templates) is rendered
once ever, not once per party. `server.mjs` serves that directory at
`/hostbox/voice/<hash>.wav` with an immutable cache header (the filename is
the content hash, so it can never go stale).

Audio is plain WAV (mono, 24 kHz from Kokoro) on purpose: the ESP32 can read
raw PCM frames into its I2S amp with no decoder, where MP3/Opus would need
one. If Kokoro is unreachable, `say()` resolves `null` and the room simply
never sends that `audio` message — the LEDs and button keep working with no
voice, and nothing in the room's own logic blocks on it (every call is
fire-and-forget from `lib/rooms.mjs`'s `announce()`).

**No LLM flavour in this step.** The plan's decision text allows "optional
LLM flavour behind the same daily spend cap as AI packs" once custom/AI
packs exist; they do not exist in this repo yet, so there is no shared cap to
sit behind. Building a one-off spend cap just for this would be exactly the
kind of speculative, half-finished feature this codebase's own standards
rule out. `lib/voice.mjs`'s templates are the whole v1 voice; when packs land
and bring real spend tracking, a flavour pass can sit between `lineFor()`
and `tts.say()` without changing anything else here.

## Safety and privacy

Nothing a box sees or says is a secret: every message to it is drawn from
`publicDrink()` (already everyone-visible) and public game state
(`$over`, `deadline`, `teams`). A box is never told a player's secret role,
vote or answer. A box's button carries real power, though (host-level moves,
and passing host on long-press), so pairing always requires an explicit
`pairBox` from that room's own host (see "Pairing" above) — never just
knowledge of the room code, which is shared far more broadly than that and
was never meant to carry that much trust. The actual security boundary is
the host's deliberate approval of a specific box ID, the same as setting up
a physical buzzer system by hand.

## The virtual Host Box (testing without hardware)

`public/hostbox.html` (served at `/hostbox`, `public/js/hostboxsim.js`) is a
browser page that speaks the exact device protocol above: it makes up a
`boxId` on first load and remembers it in `localStorage`, shows that ID big
for pairing, lets you join directly with a room code too, renders the 6-slot
LED ring and the scenes as SVG/CSS, plays `audio` clips, and has one big
on-screen button that distinguishes a tap from a hold. Open it in a second
tab (or a second real device) alongside a room to pair and drive it exactly
as the hardware eventually will, with nothing else to install.
