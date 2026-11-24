# Games: decisions

Dated why-log, newest first. Entries are records, never deleted; one that no longer holds is marked `Superseded <date>: <what replaced it>.` Add new decisions here.

- 2026-11-22: Docs live in the repo (AGENTS.md, docs/PRD.md, docs/ARCHITECTURE.md, this file, DESIGN.md, docs/brand.md), indexed by docs/README.md. Why: agents working in a checkout never see the maintainer's private project notes. AGENTS.md stays private (the export drops it); every other doc ships with the public copy.
- 2026-10-09: One isomorphic engine per game drives both modes, so rules can never drift between pass and play and rooms.
- 2026-10-09: `ws` and `qrcode-generator` are the only runtime dependencies; rooms stay in memory with no persistence, accepting that a deploy ends live rooms.
- 2026-10-09: Phase 2 brief from the maintainer: pass and play and own-device play, the first player is host and picks the game, host can be passed, every game has a drinking variant chosen at creation, at least ten games including a quiz show. A twelve-game lineup was picked for it. Superseded 2026-10-09 (phase 3): fifteen games, and the single drinking variant became three tiers (Standard, Drinking, Deadly) on one shared drink engine.
- 2026-10-09: The server returns a real 404 for unmatched paths; only `/`, `/join`, `/r/CODE` and `/tv/CODE` serve the app shell. Still true; `/tv` on its own also serves the shell, as the TV screen's entry point.
- 2026-10-09: No PIN gate, no database. A public-by-design free tool holding no personal data.
