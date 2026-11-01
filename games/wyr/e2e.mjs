// Would You Rather e2e driver, run by e2e/play.mjs. Plays one full round to
// the reveal screen in both modes. There is no private pass-and-play turn:
// the shared screen runs the whole game (host assigns players out loud).
// Every run splits 2-1, so Cy is always alone on B: the minority drinks in
// Drinking and the lone wolf takes a shot in Deadly.

const WOLF = /lone wolf/i;

export async function pass({ page, variant, h }) {
  await page.locator('.wyr-fork-assign').waitFor();
  await h.shot(page, 'assign');
  if (variant === 'deadly' && !(await page.locator('.deadly-note', { hasText: 'lone wolf' }).count())) throw new Error('Deadly rule not telegraphed at the vote');
  // Ana and Ben -> A, Cy -> B: a deterministic 2-1 split, so there is always
  // a majority to score and a minority to drink, whichever pair was dealt.
  await page.locator('.wyr-col-a .wyr-chip').nth(0).click();
  await page.locator('.wyr-col-a .wyr-chip').nth(1).click();
  await page.locator('.wyr-col-b .wyr-chip').nth(2).click();
  await page.waitForFunction(() => document.querySelectorAll('.wyr-chip.on').length === 3);
  await h.hostClick(page, 'Reveal');
  if (variant === 'deadly') await h.expectMoment(page, WOLF, 'deadly-takeover');
  await page.locator('.wyr-fork-reveal').waitFor();
  await h.shot(page, 'reveal');
  if (variant !== 'standard' && !(await page.locator('.drink').count())) throw new Error('no drink prompt for the minority');
  if (variant === 'deadly' && !(await page.locator('.drink-shot').count())) throw new Error('no shot for the lone wolf');
  if (!(await page.locator('.scores').count())) throw new Error('no scores in the reveal');
  await page.reload(); // one-phone games survive a refresh
  await page.locator('.wyr-fork-reveal').waitFor();
  await h.hostClick(page, 'Next round');
  await page.locator('.wyr-fork-assign').waitFor();
}

export async function room({ players, host, tv, variant, h }) {
  for (const p of players) await p.locator('.wyr-opt').first().waitFor();
  await h.shot(tv, 'tv-vote');
  await h.shot(players[0], 'vote');
  if (variant === 'deadly') {
    for (const p of [players[0], tv]) {
      if (!(await p.locator('.deadly-note', { hasText: 'lone wolf' }).count())) throw new Error('Deadly rule not telegraphed at the vote');
    }
  }

  // Mid-vote: two of three have picked. Nobody's page may show more than
  // its own pick, and the TV must show only the aggregate count, never any
  // interactive pick control or another player's choice.
  await players[0].locator('.wyr-opt').nth(0).click(); // A
  await players[1].locator('.wyr-opt').nth(0).click(); // A
  if ((await players[0].locator('.wyr-opt.on').count()) > 1) throw new Error('a player screen shows more than its own pick');
  if ((await players[1].locator('.wyr-opt.on').count()) > 1) throw new Error('a player screen shows more than its own pick');
  if (await tv.locator('.wyr-opt').count()) throw new Error('TV rendered an interactive vote control in room mode');
  if (await tv.locator('.wyr-chip').count()) throw new Error('TV leaked per-player assignment in room mode');
  await tv.locator('.waiting-line', { hasText: '2 of 3' }).waitFor({ timeout: 5000 })
    .catch(async () => { throw new Error(`TV progress text wrong: ${await tv.locator('.waiting-line').textContent()}`); });

  await players[2].locator('.wyr-opt').nth(1).click(); // B: completes the vote, auto-resolves
  if (variant === 'deadly') {
    await tv.locator('.moment.revealed').waitFor({ timeout: 8000 });
    await h.shot(tv, 'tv-deadly-takeover');
    const t = (await tv.locator('.moment').innerText()).replace(/\s+/g, ' ');
    if (!WOLF.test(t) || !t.includes('Cy')) throw new Error(`TV takeover does not name the lone wolf: ${t}`);
    h.log(`  TV takeover: ${t}`);
    await h.expectMoment(players[0], WOLF, 'deadly-takeover');
  }
  for (const p of [...players, tv]) await p.locator('.wyr-fork-reveal').waitFor();
  await h.shot(players[0], 'reveal');
  await tv.locator('.moment').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  await h.shot(tv, 'tv-reveal');
  if (variant !== 'standard' && !(await players[0].locator('.drink').count()) && !(await tv.locator('.drink').count())) {
    throw new Error('no drink prompt for the minority');
  }
  if (variant === 'deadly' && !(await players[0].locator('.drink-shot').count())) throw new Error('no shot for the lone wolf');
  if (!(await tv.locator('.scores').count())) throw new Error('no scores on the TV reveal');

  await h.hostClick(host, 'Next round');
  for (const p of players) await p.locator('.wyr-opt').first().waitFor();
  await tv.locator('.wyr-opt-static').first().waitFor();
}
