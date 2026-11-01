// Celebrity Heads e2e driver, run by e2e/play.mjs. Plays a full rotation.

// Shortest turns so the round finishes quickly. Runs on the set-up form
// (one phone) or the host's lobby (rooms).
export async function setup({ page, h }) {
  for (let i = 0; i < 2; i++) await h.tap(page, 'button[data-key="seconds"][data-step="-1"]');
}

// Deadly: the first guesser only passes, so they guess nothing (a shot) and
// finish alone in last place (a second shot at the end).
const planFor = (variant, turn) => (variant === 'deadly' && turn === 0 ? ['pass', 'pass'] : ['got', 'pass', 'got']);

export async function pass({ page, variant, h }) {
  const deadly = variant === 'deadly';
  for (let turn = 0; turn < 3; turn++) {
    if (deadly && turn === 0 && !(await page.locator('.deadly-note').count())) throw new Error('Deadly rule not telegraphed before the turn');
    await h.hostClick(page, 'Start the turn');
    await page.locator('.hd-word').waitFor();
    if (turn === 0) await h.shot(page, 'forehead');
    if (deadly && turn === 0 && !(await page.locator('.deadly-note').count())) throw new Error('Deadly rule not telegraphed during the turn');
    for (const k of planFor(variant, turn)) {
      const before = await page.locator('.hd-word').textContent();
      await page.locator(`[data-act="${k}"]`).click();
      await page.waitForFunction((b) => document.querySelector('.hd-word')?.textContent !== b, before);
    }
    await h.hostClick(page, 'End turn');
    if (deadly && turn === 0) await h.expectMoment(page, /Guessed Nothing/i, 'deadly-takeover');
    await page.locator('.hd-recap').waitFor();
    if (turn === 0) await h.shot(page, 'recap');
    if (variant !== 'standard' && turn === 0 && !(await page.locator('.drink').count())) throw new Error('no drink prompt after a pass');
    if (deadly && turn === 0 && !(await page.locator('.hd-recap .drink-shot').count())) throw new Error('no shot for guessing nothing');
    if (!(await page.locator('.hd-recap .scores').count())) throw new Error('no scores in the recap');
    await h.hostClick(page, turn === 2 ? 'See the results' : 'Next player');
  }
  if (deadly) await h.expectMoment(page, /Last Place/i, 'deadly-last-place');
  await page.locator('.hd-final').waitFor();
  await h.shot(page, 'final');
  if (variant !== 'standard' && !(await page.locator('.hd-final .drink').count())) throw new Error('no final drinks');
  if (deadly && !(await page.locator('.hd-final .drink-shot').count())) throw new Error('no last-place shot at the end');
  if (!(await page.locator('.hd-final .scores').count())) throw new Error('no final scores');
}

export async function room({ players, host, tv, variant, h }) {
  const deadly = variant === 'deadly';
  for (let turn = 0; turn < 3; turn++) {
    let guesser = null;
    for (const p of players) {
      await p.locator('.hd-stage, .hd-recap').first().waitFor();
      if (await p.locator('[data-act="start"]').count()) guesser = p;
    }
    if (!guesser) throw new Error('no guesser start button');
    if (turn === 0) await h.shot(guesser, 'guesser-ready');
    await guesser.locator('[data-act="start"]').click();
    const clues = players.filter((p) => p !== guesser);
    await clues[0].locator('.hd-word').waitFor();
    await guesser.locator('.cd-ring').waitFor();
    if (deadly && turn === 0) {
      for (const p of [guesser, clues[0], tv]) {
        if (!(await p.locator('.deadly-note').count())) throw new Error('Deadly rule not telegraphed during the turn');
      }
    }
    for (const [k, move] of planFor(variant, turn).entries()) {
      const word = (await clues[0].locator('.hd-word').textContent()).trim();
      if ((await guesser.content()).includes(`>${word}<`)) throw new Error('guesser page shows the word');
      if ((await tv.content()).includes(`>${word}<`)) throw new Error('TV shows the live word');
      await clues[k % 2].locator(`[data-act="${move}"]`).click();
      await clues[0].waitForFunction((w) => document.querySelector('.hd-word')?.textContent.trim() !== w, word);
    }
    if (turn === 0) {
      await h.shot(clues[0], 'clue');
      await h.shot(guesser, 'guesser');
      await h.shot(tv, 'tv-play');
    }
    await h.hostClick(host, 'End turn');
    if (deadly && turn === 0) {
      await tv.locator('.moment.revealed').waitFor({ timeout: 8000 });
      await h.shot(tv, 'tv-deadly-takeover');
      h.log(`  TV takeover: ${(await tv.locator('.moment').innerText()).replace(/\s+/g, ' ')}`);
      await h.expectMoment(guesser, /Guessed Nothing/i, 'deadly-takeover');
    }
    await host.locator('.hd-recap').waitFor();
    if (deadly && turn === 0 && !(await host.locator('.hd-recap .drink-shot').count())) throw new Error('no shot for guessing nothing');
    if (variant !== 'standard' && turn === 0 && !(await host.locator('.hd-recap .drink').count())) throw new Error('no drink prompt after a pass');
    if (turn === 0) {
      await tv.locator('.moment').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
      await h.shot(host, 'recap');
      await h.shot(tv, 'tv-recap');
      // The TV hides a board of all zeros; Deadly's first turn is scoreless by design.
      if (!deadly && !(await tv.locator('.tv-side .scores').count())) throw new Error('no scores on the TV recap');
    }
    await h.hostClick(host, turn === 2 ? 'See the results' : 'Next player');
  }
  for (const p of players) await p.locator('.hd-final').waitFor();
  await tv.locator('.hd-final').waitFor();
  if (deadly) {
    await tv.locator('.moment.revealed').waitFor({ timeout: 8000 });
    await h.shot(tv, 'tv-deadly-last-place');
    await h.expectMoment(players[1], /Last Place/i, 'deadly-last-place');
  }
  await h.shot(players[1], 'final');
  await tv.locator('.moment').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  await h.shot(tv, 'tv-final');
  if (variant !== 'standard' && !(await players[1].locator('.hd-final .drink').count())) throw new Error('no final drinks');
  if (deadly && !(await players[1].locator('.hd-final .drink-shot').count())) throw new Error('no last-place shot at the end');
  h.log('  guesser and TV never saw a live word');
}
