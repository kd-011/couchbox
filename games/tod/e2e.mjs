// Truth or Dare e2e driver, run by e2e/play.mjs. Plays full turns:
// choose -> reveal -> resolve -> next, always resolving with "skip" so the
// drink calls get exercised. Deadly plays four turns (three players, two
// laps): the first player's second skip on turn 4 is the Deadly shot.

const SECOND = /second skip/i;

export async function pass({ page, variant, h }) {
  // Pass and play has no private step here: the shared screen (tv()) is
  // read-only, exactly like a room TV, and every move goes through the
  // host bar, which on one phone is the shared screen itself.
  const turns = variant === 'deadly' ? 4 : 1;
  for (let t = 1; t <= turns; t++) {
    const last = t === turns;
    await page.locator('.tod-ready').waitFor();
    if (t === 1) await h.shot(page, 'ready');
    await h.hostClick(page, 'Dare');
    await page.locator('.tod-reveal').waitFor();
    if (variant === 'deadly' && t === 4) {
      await page.locator('.deadly-note', { hasText: 'Skip again' }).waitFor({ timeout: 3000 })
        .catch(() => { throw new Error('second skip not telegraphed on the prompt'); });
      await h.shot(page, 'deadly-note');
    } else if (await page.locator('.deadly-note').count()) throw new Error(`turn ${t}: skip warning shown before a first skip`);
    if (t === 1) await h.shot(page, 'reveal');
    await h.hostClick(page, 'Skipped');
    if (variant === 'deadly' && t === 4) await h.expectMoment(page, SECOND, 'deadly-takeover');
    await page.locator('.tod-result').waitFor();
    if (last) {
      await h.shot(page, 'result');
      if (variant !== 'standard' && !(await page.locator('.drink').count())) throw new Error('no drink prompt after a skip');
      if (variant === 'deadly' && !(await page.locator('.drink-shot').count())) throw new Error('no shot after the second skip');
      if (!(await page.locator('.scores').count())) throw new Error('no scores in the result');
    }
    await h.hostClick(page, 'Next player');
  }
  await page.locator('.tod-ready').waitFor();
}

export async function room({ players, host, tv, variant, h }) {
  // Either the player up or the host can act; drive it from the host bar so
  // the test doesn't need to know who the rotation picked first.
  const turns = variant === 'deadly' ? 4 : 1;
  for (let t = 1; t <= turns; t++) {
    const last = t === turns;
    await host.locator('.hostbar .btn', { hasText: 'Dare' }).waitFor();
    if (t === 1) await h.shot(host, 'lobby-ready');
    await h.hostClick(host, 'Dare');
    for (const p of [...players, tv]) await p.locator('.tod-reveal').waitFor();
    if (variant === 'deadly' && t === 4) {
      // A Deadly card between turns may still be up on the TV: let it clear
      // so the note is visible and the next takeover is the second skip.
      await tv.locator('.moment').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
      for (const p of [players[0], tv]) {
        await p.locator('.deadly-note', { hasText: 'Skip again' }).waitFor({ timeout: 3000 })
          .catch(() => { throw new Error('second skip not telegraphed on the prompt'); });
      }
      await h.shot(tv, 'tv-deadly-note');
    }
    if (t === 1) {
      await h.shot(players[0], 'reveal');
      await h.shot(tv, 'tv-reveal');
      if ((await tv.content()).includes('data-act="resolve"')) throw new Error('TV should not carry its own action buttons');
    }
    await h.hostClick(host, 'Skipped');
    if (variant === 'deadly' && t === 4) {
      await tv.locator('.moment.revealed').waitFor({ timeout: 8000 });
      await h.shot(tv, 'tv-deadly-takeover');
      const txt = (await tv.locator('.moment').innerText()).replace(/\s+/g, ' ');
      if (!SECOND.test(txt) || !/shot/i.test(txt)) throw new Error(`TV takeover is not the second-skip shot: ${txt}`);
      h.log(`  TV takeover: ${txt}`);
      await h.expectMoment(players[1], SECOND, 'deadly-takeover');
    }
    for (const p of [...players, tv]) await p.locator('.tod-result').waitFor();
    if (last) {
      await h.shot(host, 'result');
      await tv.locator('.moment').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
      await h.shot(tv, 'tv-result');
      if (variant !== 'standard' && !(await players[0].locator('.drink').count())) throw new Error('no drink prompt after a skip');
      if (variant === 'deadly' && !(await players[0].locator('.drink-shot').count())) throw new Error('no shot after the second skip');
      if (!(await players[0].locator('.scores').count())) throw new Error('no scores in the result');
    }
    await h.hostClick(host, 'Next player');
    for (const p of [...players, tv]) await p.locator('.tod-ready').waitFor();
  }
  h.log(`  host-driven turns: ${turns}`);
}
