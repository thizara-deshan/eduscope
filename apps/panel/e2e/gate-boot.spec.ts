import { expect, test } from '@playwright/test';

test('GATE 1a — panel boots on the mock with a live WS snapshot', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('/');
  await expect(page.getByTestId('us-panel')).toBeVisible();

  // The on-subscribe snapshot must have populated the store without any fetch.
  await expect(page.locator('[data-recording-state]')).toHaveAttribute(
    'data-recording-state',
    /idle|recording|paused/,
  );
  expect(errors, `console errors on boot: ${errors.join(' | ')}`).toEqual([]);
});

test('GATE 1b — the overlay switches every catalog script live', async ({ page }) => {
  await page.goto('/');
  const hotspot = page.getByTestId('scenario-hotspot');
  const box = await hotspot.boundingBox();
  if (!box) throw new Error('no scenario hotspot — the mock client is not active');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(2_200);
  await page.mouse.up();

  const dialog = page.getByRole('dialog', { name: /scenario/i });
  await expect(dialog).toBeVisible();

  for (const name of [
    'happy', 'start-fails', 'pipeline-crash-midway', 'llm-timeout',
    'disk-full', 'ws-flap', 'quiz-network-loss', 'auth-failures',
    'poweroff-not-halted',
  ]) {
    await dialog.getByRole('radio', { name: new RegExp(`^${name}$`) }).check();
    await expect(page.getByTestId('active-scenario')).toHaveText(name);
  }
});

test('GATE 1e — 10 s of happy does not turn telemetry into renders', async ({ page }) => {
  await page.goto('/');

  // The shell increments window.__renderCount on every commit of the scaffold
  // probe (added in step 4 below). audio.levels flows at 10 Hz throughout.
  const before = await page.evaluate(() => window.__renderCount ?? 0);
  await page.waitForTimeout(10_000);
  const after = await page.evaluate(() => window.__renderCount ?? 0);

  // ~100 audio.levels events land in this window. A handful of renders from
  // real state changes is expected; anything near 100 means telemetry has
  // leaked back into React state (Task 15) and every screen will pay for it.
  expect(after - before, `renders during 10 s of idle happy: ${after - before}`)
    .toBeLessThan(20);
});
