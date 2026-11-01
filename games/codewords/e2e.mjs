// Codewords e2e driver, run by e2e/play.mjs. Team split, who's the Caller,
// and the board layout are all server-random, so the driver reads the
// Caller's own key view (the only screen the full key ever reaches) to find
// the Bomb's word, gives a throwaway clue, then taps the Bomb directly. That
// deterministically reaches `final` in one turn in every tier, and exercises
// the Deadly moment (and the Drinking sip fallback) on purpose.
const CLUE = 'vexnomir';

async function findBombWord(page) {
  const tiles = page.locator('.cw-tile.cw-key');
  const n = await tiles.count();
  for (let i = 0; i < n; i++) {
    const style = await tiles.nth(i).getAttribute('style');
    if (style && style.includes('deadly')) return (await tiles.nth(i).locator('.cw-word').textContent()).trim();
  }
  throw new Error('no Bomb tile found in the Caller’s key view');
}

async function tapWord(pages, word) {
  for (const p of pages) {
    const btn = p.locator(`.cw-tile[data-arg="${word}"]`);
    if (await btn.count() && !(await btn.isDisabled())) { await btn.click(); return p; }
  }
  throw new Error(`no enabled tile for "${word}" on any page`);
}

export async function pass({ page, variant, h }) {
  await page.locator('#gate-go').waitFor();
  await h.shot(page, 'gate');
  await page.locator('#gate-go').click();
  await page.locator('.cw-clue-form').waitFor();
  await h.shot(page, 'caller-key');
  const bombWord = await findBombWord(page);
  await page.locator('.cw-clue-form input[name="word"]').fill(CLUE);
  await page.locator('.cw-clue-form button[type=submit]').click();
  await page.locator('#pp-main .cw-board').waitFor();
  await h.shot(page, 'guess-board');
  await page.locator(`.cw-tile[data-arg="${bombWord}"]`).click();
  // On one phone the single screen auto-dismisses the "mo-done" takeover for
  // itself while Playwright auto-waits on the next locator (same as every
  // other game's pass driver), so match on the moment's title (teamShot's
  // "<Team> takes shots", always present) rather than the Bomb "why" text in
  // its sub-line, which the auto-dismiss handler does not keep around.
  await page.locator('.cw-final .cw-win').waitFor();
  if (variant !== 'standard' && !(await page.locator('.cw-final .drink').count())) throw new Error('no drinks on the final screen');
  if (variant === 'deadly') await h.expectMoment(page, /takes shots/i, 'deadly-takeover');
  await h.shot(page, 'final');
}

export async function room({ players, tv, variant, h }) {
  let callerPage = null;
  for (let tries = 0; tries < 40 && !callerPage; tries++) {
    for (const p of players) if (await p.locator('.cw-clue-form').count()) { callerPage = p; break; }
    if (!callerPage) await tv.waitForTimeout(150);
  }
  if (!callerPage) throw new Error('no Caller screen appeared among the players');
  await h.shot(callerPage, 'caller-key');
  const bombWord = await findBombWord(callerPage);
  await callerPage.locator('.cw-clue-form input[name="word"]').fill(CLUE);
  await callerPage.locator('.cw-clue-form button[type=submit]').click();
  await tv.locator('.cw-clue-word').waitFor();
  await h.shot(tv, 'tv-guess');
  const tapper = await tapWord(players, bombWord);
  await h.shot(tapper, 'bomb-tap');
  for (const p of [...players, tv]) await p.locator('.cw-final .cw-win').waitFor({ timeout: 10_000 });
  if (variant !== 'standard') {
    let sawDrink = false;
    for (const p of players) if (await p.locator('.cw-final .drink').count()) sawDrink = true;
    if (!sawDrink) throw new Error('no drinks on the final screen');
  }
  if (variant === 'deadly') await h.expectMoment(tv, /bomb/i, 'tv-deadly-takeover');
  await h.shot(tv, 'tv-final');
}
