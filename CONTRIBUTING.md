# Contributing

Small, focused changes are the easiest to land.

## Set up

```sh
npm install
npm start          # http://127.0.0.1:8969, this computer only
npm run lan        # the same, reachable from phones on your network
npm test           # runs in under a minute, no browser
```

Node 20 or newer, developed on 22. The browser tests (`npm run e2e`, `e2e/*.mjs`) need a Chromium that Playwright can find (`npx playwright-core install chromium`). Run them when you change a game's flow or the UI. Do not run several at once: they compete for CPU and time out.

## What to send

- Content packs. Curated decks live in `games/<id>/packs/*.json`. Write original prompts, words and questions. Do not paste from other games or sites unless the licence allows it, and say where it came from in the PR.
- Bug fixes. Add a test that fails without the fix.
- A new game. It is one folder, `games/<id>/`, and never touches a shared file. Read `docs/GAME-MODULES.md`, copy `games/_example/` and work through the checklist at the end of that doc. The example is hidden unless `GAMES_EXAMPLE=1`.
- Anything large or UI-wide. Open an issue first.

## Ground rules

- No accounts, no database, no analytics.
- Secret information (a player's role, the secret word) must never reach a client that should not see it. Each game has a `secrets.test.mjs` for this, so keep yours passing.
- Game engines are pure state machines that run on the server and in the browser. No `Date.now()` or `Math.random()` in game logic, use `ctx.now` and `ctx.rng`.
- Drinking and Deadly tiers are for adults and every drink prompt must stay skippable.
- Match the surrounding style and keep UI copy in plain English.

## Before you open a PR

1. `npm test` passes.
2. Do not commit `.env`, `data/`, screenshots from your own sessions or anything with real names in it.
3. `node scripts/secret-scan.mjs . --tracked` reports clean.

## How a PR lands

This repository is published from a private source, one commit at a time. A change you send is applied there, reaches `main` here with the next export, and the PR is then closed. Dependabot PRs go the same way, so nothing merges here directly.

By contributing you agree your work is released under the MIT licence of this repo.
