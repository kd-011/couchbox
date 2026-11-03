# Third-party notices

The project's own code, writing, icons and artwork are MIT (see `LICENSE`).
These pieces are not, or come from elsewhere.

## Content under a different licence

| Path | Licence | Notes |
| --- | --- | --- |
| `games/quiz-show/content.json` | CC BY-SA 4.0 | Most multiple-choice and true-or-false questions come from the [Open Trivia Database](https://opentdb.com) (opentdb.com). The emoji round is original. This file is **not** MIT. Share it, and anything adapted from it, under CC BY-SA 4.0 with attribution to OpenTDB. |

If you want a build with no ShareAlike content, delete that file's OpenTDB
questions (or the whole file) and keep the curated packs in
`games/quiz-show/packs/`, which are original writing under MIT.

## Fonts (SIL Open Font License 1.1)

| Path | Font | Licence text |
| --- | --- | --- |
| `public/fonts/bricolage.woff2` | Bricolage Grotesque, The Bricolage Grotesque Project Authors | `public/fonts/OFL-bricolage.txt` |
| `public/kit/fonts/geist-latin.woff2`, `geist-mono-latin.woff2` | Geist and Geist Mono, Vercel in collaboration with basement.studio | `public/kit/fonts/OFL-geist.txt` |

The fonts are unmodified, shipped as separate files, and not sold on their own.

## npm dependencies

| Package | Version | Licence | Use |
| --- | --- | --- | --- |
| [ws](https://github.com/websockets/ws) | 8.22.0 | MIT | WebSocket server for rooms |
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) | 2.0.4 | MIT | Join QR codes |
| [playwright-core](https://github.com/microsoft/playwright) | 1.63.0 | Apache-2.0 | Dev only: the browser tests. Not shipped or required to run the site. |

## Images, sounds and word lists

- Every icon, splash image and the social image are original SVG or PNG artwork drawn for this project.
- All sound is synthesised in the browser (`public/js/sfx.js`). There are no audio files.
- No photographs or images of real people are included. Celebrity Heads uses names only.
- Word lists, prompts and questions (apart from the Quiz Show file above) are original writing.
- Game names are used descriptively. Spyfall is also the name of a commercial board game; see the README before you trade under that name.

## Names

"Spyfall" is also the name of a commercial board game. This project uses the name descriptively for a similar idea. If you publish your own build under a product name, pick your own.
