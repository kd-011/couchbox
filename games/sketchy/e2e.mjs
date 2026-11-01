// Sketchy e2e driver, run by e2e/play.mjs. Draws a couple of simple strokes
// with the mouse and has the other players/host guess correctly.

export async function setup({ page, h }) {
  for (let i = 0; i < 2; i++) await h.tap(page, 'button[data-key="drawSeconds"][data-step="-1"]');
  await h.tap(page, 'button[data-key="turns"][data-step="-1"]');
}

async function drawSomething(page) {
  const box = await page.locator('.skt-canvas').boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x - 60, y - 40);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 6 });
  await page.mouse.move(x + 60, y + 40, { steps: 6 });
  await page.mouse.up();
  // Let the batched addPoints/endStroke actions round-trip back into view.
  await page.waitForTimeout(300);
}

async function markExcept(page, skipName) {
  const chips = await page.locator('[data-act="markGot"]').all();
  for (const c of chips) {
    const txt = await c.textContent();
    if (!txt.includes(skipName)) await c.click();
  }
}

// Deadly: nobody guesses the first drawing (the artist takes a shot). Cy
// never gets one right all game in every tier (a drink, or a shot, at the end).
export async function pass({ page, variant, h }) {
  const deadly = variant === 'deadly';
  for (let turn = 0; turn < 3; turn++) {
    await page.locator('#gate-go').click();
    if (deadly && turn === 0 && !(await page.locator('.deadly-note').count())) throw new Error('Deadly rule not telegraphed to the drawer');
    if (deadly && turn === 0) await h.shot(page, 'drawer-deadly-note');
    await page.locator('[data-act="start"]').click();
    await page.locator('.skt-board.is-live').waitFor();
    if (turn === 0) await h.shot(page, 'draw-shared');
    await drawSomething(page);
    // Cy never gets marked, so the "never guessed one right" drink fires at
    // the end for the drinking variant. If Cy happens to be the drawer this
    // turn every other guesser gets marked and the turn ends on its own;
    // only reach for the host button when it hasn't already.
    if (deadly && turn === 0) {
      if (!(await page.locator('.deadly-note').count())) throw new Error('Deadly rule not telegraphed while drawing');
    } else await markExcept(page, 'Cy');
    if (!(await page.locator('.skt-recap').count())) await h.hostClick(page, 'End turn');
    if (deadly && turn === 0) await h.expectMoment(page, /Nobody Got It/i, 'deadly-takeover');
    await page.locator('.skt-recap').waitFor();
    if (turn === 0) await h.shot(page, 'recap');
    if (deadly && turn === 0 && !(await page.locator('.skt-recap .drink-shot').count())) throw new Error('no shot for the unguessed drawing');
    if (!(await page.locator('.skt-recap .scores').count())) throw new Error('no scores in the recap');
    await h.hostClick(page, turn === 2 ? 'See the results' : 'Next drawer');
  }
  if (deadly) await h.expectMoment(page, /Never Got One/i, 'deadly-never-got');
  await page.locator('.skt-final').waitFor();
  await h.shot(page, 'final');
  if (variant !== 'standard' && !(await page.locator('.skt-final .drink').count())) throw new Error('no final drinks for Cy, who never got one right');
  // A shot, or 3 sips when Cy is already at the hourly shot cap (Party Night).
  if (deadly && !(await page.locator('.skt-final .drink-shot, .skt-final .drink:has-text("shot cap")').count())) throw new Error('no final shot for Cy');
  if (!(await page.locator('.skt-final .scores').count())) throw new Error('no final scores');
}

export async function room({ players, host, tv, variant, h }) {
  const deadly = variant === 'deadly';
  // players[2] (Cy) always guesses wrong, so the drinking variant's "never
  // guessed one right all game" drink fires for them at the final.
  const neverGets = players[2];
  for (let turn = 0; turn < 3; turn++) {
    let drawer = null;
    for (const p of players) {
      await p.locator('.skt-stage, .skt-recap').first().waitFor();
      if (await p.locator('[data-act="start"]').count()) drawer = p;
    }
    if (!drawer) throw new Error('no drawer start button');
    if (turn === 0) await h.shot(drawer, 'drawer-ready');
    const word = (await drawer.locator('.skt-word').textContent()).trim();
    await drawer.locator('[data-act="start"]').click();
    await drawer.locator('.skt-board.is-live').waitFor();
    const guessers = players.filter((p) => p !== drawer);
    await guessers[0].locator('.skt-canvas').waitFor();
    await drawSomething(drawer);
    if ((await guessers[0].content()).includes(`>${word}<`)) throw new Error('a guesser page shows the live word');
    if ((await tv.content()).includes(`>${word}<`)) throw new Error('the TV shows the live word');
    if (turn === 0) {
      await h.shot(drawer, 'drawer-draw');
      await h.shot(guessers[0], 'guesser-draw');
      await h.shot(tv, 'tv-draw');
    }
    // Deadly: everyone misses the first drawing, so the artist takes a shot.
    const nobody = deadly && turn === 0;
    if (nobody) {
      for (const p of [drawer, tv]) if (!(await p.locator('.deadly-note').count())) throw new Error('Deadly rule not telegraphed while drawing');
    }
    for (const g of guessers) {
      const miss = nobody || g === neverGets;
      await g.locator('[name="text"]').fill(miss ? 'definitely-not-it' : word);
      await g.locator('.skt-guess button[type=submit]').click();
      if (!miss) await g.locator('.waiting-line, .skt-recap').first().waitFor();
    }
    // If neverGets was the drawer this turn, every real guesser just got it
    // right and the turn already ended on its own; only reach for the host
    // button when it hasn't.
    if (!(await host.locator('.skt-recap').count())) await h.hostClick(host, 'End turn');
    if (nobody) {
      await tv.locator('.moment.revealed').waitFor({ timeout: 8000 });
      await h.shot(tv, 'tv-deadly-takeover');
      h.log(`  TV takeover: ${(await tv.locator('.moment').innerText()).replace(/\s+/g, ' ')}`);
      await h.expectMoment(drawer, /Nobody Got It/i, 'deadly-takeover');
    }
    for (const p of players) await p.locator('.skt-recap').first().waitFor();
    await tv.locator('.skt-recap').waitFor();
    if (nobody && !(await host.locator('.skt-recap .drink-shot').count())) throw new Error('no shot for the unguessed drawing');
    if (turn === 0) {
      await tv.locator('.moment').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
      await h.shot(host, 'recap');
      await h.shot(tv, 'tv-recap');
      // The TV hides a table of all zeros, which is what a Deadly first
      // turn that nobody guessed leaves behind.
      if (!nobody && !(await tv.locator('.tv-side .scores').count())) throw new Error('no scores on the TV recap');
    }
    await h.hostClick(host, turn === 2 ? 'See the results' : 'Next drawer');
  }
  for (const p of players) await p.locator('.skt-final').waitFor();
  await tv.locator('.skt-final').waitFor();
  if (deadly) {
    await tv.locator('.moment.revealed').waitFor({ timeout: 8000 });
    await h.shot(tv, 'tv-deadly-never-got');
    await h.expectMoment(players[1], /Never Got One/i, 'deadly-never-got');
  }
  await h.shot(players[1], 'final');
  await tv.locator('.moment').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  await h.shot(tv, 'tv-final');
  if (variant !== 'standard' && !(await players[1].locator('.skt-final .drink').count())) throw new Error('no final drinks');
  if (deadly && !(await players[1].locator('.skt-final .drink-shot, .skt-final .drink:has-text("shot cap")').count())) throw new Error('no final shot for Cy');
  h.log('  guessers and TV never saw the live word');
}
