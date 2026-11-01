// Most Likely To e2e driver, run by e2e/play.mjs. Plays one prompt through
// to the reveal screen in both pass and room. Deadly: one player is crowned
// by every vote, so the unanimous shot lands.

const UNANIMOUS = /unanimous/i;

export async function pass({ page, variant, h }) {
  await page.locator('.q').waitFor();
  await h.shot(page, 'prompt');
  // On one phone the crown is a shot only when no Deadly moment fired in the
  // last 3 minutes (a fresh game always; mid Party Night maybe not), and the
  // note says so exactly when it is.
  const armed = variant === 'deadly' && (await page.locator('.deadly-note', { hasText: 'whole table' }).count()) > 0;
  if (variant === 'deadly' && !armed) h.log('  Deadly cooldown active: this crown is sips, no note shown');
  await page.locator('.pick[data-act="accuse"]').first().click();
  await h.confirmSheet(page);
  if (armed) await h.expectMoment(page, UNANIMOUS, 'deadly-takeover');
  await page.locator('.mlt-result').waitFor();
  await h.shot(page, 'result');
  if (variant !== 'standard' && !(await page.locator('.drink').count())) throw new Error('no drink prompts in the result');
  if (armed && !(await page.locator('.drink-shot').count())) throw new Error('no shot in the Deadly result');
  if (!(await page.locator('.scores').count())) throw new Error('no scores in the result');
  await h.hostClick(page, 'Next prompt');
  await page.locator('.q').waitFor();
}

export async function room({ players, tv, variant, h }) {
  for (const p of players) await p.locator('.pick[data-act="vote"]').first().waitFor();
  await h.shot(tv, 'tv-vote');
  await h.shot(players[0], 'vote');
  if (variant === 'deadly') {
    for (const p of [players[0], tv]) {
      if (!(await p.locator('.deadly-note', { hasText: 'Every vote for one player' }).count())) throw new Error('Deadly rule not telegraphed at the vote');
    }
  }

  // Cast the first vote, then make sure nobody else's screen reveals who it
  // was for: only the aggregate "X of Y voted" count may move.
  const firstTarget = await players[0].locator('.pick[data-act="vote"]').first().getAttribute('data-arg');
  await players[0].locator(`.pick[data-arg="${firstTarget}"]`).click();
  await players[1].waitForTimeout(300);
  if (await players[1].locator('.pick.on').count()) throw new Error('another player can see a vote that is not theirs');
  const progress = (await players[1].locator('.waiting-line').textContent()) || '';
  if (!/1 of \d+ voted/.test(progress)) throw new Error(`vote progress did not update: "${progress}"`);

  // Deadly: Ben and Cy both vote Ana, so she is crowned by every vote.
  for (const [i, p] of players.slice(1).entries()) {
    if (variant === 'deadly') await p.locator('.pick[data-act="vote"]', { hasText: 'Ana' }).click();
    else await p.locator('.pick[data-act="vote"]').first().click();
    // Two of three in: the grace clock starts for the last voter, on the TV and every phone.
    if (i === 0) {
      for (const view of [players[2], tv]) {
        const clock = view.locator('.mlt-clock .cd');
        await clock.waitFor({ timeout: 5000 }).catch(() => { throw new Error('no vote clock after half the table voted'); });
        if (!/^\d:\d\d$/.test(((await clock.textContent()) || '').trim())) throw new Error('vote clock is not ticking text');
      }
      await h.shot(players[2], 'vote-clock');
      await h.shot(tv, 'tv-vote-clock');
    }
  }
  if (variant === 'deadly') {
    await tv.locator('.moment.revealed').waitFor({ timeout: 8000 });
    await h.shot(tv, 'tv-deadly-takeover');
    const t = (await tv.locator('.moment').innerText()).replace(/\s+/g, ' ');
    if (!UNANIMOUS.test(t) || !t.includes('Ana')) throw new Error(`TV takeover does not name the unanimous pick: ${t}`);
    h.log(`  TV takeover: ${t}`);
    await h.expectMoment(players[1], UNANIMOUS, 'deadly-takeover');
  }
  for (const p of [...players, tv]) await p.locator('.mlt-result').waitFor();
  await h.shot(players[0], 'result');
  await tv.locator('.moment').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  await h.shot(tv, 'tv-result');
  if (variant !== 'standard' && !(await players[0].locator('.drink').count())) throw new Error('no drink prompts in the result');
  if (variant === 'deadly' && !(await players[0].locator('.drink-shot').count())) throw new Error('no shot in the Deadly result');
  if (!(await players[0].locator('.scores').count())) throw new Error('no scores in the result');
}
