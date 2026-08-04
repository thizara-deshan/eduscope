import { expect, test } from '@playwright/test';

/** The scenario overlay is behind a 2 s long-press on a 44px corner hotspot. */
async function openScenarioOverlay(page: import('@playwright/test').Page) {
  const hotspot = page.getByTestId('scenario-hotspot');
  const box = await hotspot.boundingBox();
  if (!box) throw new Error('scenario hotspot has no box — is the mock client active?');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(2_200);
  await page.mouse.up();
  await expect(page.getByRole('dialog', { name: /scenario/i })).toBeVisible();
}

test.describe('panel scaffold smoke', () => {
  test('boots on the mock at the kiosk size with no page scroll', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('us-panel')).toBeVisible();

    const overflow = await page.evaluate(() => getComputedStyle(document.body).overflow);
    expect(overflow).toBe('hidden');

    const scrolls = await page.evaluate(
      () => document.documentElement.scrollHeight > window.innerHeight,
    );
    expect(scrolls, 'the kiosk page must never scroll').toBe(false);

    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });

  test('the happy scenario reaches the recording state', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-recording-state]')).toHaveAttribute(
      'data-recording-state',
      'idle',
    );

    await openScenarioOverlay(page);
    await page.getByTestId('e2e-start-recording').click();

    // R-01 -> starting, then R-05 -> recording ~1.2 s later (T-START-CONFIRM: 5 s).
    await expect(page.locator('[data-recording-state]')).toHaveAttribute(
      'data-recording-state',
      'starting',
    );
    await expect(page.locator('[data-recording-state]')).toHaveAttribute(
      'data-recording-state',
      'recording',
      { timeout: 6_000 },
    );
  });

  test('the overlay switches scripts live and start-fails never reads as recording',
    async ({ page }) => {
      await page.goto('/');
      await openScenarioOverlay(page);
      await page.getByRole('radio', { name: /start-fails/ }).check();
      await expect(page.getByTestId('active-scenario')).toHaveText('start-fails');

      const seen: string[] = [];
      await page.exposeFunction('__recordState', (s: string) => {
        seen.push(s);
      });
      await page.evaluate(() => {
        const el = document.querySelector('[data-recording-state]');
        if (!el) return;
        new MutationObserver(() => {
          (window as unknown as { __recordState(s: string): void }).__recordState(
            el.getAttribute('data-recording-state') ?? '',
          );
        }).observe(el, { attributes: true, attributeFilter: ['data-recording-state'] });
      });

      await page.getByTestId('e2e-start-recording').click();
      await expect(page.locator('[data-recording-state]')).toHaveAttribute(
        'data-recording-state',
        'error',
        { timeout: 6_000 },
      );
      expect(seen, 'a failed start must never read as recording (B-12)').not.toContain(
        'recording',
      );
    });
});
