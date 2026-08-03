import { expect, test } from '@playwright/test';

test('GATE 1c — quiz boots on the mock, mobile-first', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/j/ABC123');
  await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-37');

  // screen-inventory §6: nothing below 16px, or iOS zooms on focus.
  const rootPx = await page.evaluate(() =>
    Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
  );
  expect(rootPx).toBeGreaterThanOrEqual(16);

  // Portrait, one-handed: the page must not scroll sideways at 360px.
  await page.setViewportSize({ width: 360, height: 780 });
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflows, 'the quiz app must never scroll horizontally').toBe(false);

  expect(errors).toEqual([]);
});

test('GATE 1d — every quiz route skeleton renders', async ({ page }) => {
  for (const [path, screenId] of [
    ['/j/ABC123', 'S-37'],
    ['/j/ABC123/register', 'S-38'],
    ['/s/01JBQ8ZK3T7WBM5N2Q4XPRVC9D', 'S-39'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', screenId);
  }
});
