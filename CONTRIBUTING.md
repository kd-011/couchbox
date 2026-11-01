# Contributing

Thanks for looking. Small, focused changes are easiest to land.

## Set up

```sh
npm install
npm start          # http://127.0.0.1:8969
npm test           # runs in under a minute, no browser
```

Node 22 or newer. The browser tests (`npm run e2e`, `e2e/*.mjs`) need a Chromium that Playwright can find (`npx playwright-core install chromium`). Run them when you change a game's flow or the UI. Do not run several of them at once, they compete for CPU and time out.

## What to send

- **Content packs.** Curated decks live in `games/<id>/packs/*.json`. Write original prompts, words and questions. Do not paste from other games or sites unless the licence allows it, and say where it came from in the PR.
- **Bug fixes.** Add a test that fails without the fix.
- **A new game.** It is one folder, `games/<id>/`, and never touches a shared file. Read `docs/GAME-MODULES.md`, copy `games/_example/`, and meet the checklist at the end of that doc. The example is hidden unless `GAMES_EXAMPLE=1`.
- **Anything large or UI-wide.** Open an issue first.

## Ground rules

- No accounts, no database, no analytics. That is a feature.
- Secret information (a player's role, the secret word) must never reach a client that should not see it. Each game has a `secrets.test.mjs` for this, keep yours passing.
- Game engines are pure state machines that run on the server and in the browser. No `Date.now()` or `Math.random()` in game logic, use `ctx.now` and `ctx.rng`.
- Drinking and Deadly tiers are for adults and every drink prompt must stay skippable.
- Match the surrounding style. Plain English in UI copy.

## Before you open a PR

1. `npm test` passes.
2. Do not commit `.env`, `data/`, screenshots from your own sessions or anything with real names in it.
3. `node scripts/secret-scan.mjs . --tracked` reports clean.

By contributing you agree your work is released under the MIT licence of this repo.
