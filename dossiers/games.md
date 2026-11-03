---
slug: games
name: Games
repo: .
status: active
last_verified: 2026-11-03
tags: [node, websocket, pwa, party-games]
---

Free party and drinking games, played on one phone or in a room. Each claim below is pinned to the code that backs it.

## Features

- A room is joined with a four letter code that leaves out I and O. <!-- src: lib/rooms.mjs:59-60 -->
- A room closes after three idle hours. <!-- src: lib/rooms.mjs:114 -->
- A one-phone game keeps its state in the browser's localStorage, not on the server. <!-- src: public/js/pass.js:26-34 -->
- A game is a self-contained folder that the server discovers on its own. <!-- src: lib/registry.mjs:1-3 -->
- Drinking and Deadly tiers ask for a one-time 18+ confirmation. <!-- src: public/js/ui.js:374-375 -->
- The AI pack maker reads its key from `OPENROUTER_API_KEY` and has a daily spend cap of 0.5 USD by default. <!-- src: server.mjs:83-85 -->
- MIT licensed, apart from the Quiz Show question file, which stays CC BY-SA 4.0. <!-- src: LICENSE:1-3, THIRD_PARTY_NOTICES.md:10 -->

## Deploy

- Out of the box it listens on 127.0.0.1 port 8969. <!-- src: server.mjs:35-38 -->
- Rate limits key on the `CF-Connecting-IP` header, then the socket address. <!-- src: server.mjs:24 -->
- Own-phone rooms need the WebSocket endpoint at `/ws`. <!-- src: server.mjs:466 -->
- CI runs the tests and the secret scan, on the public repository only. <!-- src: .github/workflows/ci.yml:18, .github/workflows/ci.yml:27-30 -->
- Security reports go through GitHub private vulnerability reporting, not a public issue. <!-- src: SECURITY.md:3-7 -->

## Generated facts

<!-- auto:start -->
- package: games
- npm scripts (9): start, lan, test, e2e, canary, plays, deps, scan, export
- dependencies (2): qrcode-generator, ws
- devDependencies (1): playwright-core
<!-- auto:end -->
