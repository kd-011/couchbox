// High Card e2e driver: the smallest possible example.
export async function pass({ page, h }) {
  for (let i = 0; i < 3; i++) {
    await page.locator('#gate-go').click();
    await page.locator('[data-act="looked"]').click();
  }
  await h.hostClick(page, 'Flip the cards');
  await page.getByText(/wins round 1/).waitFor();
  await h.shot(page, 'result');
}

export async function room({ players, host, tv, h }) {
  for (const p of players) await p.locator('[data-act="looked"]').click();
  await h.hostClick(host, 'Flip the cards');
  for (const p of [...players, tv]) await p.getByText(/wins round 1/).waitFor();
  await h.shot(tv, 'tv-result');
}
