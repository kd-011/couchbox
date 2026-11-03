# Self-hosting

Party Games is one Node process: a plain `http` server plus a WebSocket endpoint at `/ws`. No database, no build step. Plain static hosting will not run it, because rooms need the WebSocket and the server builds the game list, rules pages, sitemap and QR codes.

Rooms live in memory. Run exactly one instance, and expect a restart to end open rooms.

## For a night in, on your wifi

You need Node 20 or newer. It is developed on Node 22 and the first-time group test has also been run on Node 20.

```sh
npx github:kd-011/party-games
```

The terminal prints an address like `http://192.168.1.20:8969` and a QR code. Open it on any device on the same network. Anyone there can reach it while it runs, and Ctrl+C stops it.

From a clone, `npm install` and then `npm run lan` does the same thing. `npm start` listens on this computer only, which is what you want behind a reverse proxy, but phones cannot join it.

What you give up on plain `http`: browsers only allow installing the app, offline play and the keep-the-screen-awake lock on `https` or `localhost`. Everything else works, including rooms, QR codes, the TV view and every game. Phones may dim during a long discussion timer.

If the phones load nothing, check for a guest wifi with client isolation or a firewall on the computer running it. Allow the port, or move everyone to the same non-guest network.

## With Docker

```sh
git clone https://github.com/kd-011/party-games.git
cd party-games
docker compose up -d --build
```

It listens on port 8969 and keeps custom packs in a named volume. Open it at your computer's network address, such as `http://192.168.1.20:8969`. QR codes and invite links use the address you opened, so on `localhost` they would fail on every phone, and the lobby warns you.

## On the internet

1. Run `node server.mjs` under whatever supervises processes on your host (systemd, Docker, a PaaS). Set `GAMES_HOST=0.0.0.0` in a container.
2. Put a TLS reverse proxy in front (Caddy, nginx, Cloudflare Tunnel). It must pass WebSocket upgrades on `/ws` and forward the `Host` header unchanged. Have it set `X-Forwarded-Proto` too, if it does not already.
3. Set `GAMES_SITE_URL` if the proxy rewrites `Host`, and `GAMES_CONTACT_EMAIL` to your own address.
4. Rate limits key on the `CF-Connecting-IP` header, falling back to the socket address. Behind a proxy that is not Cloudflare, have it set that header, or every visitor shares one limit.

Never expose the Node port directly to the internet, with or without `--lan`, since that header can then be spoofed.

## Configuration

Every setting is optional. Set these in the environment or in a `.env` file next to `server.mjs` (see `.env.example`).

| Variable | Default | What it does |
| --- | --- | --- |
| `GAMES_PORT` | `8969` | Port to listen on. |
| `GAMES_HOST` | `127.0.0.1`, or `0.0.0.0` with `--lan` | Address to bind. The Docker image sets `0.0.0.0`. |
| `GAMES_SITE_URL` | read from each request | Public URL, no trailing slash. Used for canonical links, the sitemap, share cards and QR codes. Without it the address comes from the `Host` header, and the scheme from `X-Forwarded-Proto`, else `http` for a private address or a `.local` name and `https` for anything else. |
| `GAMES_CONTACT_EMAIL` | `games@example.com` | Shown on the privacy and credits pages. Set this to your own if you host a copy. |
| `GAMES_PACKS_DIR` | `~/.local/share/games-packs` | Where custom and AI-made packs are saved. |
| `OPENROUTER_API_KEY` | unset | Turns on the AI pack maker. Without it the feature reports itself unavailable. |
| `GAMES_AI_PACK_MODEL` | `google/gemini-3.8-flash` | OpenRouter model for AI packs. |
| `GAMES_AI_PACK_DAILY_CAP_USD` | `0.5` | Hard daily spend cap for AI packs. |
| `GAMES_AI_REFERER` | none | Sent to OpenRouter as `HTTP-Referer` when set. |
| `KOKORO_SERVER_URL` | `http://127.0.0.1:8124` | Optional Kokoro TTS server for the Host Box voice. Silent if unreachable. |
| `HOSTBOX_VOICE`, `HOSTBOX_VOICE_SPEED` | `af_sky`, `1.0` | Voice and speed for that server. |

Development only, never in production: `GAMES_EXAMPLE=1` lists the High Card example game, `GAMES_TEST_HOOKS=1` enables the `/__test/` hooks used by the QA matrix, and `GAMES_CANARY_URL` is the target of `npm run canary`.

## Tests

```sh
npm test                    # unit and contract tests, no browser needed
npm run e2e                 # plays every game in a real browser (needs a Chromium for Playwright)
node e2e/first-time.mjs     # three strangers get from nothing to a dealt card
```

`node scripts/demo-gif.mjs` remakes the GIF in the README from a real round. It needs ffmpeg as well as the Chromium.
