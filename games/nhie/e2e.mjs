// Never Have I Ever e2e driver, run by e2e/play.mjs. Plays one round.
// Deadly: exactly one player "has", so the lonely confession shot lands.

const LONELY = /lonely confession/i;

export async function pass({ page, variant, h }) {
  await page.locator('.nhie-stage').waitFor();
  await h.shot(page, 'prompt');
  if (variant === 'deadly' && !(await page.locator('.deadly-note', { hasText: 'only one who has' }).count())) throw new Error('Deadly rule not telegraphed on the prompt');
  // Shared screen (host) marks one player as "has done it".
  const chips = page.locator('.pick[data-act="markPass"]');
  await chips.first().click();
  await h.shot(page, 'marked');
  await h.hostClick(page, 'Reveal');
  if (variant === 'deadly') await h.expectMoment(page, LONELY, 'deadly-takeover');
  await page.locator('.nhie-reveal').waitFor();
  await h.shot(page, 'reveal');
  if (!(await page.locator('.roster li.on').count())) throw new Error('nobody marked as having done it');
  if (!(await page.locator('.scores').count())) throw new Error('no scores in the reveal');
  if (variant !== 'standard' && !(await page.locator('.drink').count())) throw new Error('no drink prompts in the reveal');
  if (variant === 'deadly' && !(await page.locator('.drink-shot').count())) throw new Error('no shot in the Deadly reveal');
  await page.reload(); // one-phone games survive a refresh
  await page.locator('.nhie-reveal').waitFor();
  await h.hostClick(page, 'Next prompt');
  await page.locator('.nhie-stage').waitFor();
}

export async function room({ players, host, tv, variant, h }) {
  for (const p of players) await p.locator('.nhie-prompt').waitFor();
  await h.shot(tv, 'tv-prompt');
  await h.shot(players[0], 'prompt');
  if (variant === 'deadly') {
    for (const p of [players[0], tv]) {
      if (!(await p.locator('.deadly-note', { hasText: 'only one who has' }).count())) throw new Error('Deadly rule not telegraphed on the prompt');
    }
  }

  // Player 0 answers "I have" first; the others haven't answered yet, so
  // their screens must show only the aggregate count, never player 0's pick.
  await players[0].locator('[data-act="vote"]').first().click();
  await players[1].locator('.waiting-line', { hasText: '1 of 3 answered' }).waitFor({ timeout: 5000 });
  const midVote = await players[1].content();
  if (midVote.includes('"votes"')) throw new Error('playerView leaked the raw votes map');
  h.log('  player 0’s private answer did not leak to player 1');

  await players[1].locator('[data-act="vote"]').nth(1).click();
  // Deadly: Cy hasn't either, so Ana is the only one who has.
  await players[2].locator('[data-act="vote"]').nth(variant === 'deadly' ? 1 : 0).click();

  if (variant === 'deadly') {
    await tv.locator('.moment.revealed').waitFor({ timeout: 8000 });
    await h.shot(tv, 'tv-deadly-takeover');
    const t = (await tv.locator('.moment').innerText()).replace(/\s+/g, ' ');
    if (!LONELY.test(t) || !t.includes('Ana')) throw new Error(`TV takeover does not name the lonely confessor: ${t}`);
    h.log(`  TV takeover: ${t}`);
    await h.expectMoment(players[1], LONELY, 'deadly-takeover');
  }
  for (const p of players) await p.locator('.nhie-reveal').waitFor();
  await tv.locator('.nhie-reveal').waitFor();
  await h.shot(players[0], 'reveal');
  await tv.locator('.moment').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  await h.shot(tv, 'tv-reveal');
  if (!(await tv.locator('.roster li.on').count())) throw new Error('TV reveal shows nobody marked');
  if (!(await players[0].locator('.scores').count())) throw new Error('no scores in the reveal');
  if (!(await tv.locator('.scores').count())) throw new Error('no scores on the TV');
  if (variant !== 'standard' && !(await players[0].locator('.drink').count())) throw new Error('no drink prompts in the reveal');
  if (variant === 'deadly' && !(await players[0].locator('.drink-shot').count())) throw new Error('no shot in the Deadly reveal');

  await h.hostClick(host, 'Next prompt');
  for (const p of players) await p.locator('.nhie-prompt').waitFor();
  h.log('  round 2 started cleanly');
}
