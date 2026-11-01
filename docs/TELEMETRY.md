# Play telemetry: what did we actually play?

Rooms write greppable `[rooms]` lines to the journal (`journalctl --user -u games`).
No names, no player ids, no database. Pass-and-play runs in the browser and
leaves no server trace, so it is invisible here.

```
room X created (mlt, deadly)                                        (when the room opens)
room X game start game= tier= players= audience= tvs= pack= phase= lobby_ms=
room X phase game= round= phase=<entered> prev=<left> prev_ms=       (one line per phase change)
room X game over game= round= rounds= ms=                           (the game reached its end)
room X game end game= reason= rounds= ms= finished= phase= phase_ms=
room X: tier -> <to> from= game= round= game_ms= room_ms=           (host changed the tier)
room X summary reason= ms= active_ms= games= finished= rounds= tier_drops= peak_players=
room X closed: <reason text>                                        (unchanged)
```

- `game end reason`: `standings`, `host-end`, `restart`, `recap`, `new-night`, `closed`.
- `summary reason`: `empty` (nobody connected for 15 min), `all-left` (everyone pressed Leave), `idle` (3 h of silence).
- `active_ms` runs from creation to the last real action. `ms` includes the empty wait, so use `active_ms` for "how long did we play".
- `rounds` is the engine's own `state.round` when it has one, else the number of passes through the game's first phase (Codewords counts turns).

## Summary

```
npm run plays                      last 14 days, from the journal
npm run plays -- --days=3
npm run plays -- --all             keep the nightly canary and QA blips (rooms under a minute)
npm run plays -- --file=log.txt    a saved journal (- reads stdin)
```

Per game: rooms, runs, how many were played to the end, median room and run
length, median rounds and players, tier drops, tiers at start, and the slowest
phases. Rooms from before this telemetry (no `game start` or `summary` lines)
still show: the game comes from the `created` line and the length from the
timestamps, minus the 15 min empty wait when the room was swept. Their tier
changes and rounds are invisible.

The parser and summary live in `lib/plays.mjs`; the lines are written by
`RoomManager` in `lib/rooms.mjs`. Tests: `test/rooms-telemetry.test.mjs`, `test/plays.test.mjs`.
