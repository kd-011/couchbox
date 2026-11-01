// Paranoia e2e driver, run by e2e/play.mjs. The coin flip is random, so the
// room driver loops a few rounds to actually witness a reveal (and, in
// Deadly, the shot that comes with it) rather than assuming the first flip
// goes either way.

export async function pass({ page, variant, h }) {
  await page.locator('.gate').waitFor();
  await h.shot(page, 'gate');
  if (await page.locator('.pn-question').count()) throw new Error('question visible on the gate screen');
  await page.locator('#gate-go').click();
  await page.locator('.pn-question').waitFor();
  const q = (await page.locator('.pn-question').textContent()).trim();
  h.log(`  asker reads: ${q}`);
  await h.shot(page, 'question');
  await page.locator('[data-act="read"]').click();
  await page.locator('.pick[data-act="chooseTarget"]').first().waitFor();
  await h.shot(page, 'target');
  await page.locator('.pick[data-act="chooseTarget"]').first().click();
  await page.locator('.pick[data-act="recordAnswer"]').first().waitFor();
  if (variant === 'deadly' && !(await page.locator('.deadly-note').count())) throw new Error('Deadly rule not telegraphed before naming');
  await h.shot(page, 'answer');
  await page.locator('.pick[data-act="recordAnswer"]').first().click();
  await page.locator('.pn-result').waitFor();
  await h.shot(page, 'result');
  if (!(await page.locator('.scores').count())) throw new Error('no scores in the result');
  const revealed = await page.locator('.pn-headline.is-revealed').count();
  h.log(`  round 1: ${revealed ? 'revealed' : 'stayed secret'}`);
  await page.reload(); // one-phone games survive a refresh
  await page.locator('.pn-result').waitFor();
  await h.hostClick(page, 'Next round');
  await page.locator('.gate').waitFor();
}

// The Asker's screen can take a beat to settle right after the lobby hands
// off to the first round (more so behind the Deadly 18+ rails sheet), so
// poll briefly instead of taking one snapshot.
async function findAsker(players) {
  for (let i = 0; i < 20; i++) {
    for (const p of players) if (await p.locator('.pn-question').count()) return p;
    await players[0].waitForTimeout(150);
  }
  return null;
}

export async function room({ players, host, tv, variant, h }) {
  const MAX_ROUNDS = 6;
  let sawReveal = false;
  for (let r = 0; r < MAX_ROUNDS; r++) {
    const askerPage = await findAsker(players);
    if (!askerPage) throw new Error(`round ${r + 1}: no screen is showing the question`);

    if (r === 0) {
      await h.shot(tv, 'tv-ask');
      await h.shot(askerPage, 'asker-question');
      const q = (await askerPage.locator('.pn-question').textContent()).trim();
      h.log(`  round 1 asker reads: ${q}`);
      for (const p of players) {
        if (p === askerPage) continue;
        if ((await p.content()).includes(q)) throw new Error('the question leaked to a non-asker screen');
      }
      if ((await tv.content()).includes(q)) throw new Error('the question leaked to the TV');
    }

    await askerPage.locator('[data-act="read"]').click();
    await askerPage.locator('.pick[data-act="chooseTarget"]').first().waitFor();
    if (r === 0) await h.shot(askerPage, 'target');
    await askerPage.locator('.pick[data-act="chooseTarget"]').first().click();
    await askerPage.locator('.pick[data-act="recordAnswer"]').first().waitFor();
    if (variant === 'deadly' && !(await askerPage.locator('.deadly-note').count())) throw new Error('Deadly rule not telegraphed at the answer step');
    if (r === 0) await h.shot(askerPage, 'answer');
    await askerPage.locator('.pick[data-act="recordAnswer"]').first().click();

    for (const p of players) await p.locator('.pn-result').waitFor();
    await tv.locator('.pn-result').waitFor();
    if (r === 0) { await h.shot(players[0], 'result'); await h.shot(tv, 'tv-result'); }

    if (await tv.locator('.pn-headline.is-revealed').count()) {
      sawReveal = true;
      h.log(`  round ${r + 1}: revealed`);
      if (variant !== 'standard' && !(await players[0].locator('.drink').count())) throw new Error('no drink prompts in a revealed result');
      if (variant === 'deadly') await h.expectMoment(tv, /takes a shot/i, 'deadly-takeover');
    } else {
      h.log(`  round ${r + 1}: stayed secret`);
    }

    if (!(await tv.locator('.scores').count())) throw new Error('no scores in the result');

    // Stop at the result screen rather than auto-advancing past it: the
    // harness's host-failover check (run right after this driver returns,
    // for the first game's standard room run) needs a host action on offer,
    // and "Next round" on the result screen is it.
    if (sawReveal || r === MAX_ROUNDS - 1) break;
    await h.hostClick(host, 'Next round');
    await Promise.all(players.map((p) => p.locator('.pn-question, .pn-stage, .state-card').first().waitFor()));
  }
  if (variant === 'deadly' && !sawReveal) throw new Error(`never saw a reveal across ${MAX_ROUNDS} rounds (bad luck, or a bug)`);
}
