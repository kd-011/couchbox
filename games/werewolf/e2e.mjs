// Werewolf e2e driver, run by e2e/play.mjs. Plays one full night -> day ->
// discuss -> vote -> result -> final loop.
//
// The harness gives us only 3 simulated players (pass: 3 typed-in names;
// room: host + 2 joiners), well under the real minPlayers of 5. The 'auto'
// werewolves option already lands on exactly 1 wolf for 3 players, so we
// only need to turn the seer and doctor off (so there is exactly one
// required night actor, not three) and shorten the night timer. With 1 wolf
// and 2 others, any single death — the night's kill or the day's lynch —
// immediately decides the game (2 players left is always 1-wolf-vs-1-other,
// which is a werewolf win by the rules, or a village win if the wolf itself
// died), so the clean way to prove the *whole* loop (not just an instant
// win off the first kill) is to let the werewolf's night time out with no
// kill, then let the vote decide it.
const NIGHT_WAIT_MS = 21_000; // nightSeconds is turned down to 20 in setup()

export async function setup({ page, h }) {
  await page.locator('button[data-key="seer"]').click();
  await page.locator('button[data-key="doctor"]').click();
  await page.locator('button[data-step="-1"][data-key="nightSeconds"]').click();
  await page.locator('button[data-step="-1"][data-key="nightSeconds"]').click();
  if (h) h.log('  seer/doctor off, night shortened to 20s for the 3-player harness');
}

export async function pass({ page, variant, h }) {
  // The lone werewolf is the only private step; nobody else has a night
  // action, so the shared screen goes straight to this one gate.
  await page.locator('.gate').waitFor();
  await h.shot(page, 'gate');
  await page.locator('#gate-go').click();
  await page.locator('.ww-stage').waitFor();
  await h.shot(page, 'night');
  if (!(await page.locator('.pick[data-act="nightKill"]').count())) throw new Error('the werewolf has no targets to pick from');
  // Deliberately do not pick a kill: let the night time out so the day,
  // discuss and vote phases all get exercised before anyone is decided.
  await page.waitForTimeout(NIGHT_WAIT_MS);
  await page.locator('.tv-big').waitFor({ timeout: 5000 });
  await h.shot(page, 'day');
  if (await page.locator('.ww-reveal-death').count()) throw new Error('expected nobody to have died this night (the wolf never picked a target)');
  await h.hostClick(page, 'Wake the village');
  await page.locator('.cd-ring').waitFor();
  await h.shot(page, 'discuss');
  await h.hostClick(page, 'Vote now');
  await page.locator('.pick[data-act="accuse"]').first().waitFor();
  await h.shot(page, 'vote');
  if (variant === 'deadly' && !(await page.locator('.deadly-note').count())) throw new Error('Deadly rule not telegraphed at the vote');
  // Every run lynches someone, so in Deadly the lynch shot always lands.
  await page.locator('.pick[data-act="accuse"]').first().click();
  await h.confirmSheet(page);
  if (variant === 'deadly') await h.expectMoment(page, /takes? a shot/i, 'deadly-takeover');
  await page.locator('.tv-big').waitFor();
  await h.shot(page, 'result');
  if (variant === 'deadly' && !(await page.locator('.drink-shot').count())) throw new Error('no lynch shot in the Deadly result');
  // 3 players means one death always decides it (2 left is always a
  // werewolf win, or a village win if the wolf itself was the one lynched).
  await h.hostClick(page, 'Reveal the ending');
  await page.locator('.ww-headline').waitFor();
  await h.shot(page, 'final');
  if (variant !== 'standard' && !(await page.locator('.drink').count())) throw new Error('no drink prompts in the final reveal');
  if (!(await page.locator('.scores').count())) throw new Error('no scores in the final reveal');
}

export async function room({ players, host, tv, variant, h }) {
  for (const p of players) await p.locator('.ww-stage, .state-card').waitFor();
  await h.shot(tv, 'tv-night');

  let wolfPage = null;
  for (const p of players) if (await p.locator('.ww-role-werewolf').count()) wolfPage = p;
  if (!wolfPage) throw new Error('no player sees the werewolf role card');
  for (const p of players) {
    if (p === wolfPage) continue;
    if ((await p.content()).includes('ww-role-werewolf')) throw new Error('a villager page contains the werewolf role card');
  }
  if ((await tv.content()).includes('ww-role')) throw new Error('TV must never show a role card');
  h.log('  the werewolf role reached exactly one phone; TV and villagers are clean');
  await h.shot(wolfPage, 'wolf-card');
  if (!(await wolfPage.locator('.pick[data-act="nightKill"]').count())) throw new Error('the werewolf has no targets to pick from');

  // Let the night time out with no kill, same reasoning as the pass driver.
  await tv.waitForTimeout(NIGHT_WAIT_MS);
  await tv.locator('.tv-big').waitFor({ timeout: 5000 });
  for (const p of players) await p.locator('.ww-stage, .state-card').waitFor({ timeout: 5000 });
  await h.shot(players[0], 'day');
  await h.shot(tv, 'tv-day');
  await h.hostClick(host, 'Wake the village');
  await tv.locator('.cd-ring').waitFor();
  await h.shot(tv, 'tv-discuss');
  await h.hostClick(host, 'Vote now');
  for (const p of players) await p.locator('.pick[data-act="vote"]').first().waitFor();
  await h.shot(players[0], 'vote');
  if (variant === 'deadly') {
    for (const p of [players[1], tv]) if (!(await p.locator('.deadly-note').count())) throw new Error('Deadly rule not telegraphed at the vote');
  }
  // Everyone votes for the first name in their own grid: with 3 players
  // this always produces a 2-1 majority for the first-joined player (the
  // other two both name them, they name someone else), so the vote
  // resolves on its own without needing to close it by hand.
  for (const p of players) await p.locator('.pick[data-act="vote"]').first().click();
  if (variant === 'deadly') {
    // Ana is lynched 2-1 (see above), and takes the Deadly shot.
    await tv.locator('.moment.revealed').waitFor({ timeout: 8000 });
    await h.shot(tv, 'tv-deadly-takeover');
    const t = (await tv.locator('.moment').innerText()).replace(/\s+/g, ' ');
    if (!/Ana takes a shot/i.test(t)) throw new Error(`TV takeover does not name the lynched player: ${t}`);
    if (/werewolf|villager/i.test(t)) throw new Error(`TV takeover mentions a role: ${t}`);
    h.log(`  TV takeover: ${t}`);
    await h.expectMoment(players[1], /takes? a shot/i, 'deadly-takeover');
  }
  for (const p of [...players, tv]) await p.locator('.ww-stage, .tv-stage').waitFor();
  await h.shot(players[0], 'result');
  await tv.locator('.moment').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  await h.shot(tv, 'tv-result');
  if (variant === 'deadly' && !(await players[1].locator('.drink-shot').count())) throw new Error('no lynch shot in the Deadly result');

  await h.hostClick(host, 'Reveal the ending');
  for (const p of [...players, tv]) await p.locator('.ww-headline').waitFor({ timeout: 8000 });
  await h.shot(players[0], 'final');
  await h.shot(tv, 'tv-final');
  if (variant !== 'standard' && !(await players[0].locator('.drink').count())) throw new Error('no drink prompts in the final reveal');
  if (!(await players[0].locator('.scores').count())) throw new Error('no scores in the final reveal');
}
