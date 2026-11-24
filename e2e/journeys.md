# Golden journeys

The things done in Games most, phone first (390x844, touch). Each is a Playwright spec (`playwright-core`, one
Chromium, run one at a time) walked against `e2e/preview.mjs`: a real server on a spare port with a scratch packs
folder and no AI key, so nothing touches the live site or spends money. Rooms live in memory, so there is nothing
else to seed.

- Find a game: the home lists every game, search narrows it, a dead search has a way out and Surprise me deals a real game (`e2e/find-game.spec.mjs`)
- Host a room: tap a game, type a name, and the lobby shows the 4-letter code, the QR and the host's seat (`e2e/host-room.spec.mjs`)
- Join a friend's room: type the code on the home page, pick a name, and the host's lobby and the TV screen both show the newcomer (`e2e/join-room.spec.mjs`)
- Start the game with three phones: every phone gets a card, exactly one is the imposter and the TV never carries the secret word (`e2e/start-game.spec.mjs`)
- Pass one phone round: hand-over screens hide the card, the Drinking tier is behind the 18+ confirm and a refresh mid-game keeps the game (`e2e/pass-and-play.spec.mjs`)

Run by hand: `node e2e/preview.mjs` (prints `PREVIEW_URL=...`), then `PREVIEW_URL=<it> node --test --test-concurrency=1 e2e/*.spec.mjs`.
The older scripts in `e2e/` (`play.mjs`, `matrix.mjs`, `home.mjs` and the rest) are the QA harness and are not journeys.
