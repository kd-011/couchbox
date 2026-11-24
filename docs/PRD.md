---
slug: games-prd
name: Games PRD
repo: .
status: active
last_verified: 2026-11-23
---

# Games: product requirements

## Purpose

Games (published as couchbox) is a free party and drinking game site for a group in the same room, played on their phones with no app and no sign-up. It stands in for paid single-game apps: one site, fifteen games, each playable on one passed-around phone or on everyone's own phone with a shared TV screen. No accounts, no ads and no database, so there is nothing to sign up for and nothing to leak.

## Audience

Adults (18+) at a party or a night in, all in one room and able to hear each other. They reach it by opening the site, or by scanning a room's QR code or typing its four letter code. Self-hosters run their own copy with one command or Docker (see docs/SELF-HOSTING.md).

## Features

- **[shipped]** Fifteen games: Imposter, Celebrity Heads, Never Have I Ever, Most Likely To, Would You Rather, Truth or Dare, Quiz Show, Fake Out, Sketchy, Codewords, Spyfall, Werewolf, Paranoia, Salad Bowl and Tune In. <!-- src: games/imposter/engine.js:19, games/heads/engine.js:24, games/nhie/engine.js:11, games/mlt/engine.js:12, games/wyr/engine.js:12, games/tod/engine.js:12, games/quiz-show/engine.js:22, games/fake-out/engine.js:13, games/sketchy/engine.js:12, games/codewords/engine.js:17, games/spyfall/engine.js:17, games/werewolf/engine.js:21, games/paranoia/engine.js:13, games/salad-bowl/engine.js:14, games/tune-in/engine.js:17 -->
- **[shipped]** Pass and play: one phone runs the whole game in the browser, with hide-and-pass screens before each private look, and keeps its state in localStorage so a refresh does not lose it. <!-- src: public/js/pass.js:1-4, public/js/pass.js:24-34 -->
- **[shipped]** Rooms: everyone joins on their own phone with a four letter code (no I or O), a `/r/CODE` link or a QR code; the server is authoritative and sends each phone only its own view. <!-- src: lib/rooms.mjs:1-11, lib/rooms.mjs:59-60, server.mjs:411-415 -->
- **[shipped]** TV screen at `/tv/CODE`: no identity and no secrets, only the game's public view, with the code and QR shown large in the lobby. "Show on TV" casts it where the browser supports the Presentation API. <!-- src: public/js/tv.js:1-4, public/js/tvcast.js:1-4 -->
- **[shipped]** Three tiers per game: Standard (points), Drinking (sips) and Deadly (sips plus rare, announced shots), all run by one shared drink engine. <!-- src: games/_kit/drinks.js:1-8 -->
- **[shipped]** Drinking safety rails: a host-set shot cap per player per rolling hour, water-break nudges, "I'm out" turns a player's drinks into forfeits, and the host can drop the tier mid-game. <!-- src: games/_kit/drinks.js:10-17 -->
- **[shipped]** One-time 18+ confirmation before drinking content shows on a device, with a separate explainer for Deadly. <!-- src: public/js/ui.js:372-375 -->
- **[shipped]** Party Night: several games in a row with scores, stats and drink tallies carried across, standings between games and an awards ceremony with a shareable recap image. <!-- src: games/_kit/night.js:1-5, public/js/nightui.js:1-4 -->
- **[shipped]** Host controls: pass host, kick, split teams, send a player to the audience, and an emoji reaction any player can float across every screen. <!-- src: lib/rooms.mjs:15-26 -->
- **[shipped]** Curated packs: hand-written themed decks that ship inside a game folder and are precached for offline play. <!-- src: lib/curated.mjs:1-11, public/js/packs.js:1-4 -->
- **[shipped]** Custom packs: anyone can make a deck for a game that supports it and share it by an eight character code; packs are unlisted, profanity-checked and limited to 20 per IP per hour. <!-- src: lib/packs.mjs:1-6, lib/packs.mjs:13-20, lib/profanity.mjs:1-5 -->
- **[shipped]** AI pack maker: type a theme and get a themed pack through OpenRouter, behind a hard daily spend cap and 8 generations per IP per hour. Off without `OPENROUTER_API_KEY`. <!-- src: lib/ai-packs.mjs:1-5, lib/ai-packs.mjs:16-21, server.mjs:81-85 -->
- **[shipped]** Installable PWA that works offline once loaded over https, with home-screen shortcuts for Join, Host and TV. The install prompt waits for the first finished game. <!-- src: public/sw.js:1-4, public/manifest.webmanifest, public/js/install.js:1-4 -->
- **[shipped]** A crawlable rules page per game at `/games/<id>`, built from the game's meta and `rules.md`, plus a generated sitemap. <!-- src: server.mjs:225-227, server.mjs:324-334 -->
- **[shipped]** Self-hosting: `npx github:kd-011/couchbox` or `npm run lan` serves on the local network and prints the address and a QR code; a Dockerfile and compose file run it as a non-root user with packs in a volume. <!-- src: bin/couchbox.mjs:1-10, lib/lan.mjs:1-2, Dockerfile, compose.yaml -->
- **[partial]** Host Box: a table-top hardware remote for Deadly rooms. The server protocol and a browser simulator at `/hostbox` are built; the hardware is designed, not built. Optional voice lines come from a Kokoro TTS server and stay silent without one. <!-- src: docs/HOSTBOX-PROTOCOL.md:3, lib/hostbox.mjs:1-5, server.mjs:365-369, lib/tts.mjs:1-7 -->
- **[shipped]** Play telemetry: rooms write greppable `[rooms]` lines with no names or player ids, and `npm run plays` summarises them per game. <!-- src: docs/TELEMETRY.md:1-5, lib/plays.mjs:1-12 -->

## Non-goals

- Accounts, a database or analytics.
- Players in different places: it assumes everyone can hear each other.
- Children: Standard has no drinking, but the prompts are written for adults.
- Public events: one process holds rooms in memory and a restart ends them.
- Professional writing or voice acting at the level of paid party game boxes.

## Unverified

- Casting with Show on TV has not been tried on real hardware (the README says so); opening the TV address in a browser is the tested path.
- Safari gets less automated coverage than Chromium.
