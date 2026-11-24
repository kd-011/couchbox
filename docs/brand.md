---
slug: games-brand
name: Games brand
repo: .
status: active
last_verified: 2026-11-23
needs_review: true
---

# Games: brand

A draft made only from copy already shipped. Every line cites where it came from; anything the copy does not settle is under Unverified.

## Name and casing

- On the site it is "Games", capital G: the wordmark, every page title and `og:site_name`. <!-- src: public/index.html:6, public/index.html:18, public/index.html:47 -->
- Page titles put the page first and the site last, after a colon: "Room ABCD: Games", "Join a room: Games", "Imposter: Games". <!-- src: public/js/app.js:74, public/js/app.js:402, public/js/app.js:487 -->
- The public project, its command and its compose service are "couchbox", all lower case. <!-- src: README.md:1-3, package.json#bin, compose.yaml:2 -->
- The old project name "party-games" is retired; the old GitHub URL only redirects. <!-- src: CHANGELOG.md:5-7 -->

## One-liner

Free party and drinking games for one phone or everyone. The README's longer form: free party and drinking games for adults in the same room, played on your phones with no app and no sign-up.

## Audience

Adults in the same room at a party or a night in, with one phone to pass round or a phone each and maybe a TV. The copy speaks to the group as "you" and to the table as "your mates".

## Is and is not

Is:
- Free, no sign-up, no app to install first.
- For adults: drinking tiers sit behind an 18+ confirmation and every drink is optional.
- One site with many games, each playable on one phone or on everyone's.

Is not:
- For kids, for players in different places, or for a public event.
- An ad-funded or tracking product: no accounts, no ads, no analytics.

## Voice

Three adjectives: plain, warm, cheeky.

- Do: short sentences, second person, a joke where the moment allows ("This page is the imposter"). Say what to do next in every error.
- Do: keep drinking copy responsible and calm: suggestions, never orders; water and getting home safe.
- Do not: shame anyone for opting out, push drinking, or use jargon.
- Banned words: none found in shipped copy.

## Copy bank

- Home title and OG title: "Games: Free party and drinking games for one phone or everyone". <!-- src: public/index.html:6, public/index.html:13 -->
- Home description: "Free party and drinking games with no sign-up: Imposter, Quiz Show, Werewolf and more. Pass one phone round, or everyone joins on their own phone with a room code and a TV screen." <!-- src: public/index.html:7 -->
- OG description: "Free party and drinking games with no sign-up. Pass one phone round, or everyone joins on their own phone with a room code and a TV screen." <!-- src: public/index.html:14 -->
- Home pitch under the wordmark: "Party and drinking games for one phone, or everyone's." <!-- src: public/index.html:47 -->
- Rules page title pattern: "<Game>: how to play | Games"; its CTA: "Play <Game> free". <!-- src: server.mjs:243, server.mjs:305 -->
- Start screen CTAs: "Play on everyone's phones" and "Pass one phone round". <!-- src: public/js/app.js:529-530 -->
- App manifest name: "Games: party and drinking games". <!-- src: public/manifest.webmanifest -->
- Empty search: "No game fits that", with a "Clear filters" way out. <!-- src: public/js/app.js:272 -->
- 404: "This page is the imposter. That link doesn't go anywhere." <!-- src: public/404.html:17-18 -->
- Error tone, an apology-free fact and the next step: "No room called ABCD. Check the code, or it may have ended." and "AI packs are taking a break today. Try building one yourself instead." <!-- src: lib/rooms.mjs:382, lib/ai-packs.mjs:89 -->
- Drinking confirm: "For adults of legal drinking age. Sips are suggestions: anyone can tap I'm out and swap their drinks for forfeits, any time." <!-- src: public/js/ui.js:389-390 -->

## Assets

- Logo and favicon: `public/icon.svg`, with PNG icons `public/icon-192.png`, `public/icon-512.png`, maskable variants and `public/apple-touch-icon.png`. <!-- src: public/manifest.webmanifest -->
- OG image: `public/og-image.png`, rendered by `scripts/og-image.mjs`. GitHub social preview: `.github/social-preview.png`. <!-- src: scripts/og-image.mjs:1-4, scripts/export-allowlist.txt:6 -->
- Wordmark face: Bricolage Grotesque, `public/fonts/bricolage.woff2`. <!-- src: public/credits.html:24-25 -->

## Contact and legal

- Contact is one email address on the privacy and credits pages, filled per request from `GAMES_CONTACT_EMAIL`, so a self-hosted copy shows its own. <!-- src: public/privacy.html:30-31, public/credits.html:36-37, .env.example:13-14 -->
- Privacy and terms are one page at `/privacy`; credits and licences at `/credits`. <!-- src: server.mjs:362-363 -->
- Licence: MIT, except the Quiz Show questions (CC BY-SA 4.0) and the fonts (SIL OFL). <!-- src: LICENSE:1-3, THIRD_PARTY_NOTICES.md:10, THIRD_PARTY_NOTICES.md:16-21 -->
- No business name is shipped; the licence names the copyright holder as kd-011. <!-- src: LICENSE:3 -->

## Unverified

- The three voice adjectives and the do and do not lines are read from the shipped copy, not stated by the maintainer.
- Whether "Games" or "couchbox" should lead in new public copy (the site says Games, the repository and command say couchbox).
- Banned words: none are written down.
