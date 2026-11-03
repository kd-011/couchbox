# Host Box protocol

The Deadly Host Box is a table-top peripheral for a room on the Games site. It is a hardware idea that has been designed but not built: six shot glasses in a glowing LED ring round one 60 mm arcade button, a speaker, USB-C power and an ESP32-S3 brain. It has no screen and no keyboard, so the host decides everything it needs from their phone, or the server decides for it. This document is the server side of that contract. The games server never talks to the box's firmware directly, only over the room protocol described at the top of `lib/rooms.mjs`. This file covers the `device`/`press`/`longpress`/`heartbeat`/pairing slice of it.

A box is one physical thing per room. It is not a player: it never has a name or a vote, and nothing it does is a secret. It is the room's hardware remote and its party atmosphere.

## Why one device role, not a second server

The box is a connection role next to players and TVs (`lib/rooms.mjs`), so it gets rejoin, host failover interaction, room expiry and the rate limiter for free. Its button presses go through the same `hostOp`/`act` code path a phone tap uses (see "Pressing the button" below), so the room has only one way to change.

## Pairing

The box has no screen, so it can never show a code for a human to type on the website, which is the usual room-join direction. A box becomes trusted for a room in exactly one way: an explicit `pairBox` from that room's host. A remembered room code is only a reconnect shortcut for a box that has already been through that approval once. It never gets a box approved in the first place.

Why this matters: a room code is low-trust on purpose and shared widely (a QR code, an invite link, a code read off a shared screen), so anyone can join as a regular player. The Host Box is not a regular player. Its button fires host-level actions (start, standings, next) and its long-press can hand host to another player. If knowing the room code were enough to attach as the box, anyone who saw the code could open a raw WebSocket, send `{ t: 'device', boxId: 'anything', code }` and take host-level control with no pairing at all. So the code path below only resumes a pairing the host already made. It can never create one.

Flow 1, from the lobby ("Add a Host Box"), is how every box starts. The box says `{ t: 'device', boxId }`, with no room code or with a room code the host has not yet approved for that room (the outcome is the same), and the server holds its connection in `pendingBoxes` to be claimed. The host opens "Add a Host Box" in the lobby and enters or scans the short ID printed on the box (or shown by the simulator, see below). The client then sends `{ t: 'host', op: 'pairBox', boxId }`. The server looks the connection up by that ID and attaches it. Nothing is sent to the box for this. It starts receiving `scene`/`button`/`audio` for this room on the connection it already has open.

Flow 2, reconnecting once approved. The box's own setup flow (a captive wifi portal on first boot, which is firmware's problem and not this server's) can let someone type in a room code once. The firmware remembers it in flash and sends it on every later `{ t: 'device', boxId, code }`. The server only honours that code if `room.box` already exists and its id matches this boxId, meaning a host already ran `pairBox` for this exact box in this exact room, so this is a resume and not a new trust decision. A wifi blip, a reboot or the simulator reloading all take this path and reattach with no host action. A box with a remembered code for a room nobody has approved it for (its very first boot, or a room it was never paired to) falls back to flow 1 and waits in `pendingBoxes` like any other unknown box. If the room itself is gone (ended, restarted), the server replies `{ code: 'noroom' }` instead. Either way the firmware should fall back to "waiting to be paired" and not retry forever.

Both flows call the same internal `attachBox()`. Only one box can be paired to a room at a time. A second `pairBox`, or a second device's code-based hello, is an error until the first one is unpaired (`unpairBox`).

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

`boxId` is a short id the box (or the simulator) makes up for itself and keeps for its own lifetime (`/^[A-Za-z0-9]{4,12}$/`). It identifies the physical box, not a room. A room code identifies the party. The two are unrelated, and a box can be unpaired and paired to a different room freely (`unpairBox`, then pair again). That starts back at flow 1 for the new room, since the old room's approval does not carry over.

## Seating: mapping glasses to players

Which player's glass sits at a landed slot is configuration, not telemetry. The host sets it: `room.box.slots` is an array of 6 entries (`playerId | null`), one per physical glass, set via `{ t: 'host', op: 'setBoxSlots', slots }`. Scenes that target specific players (`deadlyTakeover`, `roulette`, `winner`) translate those player ids to slot indices on the server before telling the box anything. The firmware never needs to know who anyone is, only "light slot 3". A targeted player with no assigned glass is left out of that scene's `slots`. The moment still happens (voice, LEDs on the slots that are known), it just is not shown on an unassigned glass.

`{ t: 'host', op: 'assignBoxPlayer', playerId }` sets which room player the box's button acts as for anything that is not a host-level move (see below). It defaults to whoever is host, and that player is also who the box's long-press hands host to.

## Wire messages

All of this rides the same `/ws` connection and JSON envelope as players and TVs (the `lib/rooms.mjs` header comment has the full room protocol). Only the box-specific messages are detailed here.

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

`sceneFor()` in `lib/hostbox.mjs` computes the scene fresh on every room broadcast. It is pure and unit tested in `test/hostbox.test.mjs`. A scene is only sent to the box when it differs from the last one sent (`sameDescriptor`), so pairing a box does not mean a message on every tap in the room. Precedence, highest first:

1. `winner`: the game just ended. `params.slots` holds the winning glass(es), from `$over.board`'s top score.
2. `roulette`: a Shot Roulette or a last-place-tie spin (`shotRoulette`/`lastPlaceShot` in `games/_kit/drinks.js`). `params.candidateSlots` holds every glass in the spin and `params.landedSlot` the one it lands on. The drink engine already knows the outcome when the moment is created, so the server has no live random spin to drive. The box animates "spin, then land on landedSlot" however looks good for the roughly 3 seconds `MOMENT_SHOW_MS` allows (see `games/_kit/drinks.js`).
3. `deadlyTakeover`: any other Deadly moment with a shot in it (a plain shot, a Tall Poppy, a team shot, a Deadly card). `params.slots` holds every glass that drinks.
4. `countdown`: a game deadline (`engine.deadline()`) inside its last 15 seconds. `params.seconds` is the whole seconds left.
5. `teamColours`: teams are set for the room and nothing more urgent is happening. `params.teams` is `[{ color, slots }]`.
6. `idle`: the fallback. Nothing is going on, so it breathes gently.

A Mercy Round (`kind: 'water'`) is not a Deadly moment on the box. It is a calm pause and not a spotlight, so it resolves to `idle`.

## Pressing the button

`buttonModeFor()` in `lib/hostbox.mjs` decides from the room's current state what a press does. The same function decides the `label`/`mode` the box is told about, so a press and the message before it always agree:

- Lobby, nobody started: `start`, runs `{ host: 'start' }` as the host.
- Between games (Party Night), waiting on the next game: `next`, runs `{ host: 'next' }` as the host (defaults to the queue's head).
- Recap screen: `idle`. Starting a new night wipes the scores, so that stays a deliberate tap on a phone.
- A game just finished: `standings`, runs `{ host: 'standings' }`.
- A game is running: an engine may export `boxButton(state, ctx)` to claim the button (see `docs/GAME-MODULES.md`). Quiz Show is the only example today: it turns a live buzzer race into a physical buzzer for the box's assigned player. Without that, the platform falls back to whichever of the game's own `hostActions()` is `tone: 'primary'` with no `confirm`. Every game has exactly one of these at any moment: it is the "move my own flow along" button already in the host bar on every phone, and it runs as the host. The box never auto-fires an action with `confirm`, since it has no screen to show the confirmation on.
- Nothing matches any of the above: `idle`.

A press is dispatched by building the same `{ room, playerId }` pair a phone's connection would carry and calling the same `hostOp`/`act` methods `lib/rooms.mjs` uses for a tap on a phone. The button stands in for whichever player would otherwise have tapped it: the host, or the box's assigned player for a non-host move.

A long press has one fixed v1 meaning: pass host to the box's assigned player, a literal handing over of the baton since the box sits in the middle of the table. It does nothing if that player is not connected or is already host.

## Voice

`lib/voice.mjs` holds short templated lines (pure text, unit tested, with several phrasings per event picked at random so the box does not say the same thing every time) for:

- a new round starting (game name, a Deadly-tier mention when relevant)
- every Deadly moment (`games/_kit/drinks.js`'s `moment` object: a shot, a roulette landing, a last-place shot, a Deadly card)
- the game ending (names the winner from `$over.board`)
- the Party Night recap starting (names whoever is leading on points)

`lib/tts.mjs` renders a line through a Kokoro TTS server you run (`KOKORO_SERVER_URL`, default `http://127.0.0.1:8124`, `POST /tts { text, voice, speed }` returning a WAV; `HOSTBOX_VOICE` picks the voice, default `af_sky`). It caches the result on disk under `data/hostbox-voice/<sha1-of-voice-speed-text>.wav`. There are only a few dozen distinct templates, so a repeated line is rendered once ever and not once per party. `server.mjs` serves that directory at `/hostbox/voice/<hash>.wav` with an immutable cache header. The filename is the content hash, so it can never go stale.

Audio is plain WAV (mono, 24 kHz from Kokoro) because the ESP32 can read raw PCM frames into its I2S amp with no decoder, where MP3 or Opus would need one. If Kokoro is unreachable, `say()` resolves `null` and the room never sends that `audio` message. The LEDs and button keep working without voice, and nothing in the room's own logic waits on it (every call is fire-and-forget from `announce()` in `lib/rooms.mjs`).

There is no LLM flavour in this step. The plan's decision text allows optional LLM flavour behind the same daily spend cap as AI packs once custom and AI packs exist. They do not exist in this repo yet, so there is no shared cap to sit behind, and a one-off cap just for this would be speculative and half finished. The templates in `lib/voice.mjs` are the whole v1 voice. When packs land and bring real spend tracking, a flavour pass can sit between `lineFor()` and `tts.say()` without changing anything else here.

## Safety and privacy

Nothing a box sees or says is a secret. Every message to it is drawn from `publicDrink()` (already visible to everyone) and public game state (`$over`, `deadline`, `teams`). A box is never told a player's secret role, vote or answer. Its button does carry real power (host-level moves, and passing host on long-press), so pairing always needs an explicit `pairBox` from that room's own host (see "Pairing" above). Knowing the room code is never enough, because the code is shared far more widely and was never meant to carry that much trust. The security boundary is the host's deliberate approval of a specific box ID, the same as setting up a physical buzzer system by hand.

## The virtual Host Box (testing without hardware)

`public/hostbox.html` (served at `/hostbox`, `public/js/hostboxsim.js`) is a browser page that speaks the device protocol above. On first load it makes up a `boxId` and remembers it in `localStorage`, and it shows that ID big for pairing. You can also join directly with a room code. It renders the 6-slot LED ring and the scenes as SVG/CSS, plays `audio` clips, and has one big on-screen button that tells a tap from a hold. Open it in a second tab (or on a second real device) next to a room to pair and drive it as the hardware eventually will, with nothing else to install.
