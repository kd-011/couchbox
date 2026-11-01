// Tune In e2e driver, run by e2e/play.mjs. Plays one full round in each mode.
// Rounds is trimmed to the minimum in setup() so a run stays quick; neither
// driver needs to reach the game's natural end to prove the mechanics work.

export async function setup({ page, h }) {
  for (let i = 0; i < 4; i++) await h.tap(page, 'button[data-key="rounds"][data-step="-1"]');
}

// Drag the live dial on `page` to roughly `pct` (0-100) with the mouse.
async function dragDial(page, pct) {
  const box = await page.locator('.ti-track-live').boundingBox();
  const x = box.x + box.width * (Math.max(2, Math.min(98, pct)) / 100);
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 6, y);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

async function readTarget(page) {
  const style = await page.locator('.ti-marker.is-target').getAttribute('style');
  const m = style && style.match(/left:\s*([\d.]+)%/);
  if (!m) throw new Error('could not read the target position');
  return Number(m[1]);
}

export async function pass({ page, variant, h }) {
  await page.locator('.gate').waitFor();
  if (await page.locator('.ti-marker.is-target').count()) throw new Error('target visible on the gate screen');
  await h.shot(page, 'gate');
  await page.locator('#gate-go').click();
  await page.locator('.ti-marker.is-target').waitFor();
  await h.shot(page, 'psychic-target');
  const target = await readTarget(page);
  await page.fill('.ti-clue-form [name="text"]', 'chilly');
  await page.locator('.ti-clue-form button[type=submit]').click();

  await page.locator('.ti-track-live').waitFor();
  await h.shot(page, 'guess-shared');
  // Deadly: deliberately drag to the far end from the target, so the guess
  // misses by a mile and the Psychic's shot moment has something to find.
  const missPct = target < 50 ? 95 : 5;
  await dragDial(page, variant === 'deadly' ? missPct : 60);
  await h.hostClick(page, 'Lock it in');
  if (variant === 'deadly') await h.expectMoment(page, /takes a shot/i, 'deadly-takeover');
  await page.locator('.ti-band').waitFor();
  await h.shot(page, 'result');
  if (variant === 'deadly' && !(await page.locator('.drink-shot').count())) throw new Error('no shot for the wild miss');
  if (!(await page.locator('.scores').count())) throw new Error('no scores in the result');
  await page.reload(); // one-phone games survive a refresh
  await page.locator('.ti-band').waitFor();
  await h.hostClick(page, 'Next round');
  await page.locator('.gate').waitFor();
}

// Whoever got dealt the Psychic rotation isn't known in advance, and the
// clue-form render lands a moment after the generic "some content" wait
// below resolves (it's a further websocket round trip, not instant), so
// poll briefly across all three pages rather than taking one immediate scan.
async function findPsychic(players, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    for (const p of players) if (await p.locator('.ti-clue-form').count()) return p;
    await players[0].waitForTimeout(100);
  }
  return null;
}

export async function room({ players, host, tv, variant, h }) {
  const psychicPage = await findPsychic(players);
  if (!psychicPage) throw new Error('nobody has the clue form');
  await h.shot(psychicPage, 'psychic-clue');
  await h.shot(tv, 'tv-clue-wait');

  const target = await readTarget(psychicPage);
  for (const p of players) {
    if (p !== psychicPage && (await p.locator('.ti-marker.is-target').count())) throw new Error('target leaked to a non-psychic');
  }
  if (await tv.locator('.ti-marker.is-target').count()) throw new Error('target leaked to the TV');

  await psychicPage.fill('.ti-clue-form [name="text"]', 'frosty');
  await psychicPage.locator('.ti-clue-form button[type=submit]').click();

  const guessers = players.filter((p) => p !== psychicPage);
  for (const p of guessers) await p.locator('.ti-track-live').waitFor();
  await h.shot(guessers[0], 'guess');
  await h.shot(tv, 'tv-guess');

  const missPct = target < 50 ? 95 : 5;
  for (const [i, p] of guessers.entries()) {
    await dragDial(p, variant === 'deadly' ? missPct : 40 + i * 20);
  }

  for (const p of players) await p.locator('.ti-band').first().waitFor({ timeout: 10_000 });
  await tv.locator('.ti-band').waitFor({ timeout: 10_000 });
  if (variant === 'deadly') {
    await tv.locator('.moment.revealed').waitFor({ timeout: 8000 });
    h.log(`  TV takeover: ${(await tv.locator('.moment').innerText()).replace(/\s+/g, ' ')}`);
    await h.expectMoment(psychicPage, /takes a shot/i, 'deadly-takeover');
  }
  await h.shot(tv, 'tv-result');
  if (!(await host.locator('.scores').count())) throw new Error('no scores in the result');
  if (variant === 'deadly' && !(await host.locator('.drink-shot').count())) throw new Error('no shot in the deadly result');
}
