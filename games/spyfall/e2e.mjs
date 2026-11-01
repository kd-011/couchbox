// Spyfall e2e driver, run by e2e/play.mjs. Plays one full round, steering it
// deterministically to the spy-caught-and-stumped ending so the Deadly shot
// (meta.variants.deadly) is exercised in both modes.

async function pickWrongLocation(page, realLocation) {
  const guesses = page.locator('.sf-loc-grid .pick');
  const count = await guesses.count();
  for (let i = 0; i < count; i++) {
    const t = (await guesses.nth(i).textContent()).trim();
    if (t !== realLocation) return guesses.nth(i);
  }
  throw new Error('no wrong location to pick (board too small?)');
}

export async function pass({ page, variant, h }) {
  let spyIdx = -1;
  let location = null;
  for (let i = 0; i < 3; i++) {
    await page.locator('.gate').waitFor();
    if (await page.locator('.sf-card').count()) throw new Error('card visible on the gate screen');
    if (i === 0) await h.shot(page, 'gate');
    await page.locator('#gate-go').click();
    await page.locator('.sf-card').click();
    if (i === 0) await h.shot(page, 'card');
    const isSpy = await page.locator('.sf-back.is-spy').count();
    if (isSpy) {
      spyIdx = i;
    } else {
      location = (await page.locator('.sf-loc').textContent()).trim();
    }
    await page.locator('[data-act="seen"]').click();
  }
  if (spyIdx === -1 || !location) throw new Error('could not identify the spy and the location');
  h.log(`  location "${location}", spy is player ${spyIdx + 1}`);
  await page.locator('.cd-ring').waitFor();
  await h.shot(page, 'discuss');
  await h.hostClick(page, 'Vote now');
  await page.locator('.pick[data-act="accuse"]').first().waitFor();
  await h.shot(page, 'vote');
  if (variant === 'deadly' && !(await page.locator('.deadly-note').count())) throw new Error('Deadly rule not telegraphed at the vote');
  await page.locator('.pick[data-act="accuse"]').nth(spyIdx).click();
  await h.confirmSheet(page);
  // Caught: the phone is passed to the spy specifically for their last chance.
  await page.locator('.gate').waitFor();
  await h.shot(page, 'last-chance-gate');
  await page.locator('#gate-go').click();
  await page.locator('.sf-loc-grid .pick').first().waitFor();
  await h.shot(page, 'last-chance');
  const wrong = await pickWrongLocation(page, location);
  await wrong.click();
  await h.confirmSheet(page);
  if (variant === 'deadly') await h.expectMoment(page, /takes a shot/i, 'deadly-takeover');
  await page.locator('.sf-result').waitFor();
  await h.shot(page, 'result');
  if (variant !== 'standard' && !(await page.locator('.drink').count())) throw new Error('no drink prompts in the result');
  if (variant === 'deadly' && !(await page.locator('.drink-shot').count())) throw new Error('no shot in the Deadly result');
  if (!(await page.locator('.scores').count())) throw new Error('no scores in the result');
  await page.reload(); // one-phone games survive a refresh
  await page.locator('.sf-result').waitFor();
  await h.hostClick(page, 'Next round');
  await page.locator('.gate').waitFor();
}

export async function room({ players, host, tv, variant, h }) {
  for (const p of players) await p.locator('.sf-card').waitFor();
  await h.shot(tv, 'tv-reveal');
  let location = null;
  const spyIdx = [];
  for (const [i, p] of players.entries()) {
    await p.locator('.sf-card').click();
    if (await p.locator('.sf-back.is-spy').count()) spyIdx.push(i);
    else location = (await p.locator('.sf-loc').textContent()).trim();
  }
  if (!location) throw new Error('nobody got the location');
  if (spyIdx.length !== 1) throw new Error(`expected 1 spy, saw ${spyIdx.length}`);
  for (const [i, p] of players.entries()) {
    if (spyIdx.includes(i) && (await p.content()).includes(location)) throw new Error('spy page contains the location');
  }
  if ((await tv.content()).includes(location)) throw new Error('TV page contains the location');
  h.log(`  location "${location}" reached the crew only; TV clean`);
  await h.shot(players[0], 'card');
  for (const p of players) await p.locator('[data-act="seen"]').click();
  await host.locator('.cd-ring').waitFor();
  await tv.locator('.cd-ring').waitFor();
  await h.shot(tv, 'tv-discuss');
  await h.shot(players[1], 'discuss');
  await h.hostClick(host, 'Vote now');
  for (const p of players) await p.locator('.pick[data-act="vote"]').first().waitFor();
  await h.shot(players[0], 'vote');
  // Every crew member votes for the real spy (the spy votes anyone else).
  const names = ['Ana', 'Ben', 'Cy'];
  for (const [i, p] of players.entries()) {
    if (!spyIdx.includes(i)) await p.locator('.pick[data-act="vote"]', { hasText: names[spyIdx[0]] }).click();
    else await p.locator('.pick[data-act="vote"]').first().click();
  }
  for (const [i, p] of players.entries()) {
    if (!spyIdx.includes(i)) await p.getByText(/was the spy/i).first().waitFor();
  }
  await tv.getByText(/was the spy/i).first().waitFor();
  await h.shot(tv, 'tv-last-chance');
  const spyPage = players[spyIdx[0]];
  await spyPage.locator('.sf-loc-grid .pick').first().waitFor();
  const wrong = await pickWrongLocation(spyPage, location);
  await wrong.click();
  await h.confirmSheet(spyPage);
  if (variant === 'deadly') {
    await tv.locator('.moment.revealed').waitFor({ timeout: 8000 });
    await h.shot(tv, 'tv-deadly-takeover');
    const t = (await tv.locator('.moment').innerText()).replace(/\s+/g, ' ');
    if (!t.includes(names[spyIdx[0]]) || !/shot/i.test(t)) throw new Error(`TV takeover does not name the caught spy: ${t}`);
    h.log(`  TV takeover: ${t}`);
  }
  for (const p of players) await p.locator('.sf-result').waitFor();
  await tv.locator('.sf-result').waitFor();
  await h.shot(players[0], 'result');
  await tv.locator('.moment').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  await h.shot(tv, 'tv-result');
  if (!(await tv.content()).includes(location)) throw new Error('TV result does not reveal the location');
  if (variant !== 'standard' && !(await players[0].locator('.drink').count())) throw new Error('no drink prompts');
}
