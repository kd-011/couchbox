// Salad Bowl e2e driver, run by e2e/play.mjs. Shrinks the pot (3 phrases
// each) and the turn timer (30s, the minimum) so a run stays fast, then
// spams "Got it" to clear the bowl each turn. Deadly gets one genuine
// buzzer timeout on the very first turn, to see the real Deadly moment.

export async function setup({ page, h }) {
  await h.tap(page, 'button[data-key="wordsPerPlayer"][data-step="-1"]');
  for (let i = 0; i < 3; i++) await h.tap(page, 'button[data-key="turnSeconds"][data-step="-1"]');
}

async function writePhrase(page, text) {
  await page.locator('[name="text"]').waitFor();
  await page.locator('[name="text"]').fill(text);
  await page.locator('.sb-write button[type=submit]').click();
  await page.waitForTimeout(150);
}

function rand() {
  return Math.random().toString(36).slice(2, 7);
}

export async function pass({ page, variant, h }) {
  const deadly = variant === 'deadly';
  for (let i = 0; i < 3; i++) {
    await page.locator('#gate-go').click();
    for (let n = 0; n < 3; n++) await writePhrase(page, `Phrase ${i}-${n} ${rand()}`);
  }
  await page.locator('[data-act="start"]').waitFor();
  await h.shot(page, 'ready-shared');

  for (let step = 0; step < 12; step++) {
    if (await page.locator('.sb-final').count()) break;
    await page.locator('[data-act="start"]').click();
    await page.locator('.sb-card').waitFor();
    if (step === 0) await h.shot(page, 'turn-shared');
    if (deadly && step === 0) {
      if (!(await page.locator('.deadly-note').count())) throw new Error('Deadly rule not telegraphed on the shared screen');
      await page.locator('.sb-recap').waitFor({ timeout: 40_000 });
      await h.expectMoment(page, /caught holding a card/i, 'deadly-takeover');
    } else {
      for (let i = 0; i < 20 && !(await page.locator('.sb-recap').count()); i++) {
        await page.locator('[data-act="gotIt"]').click().catch(() => {});
        await page.waitForTimeout(120);
      }
    }
    await page.locator('.sb-recap').waitFor({ timeout: 10_000 });
    if (step === 0) {
      await h.shot(page, 'recap');
      // A recap only shows scores once somebody has one (the Deadly run times
      // out its first turn on purpose, so nobody has yet).
      if (!deadly && !(await page.locator('.sb-recap .scores').count())) throw new Error('no scores in the recap');
    }
    const label = (await page.locator('.hostbar .btn').first().textContent()).trim();
    await h.hostClick(page, label);
  }
  await page.locator('.sb-final').waitFor();
  await h.shot(page, 'final');
  if (!(await page.locator('.sb-final .scores').count())) throw new Error('no final scores');
}

export async function room({ players, host, tv, variant, h }) {
  const deadly = variant === 'deadly';
  for (const p of players) {
    for (let n = 0; n < 3; n++) await writePhrase(p, `Phrase ${n} ${rand()}`);
  }
  for (const p of players) await p.locator('.sb-stage, .sb-final').first().waitFor();
  await tv.locator('.tv-stage').first().waitFor();
  await h.shot(host, 'ready');
  await h.shot(tv, 'tv-ready');

  for (let step = 0; step < 12; step++) {
    if (await host.locator('.sb-final').count()) break;
    let active = null;
    for (const p of players) {
      await p.locator('.sb-stage, .sb-turn, .sb-final').first().waitFor();
      if (await p.locator('.sb-stage [data-act="start"]').count()) active = p;
    }
    if (!active) throw new Error('no active player with a start button');
    await active.locator('.sb-stage [data-act="start"]').click();
    await active.locator('.sb-card').waitFor();
    if (step === 0) {
      await h.shot(active, 'turn');
      await h.shot(tv, 'tv-turn');
      if (!(await active.locator('.sb-card').count())) throw new Error('active player should see the card text');
    }
    const others = players.filter((p) => p !== active);
    for (const o of others) {
      if (await o.locator('.sb-card').count()) throw new Error('a non-active player can see the card');
    }
    if (deadly && step === 0) {
      if (!(await active.locator('.deadly-note').count())) throw new Error('Deadly rule not telegraphed to the active player');
      if (!(await tv.locator('.deadly-note').count())) throw new Error('Deadly rule not telegraphed on the TV');
      await active.locator('.sb-recap').waitFor({ timeout: 40_000 });
      await h.expectMoment(active, /caught holding a card/i, 'deadly-takeover');
    } else {
      for (let i = 0; i < 20 && !(await active.locator('.sb-recap').count()); i++) {
        await active.locator('[data-act="gotIt"]').click().catch(() => {});
        await active.waitForTimeout(120);
      }
    }
    for (const p of [...players, tv]) await p.locator('.sb-recap').first().waitFor({ timeout: 10_000 });
    if (step === 0) {
      await h.shot(host, 'recap');
      await h.shot(tv, 'tv-recap');
      // The TV hides a table of all zeros, so only expect one once a phrase
      // has been got (the Deadly run times out its first turn on purpose).
      if (!(deadly && step === 0) && !(await tv.locator('.tv-side .scores').count())) throw new Error('no scores on the TV recap');
    }
    const label = (await host.locator('.hostbar .btn').first().textContent()).trim();
    await h.hostClick(host, label);
  }
  for (const p of [...players, tv]) await p.locator('.sb-final').waitFor({ timeout: 10_000 });
  await h.shot(tv, 'final');
  if (!(await players[0].locator('.sb-final .scores').count())) throw new Error('no final scores');
  h.log('  only the active player ever saw the card');
}
