// Imposter e2e driver, run by e2e/play.mjs. Plays one full round.

export async function pass({ page, variant, h }) {
  let imposter = 0;
  for (let i = 0; i < 3; i++) {
    await page.locator('.gate').waitFor();
    if (await page.locator('.imp-card').count()) throw new Error('card visible on the gate screen');
    if (i === 0) await h.shot(page, 'gate');
    await page.locator('#gate-go').click();
    // One phone: the gate confirmed who is looking, so the card opens itself.
    await page.locator('.imp-card.flipped').waitFor();
    if (i === 0) await h.shot(page, 'card');
    const txt = await page.locator('.imp-back').textContent();
    h.log(`  player ${i + 1} sees: ${txt.replace(/\s+/g, ' ').trim()}`);
    if (/Imposter/i.test(txt)) imposter = i;
    await page.locator('[data-act="seen"]').click();
  }
  await page.locator('.cd-ring').waitFor();
  await h.shot(page, 'discuss');
  await h.hostClick(page, 'Vote now');
  await page.locator('.pick[data-act="accuse"]').first().waitFor();
  await h.shot(page, 'vote');
  if (variant === 'deadly' && !(await page.locator('.deadly-note').count())) throw new Error('Deadly rule not telegraphed at the vote');
  // Deadly: vote out the real imposter so their shot lands.
  await page.locator('.pick[data-act="accuse"]').nth(variant === 'deadly' ? imposter : 0).click();
  await h.confirmSheet(page);
  if (variant === 'deadly') await h.expectMoment(page, /takes a shot/i, 'deadly-takeover');
  await page.locator('.imp-result').waitFor();
  await h.shot(page, 'result');
  if (variant !== 'standard' && !(await page.locator('.drink').count())) throw new Error('no drink prompts in the result');
  if (variant === 'deadly' && !(await page.locator('.drink-shot').count())) throw new Error('no shot in the Deadly result');
  if (!(await page.locator('.scores').count())) throw new Error('no scores in the result');
  await page.reload(); // one-phone games survive a refresh
  await page.locator('.imp-result').waitFor();
  await h.hostClick(page, 'Next round');
  await page.locator('.gate').waitFor();
}

export async function room({ players, host, tv, variant, h }) {
  for (const p of players) await p.locator('.imp-card').waitFor();
  await h.shot(tv, 'tv-reveal');
  let word = null;
  const impIdx = [];
  for (const [i, p] of players.entries()) {
    // Got it stays locked until the card has been flipped.
    if (!(await p.locator('[data-act="seen"][disabled]').count())) throw new Error('Got it is tappable before the card is flipped');
    await p.locator('.imp-card').click();
    if (!(await p.locator('.imp-back.is-imposter').count())) word = (await p.locator('.imp-word').textContent()).trim();
    else impIdx.push(i);
  }
  if (!word) throw new Error('nobody got the word');
  let imposters = 0;
  for (const p of players) {
    if (await p.locator('.imp-back.is-imposter').count()) {
      imposters++;
      if ((await p.content()).includes(word)) throw new Error('imposter page contains the word');
    }
  }
  if (imposters !== 1) throw new Error(`expected 1 imposter, saw ${imposters}`);
  if ((await tv.content()).includes(word)) throw new Error('TV page contains the word');
  h.log(`  word "${word}" reached the crew only; TV clean`);
  await h.shot(players[0], 'card');
  for (const p of players) await p.locator('[data-act="seen"]').click();
  await host.locator('.cd-ring').waitFor();
  await tv.locator('.cd-ring').waitFor();
  await h.shot(tv, 'tv-discuss');
  await h.shot(players[1], 'discuss');
  await h.hostClick(host, 'Vote now');
  for (const p of players) await p.locator('.pick[data-act="vote"]').first().waitFor();
  await h.shot(players[0], 'vote');
  // Deadly: the crew all vote for the imposter (the imposter votes anyone).
  const names = ['Ana', 'Ben', 'Cy'];
  for (const [i, p] of players.entries()) {
    if (variant === 'deadly' && !impIdx.includes(i)) await p.locator('.pick[data-act="vote"]', { hasText: names[impIdx[0]] }).click();
    else await p.locator('.pick[data-act="vote"]').first().click();
  }
  if (variant === 'deadly') {
    await tv.locator('.moment.revealed').waitFor({ timeout: 8000 });
    await h.shot(tv, 'tv-deadly-takeover');
    const t = (await tv.locator('.moment').innerText()).replace(/\s+/g, ' ');
    if (!t.includes(names[impIdx[0]]) || !/shot/i.test(t)) throw new Error(`TV takeover does not name the caught imposter: ${t}`);
    h.log(`  TV takeover: ${t}`);
  }
  for (const p of players) await p.locator('.imp-result').waitFor();
  await tv.locator('.imp-result').waitFor();
  await h.shot(players[0], 'result');
  await tv.locator('.moment').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  await h.shot(tv, 'tv-result');
  if (!(await tv.content()).includes(word)) throw new Error('TV result does not reveal the word');
  if (variant !== 'standard' && !(await players[0].locator('.drink').count())) throw new Error('no drink prompts');
}
