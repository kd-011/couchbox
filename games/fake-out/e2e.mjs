// Fake Out e2e driver, run by e2e/play.mjs. Plays one full round in pass
// and room modes. Shortens write time and rounds so the harness is quick.

export async function setup({ page, h }) {
  for (let i = 0; i < 3; i++) await h.tap(page, 'button[data-key="writeSeconds"][data-step="-1"]');
  for (let i = 0; i < 3; i++) await h.tap(page, 'button[data-key="rounds"][data-step="-1"]');
}

export async function pass({ page, variant, h }) {
  // Three private "pass to X" turns to write a fake, each ending with the
  // write form's own submit button.
  for (let i = 0; i < 3; i++) {
    await page.locator('.gate').waitFor();
    if (await page.locator('.fo-fact').count()) throw new Error('fact visible on the gate screen');
    await page.locator('#gate-go').click();
    await page.locator('.fo-write input').waitFor();
    if (i === 0) await h.shot(page, 'write');
    await page.locator('.fo-write input').fill(`Pass fake ${i}`);
    await page.locator('.fo-write button[type=submit]').click();
    // passTurn moves straight to the next writer (or into voting once the
    // last fake is in), so the gate for the next private turn appears next.
  }
  // Three more private turns to vote, each a tap on a pick. Deadly: Ben and
  // Cy both fall for Ana's fake, a perfect fake, so the Shot Roulette spins.
  for (let i = 0; i < 3; i++) {
    await page.locator('.gate').waitFor();
    await page.locator('#gate-go').click();
    await page.locator('.pick[data-act="vote"]').first().waitFor();
    if (i === 0) await h.shot(page, 'vote');
    if (variant === 'deadly' && !(await page.locator('.deadly-note').count())) throw new Error('Deadly rule not telegraphed at the vote');
    const pick = variant === 'deadly' && i > 0
      ? page.locator('.pick[data-act="vote"]', { hasText: 'Pass fake 0' })
      : page.locator('.pick[data-act="vote"]').first();
    await pick.click();
  }
  if (variant === 'deadly') await h.expectMoment(page, /Shot Roulette/i, 'deadly-takeover');
  await page.locator('.fo-result').waitFor();
  await h.shot(page, 'result');
  if (variant !== 'standard' && !(await page.locator('.drink').count())) throw new Error('no drink prompts in the result');
  if (variant === 'deadly' && !(await page.locator('.drink-shot').count())) throw new Error('no shot in the Deadly result');
  if (!(await page.locator('.scores').count())) throw new Error('no scores in the result');
  await page.reload(); // one-phone games survive a refresh
  await page.locator('.fo-result').waitFor();
  await h.hostClick(page, 'Next round');
  await page.locator('.gate').waitFor();
}

export async function room({ players, host, tv, variant, h }) {
  for (const p of players) await p.locator('.fo-write input').waitFor();
  await h.shot(tv, 'tv-write');
  await h.shot(players[0], 'write');
  let i = 0;
  for (const p of players) {
    await p.locator('.fo-write input').fill(`Room fake ${i++}`);
    await p.locator('.fo-write button[type=submit]').click();
    // The last submission also completes the set and opens voting straight
    // away, so that player's own screen jumps past the "your fake" card
    // and into the vote grid; everyone else sees their fake confirmed.
    await Promise.race([
      p.locator('.fo-mine').waitFor(),
      p.locator('.pick[data-act="vote"]').first().waitFor(),
    ]);
  }
  for (const p of players) await p.locator('.pick[data-act="vote"]').first().waitFor();
  await tv.locator('.fo-blank, .tv-big').first().waitFor();
  await h.shot(tv, 'tv-vote');
  await h.shot(players[0], 'vote');
  // Nobody should see any fake text or vote belonging to someone else before
  // the reveal: the TV at vote time must never show an author name.
  const tvVoteHtml = await tv.content();
  if (/fo-own-tag/.test(tvVoteHtml)) throw new Error('TV exposes fake ownership before the reveal');
  if (variant === 'deadly') {
    for (const p of [players[1], tv]) if (!(await p.locator('.deadly-note').count())) throw new Error('Deadly rule not telegraphed at the vote');
  }
  // Deadly: Ben and Cy both fall for Ana's fake (a perfect fake).
  for (const [i, p] of players.entries()) {
    if (variant === 'deadly' && i > 0) await p.locator('.pick[data-act="vote"]', { hasText: 'Room fake 0' }).click();
    else await p.locator('.pick[data-act="vote"]').first().click();
  }
  if (variant === 'deadly') {
    await tv.locator('.moment.revealed').waitFor({ timeout: 10000 });
    await h.shot(tv, 'tv-deadly-takeover');
    const t = (await tv.locator('.moment').innerText()).replace(/\s+/g, ' ');
    if (!/Shot Roulette/i.test(t) || !/(Ben|Cy) takes a shot/i.test(t)) throw new Error(`TV takeover does not land on a fooled player: ${t}`);
    h.log(`  TV takeover: ${t}`);
    await h.expectMoment(players[1], /Shot Roulette/i, 'deadly-takeover');
  }
  for (const p of players) await p.locator('.fo-result').waitFor();
  await tv.locator('.fo-result').waitFor();
  await h.shot(players[0], 'result');
  await tv.locator('.moment').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  await h.shot(tv, 'tv-result');
  if (variant !== 'standard' && !(await players[0].locator('.drink').count())) throw new Error('no drink prompts');
  if (variant === 'deadly' && !(await players[0].locator('.drink-shot').count())) throw new Error('no shot in the Deadly result');
  if (!(await players[0].locator('.scores').count())) throw new Error('no scores in the result');
  h.log('  fake ownership stayed hidden on the TV until the reveal');
}
