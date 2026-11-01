// Quiz Show e2e driver, run by e2e/play.mjs. The board's round types are
// server-random, so both branches (a question round and a buzzer round) are
// handled, and the right answer is looked up in content.json by question
// text so the driver can answer right or wrong on purpose.
//
// Standard and Drinking play one tile. Deadly plays four: the first
// contestant (Team 1 on one phone, Ana in a room) gets three right in a row,
// goes onto Double or Nothing, then gets the fourth wrong and takes a shot.
import { readFileSync } from 'node:fs';

const content = JSON.parse(readFileSync(new URL('./content.json', import.meta.url), 'utf8'));
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const byText = new Map();
for (const cat of Object.values(content.categories)) for (const q of [...cat.multiple, ...cat.boolean]) byText.set(norm(q.text), q);
for (const q of content.emoji) byText.set(norm(q.text), q);

// The stage can still show the board prompt ("Pick a tile") for a moment
// after the tile click, so poll until the question itself is up.
async function questionOf(page) {
  let text = '';
  for (let tries = 0; tries < 50; tries++) {
    text = norm(await page.locator('.qs-stage .q, .qs-stage .qs-emoji').first().innerText());
    const q = byText.get(text);
    if (q) return q;
    await page.waitForTimeout(200);
  }
  throw new Error(`question not found in content.json: ${text}`);
}
const wrongOf = (q) => (q.answer + 1) % q.options.length;
const tilesFor = (variant) => (variant === 'deadly' ? 4 : 1);
// Tile i (0-based): the first contestant is right on tiles 0-2, wrong on 3.
const rightOn = (i) => i < 3;

async function isBuzzer(page) {
  return (await page.locator('.tv-sub', { hasText: 'Buzzer round' }).count()) > 0;
}

export async function pass({ page, variant, h }) {
  const deadly = variant === 'deadly';
  await page.locator('.qs-team').first().waitFor();
  await h.shot(page, 'teams');
  await h.hostClick(page, 'Start the quiz');
  for (let i = 0; i < tilesFor(variant); i++) {
    await page.locator('.qs-tile:not(.used)').first().waitFor();
    if (i === 0) await h.shot(page, 'board');
    if (deadly && i === 3) {
      const note = await page.locator('.deadly-note').first().innerText().catch(() => '');
      if (!/Team 1 is on Double or Nothing/i.test(note)) throw new Error(`board does not telegraph Double or Nothing: ${note}`);
    }
    await page.locator('.qs-tile:not(.used)').first().click();
    await page.locator('[data-act="answer"], [data-act="buzz"]').first().waitFor();
    if (deadly && i === 3) {
      if (!(await page.locator('.qs-don').count())) throw new Error('no Double or Nothing badge on Team 1');
      await h.shot(page, 'double-or-nothing');
    }
    const right = rightOn(i);
    if (await isBuzzer(page)) {
      if (i === 0) await h.shot(page, 'buzzer');
      await page.locator('[data-act="buzz"][data-arg="team-1"]').click();
      await h.hostClick(page, right ? 'Correct' : 'Wrong');
      if (!right) {
        if (deadly && i === 3) await h.expectMoment(page, /Double or Nothing/i, 'deadly-takeover');
        await h.hostClick(page, 'Nobody buzzed, reveal');
      }
    } else {
      if (i === 0) await h.shot(page, 'question');
      const q = await questionOf(page);
      const teams = page.locator('.qs-team-answer');
      await teams.nth(0).locator('.pick').nth(right ? q.answer : wrongOf(q)).click();
      await teams.nth(1).locator('.pick').nth(wrongOf(q)).click();
      if (deadly && i === 3) await h.expectMoment(page, /Double or Nothing/i, 'deadly-takeover');
    }
    await page.locator('.qs-reveal').waitFor();
    if (i === 0 || (deadly && i === 3)) await h.shot(page, `reveal-${i + 1}`);
    if (variant !== 'standard' && !(await page.locator('.qs-reveal .drink').count())) throw new Error('no drinks in the reveal');
    if (deadly && i === 3 && !(await page.locator('.qs-reveal .drink-shot').count())) throw new Error('no Double or Nothing shot in the reveal');
    await h.hostClick(page, 'Show standings');
    await page.locator('.scores').waitFor();
    if (i === 0) await h.shot(page, 'leaderboard');
    if (i < tilesFor(variant) - 1) await h.hostClick(page, 'Back to the board');
  }
}

export async function room({ players, host, tv, variant, h }) {
  const deadly = variant === 'deadly';
  const [ana, ...rest] = players;
  for (let i = 0; i < tilesFor(variant); i++) {
    await host.locator('.qs-tile:not(.used)').first().waitFor();
    if (i === 0) { await h.shot(host, 'board'); await h.shot(tv, 'tv-board'); }
    await host.locator('.qs-tile:not(.used)').first().click();
    await tv.locator('.qs-stage .q, .qs-stage .qs-emoji').first().waitFor();
    for (const p of players) await p.locator('.qs-stage .q, .qs-stage .qs-emoji').first().waitFor();
    const right = rightOn(i);
    if (deadly && i === 3) {
      const note = await ana.locator('.deadly-note').first().innerText().catch(() => '');
      if (!/You are on Double or Nothing/i.test(note)) throw new Error(`Ana's phone does not telegraph Double or Nothing: ${note}`);
      if (!(await tv.locator('.qs-don-strip').count())) throw new Error('TV does not show who is on Double or Nothing');
      await h.shot(ana, 'double-or-nothing');
      await h.shot(tv, 'tv-double-or-nothing');
    }
    const q = await questionOf(ana);
    if (await isBuzzer(tv)) {
      if (i === 0) await h.shot(tv, 'tv-buzzer');
      await ana.locator('[data-act="buzz"]').click();
      if (i === 0) await h.shot(ana, 'buzz-active');
      if (/correct answer/i.test(await ana.content())) throw new Error('a room player can see the judging hint early');
      await ana.locator('form[data-act="submitBuzzAnswer"] input').fill(right ? q.options[q.answer] : 'a wrong guess');
      await ana.locator('form[data-act="submitBuzzAnswer"] button[type=submit]').click();
      if (!right) {
        for (const p of rest) {
          await p.locator('[data-act="buzz"]').waitFor({ timeout: 5000 }).catch(() => {});
          if (await p.locator('[data-act="buzz"]').count()) {
            await p.locator('[data-act="buzz"]').click();
            await p.locator('form[data-act="submitBuzzAnswer"] input').waitFor({ timeout: 5000 }).catch(() => {});
            if (await p.locator('form[data-act="submitBuzzAnswer"] input').count()) {
              await p.locator('form[data-act="submitBuzzAnswer"] input').fill('also a wrong guess');
              await p.locator('form[data-act="submitBuzzAnswer"] button[type=submit]').click();
            }
          }
        }
      }
    } else {
      if (i === 0) await h.shot(ana, 'question');
      await ana.locator('.pick-grid .pick').nth(right ? q.answer : wrongOf(q)).click();
      for (const p of rest) await p.locator('.pick-grid .pick').nth(wrongOf(q)).click();
    }
    if (deadly && i === 3) {
      await tv.locator('.moment.revealed', { hasText: /Double or Nothing/i }).waitFor({ timeout: 8000 });
      await h.shot(tv, 'tv-deadly-takeover');
      h.log(`  TV takeover: ${(await tv.locator('.moment').innerText()).replace(/\s+/g, ' ')}`);
      await h.expectMoment(ana, /Double or Nothing/i, 'deadly-takeover');
    }
    for (const p of players) await p.locator('.qs-reveal').waitFor({ timeout: 10_000 });
    await tv.locator('.qs-reveal').waitFor();
    if (variant !== 'standard' && !(await ana.locator('.qs-reveal .drink').count())) throw new Error('no drinks in the reveal');
    if (deadly && i === 3 && !(await ana.locator('.qs-reveal .drink-shot').count())) throw new Error('no Double or Nothing shot in the reveal');
    if (i === 0 || (deadly && i === 3)) {
      await tv.locator('.moment').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
      await h.shot(ana, `reveal-${i + 1}`);
      await h.shot(tv, `tv-reveal-${i + 1}`);
    }
    await h.hostClick(host, 'Show standings');
    for (const p of players) await p.locator('.scores').waitFor();
    await tv.locator('.scores').waitFor();
    if (i === 0) await h.shot(tv, 'tv-leaderboard');
    if (i < tilesFor(variant) - 1) await h.hostClick(host, 'Back to the board');
  }
}
