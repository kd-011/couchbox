# Design

Device: phone-first. Tier: public-site.

## Direction

A party in one room: phones held at arm's length and a TV read from the couch. The world is a dark room lit by whichever game is on. Each game owns one colour (`meta.accent`) that floods the screen it is played on: the stage glow, the primary button, timers, picks and the TV backdrop. The platform around the games is ink and amber. One display face, Bricolage Grotesque, squeezed narrow and heavy for anything that should be read from across a room; system sans for body text. Portrait phone first (390x844 is the journey viewport), with the TV view as the second surface. Dark only.

## Identity

The stage light: every screen glows in its game's accent colour, so a glance at the room tells you which game is on.

## System

Tokens: `public/style.css` (`:root`). Kit: `public/kit/` (vendored ui-kit, changes go upstream). Game styles: `games/<id>/style.css`. Icons: original SVGs from `public/js/ui.js` `icon()` and `public/kit/icons.svg`; game art is each game's `icon.svg`. Font: `public/fonts/bricolage.woff2`.

## Refuses

- Stock art, stock photography or third-party illustration: every icon is drawn for the site (stated on `/credits`).
- A second display face or a light theme.
- Motion that ignores `prefers-reduced-motion`.
- Ads, sign-up walls or anything between a player and the game.

## Surfaces

- Home: persuading and operating. Find a game fast (search, vibe filters, Surprise me), join a room by code.
- Game start: operating. Pick one phone or everyone's phone, pick the tier, one tap to play.
- Room lobby (host and players): operating. Code, QR and seats up front, ready states, host controls.
- In game, phone: operating. The player's private view and the host bar.
- TV `/tv/CODE`: operating at distance. Code and QR huge in the lobby, the game's public view in play.
- Pass and play: operating. Hide-and-pass screens between private looks.
- Rules page `/games/<id>`: persuading. How to play, tiers, one Play button.
- Privacy, credits, 404: plain prose pages in the same shell.
