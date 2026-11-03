# Changelog

## Unreleased

If you host a copy, set `GAMES_CONTACT_EMAIL`: it now defaults to a placeholder. `GAMES_AI_REFERER` now defaults to nothing.

## 0.2.0

Self-hosting no longer needs a reverse proxy for a night in, and a first-time group gets in faster.

- `npx github:kd-011/party-games` starts it on your network and prints the address and a QR code. `npm run lan` does the same from a clone.
- Docker: a `Dockerfile` and `compose.yaml`, running as a non-root user with custom packs in a volume.
- QR codes on a home network now say `http`. They used to say `https` for anything but localhost, which would have failed on every phone.
- The room lobby shows the join QR on screen while the room is short of players, with no tap needed.
- Typing the fourth letter of a room code moves on by itself.
- Copy link works on plain `http`, where browsers have no clipboard API.
- A join no longer re-deals the code tiles and every seat on the phones already in the lobby.
- The lobby warns when it is open on `localhost`, where its QR code could not work on a phone.
- A port already in use now says so and names the setting to change.

## 0.1.0

First public release: fifteen games, three tiers, Party Night, pass and play, rooms with a TV view.
