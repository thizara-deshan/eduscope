import { expect, test, type Page } from '@playwright/test';

/** The y of the on-screen keyboard's top edge — the submit button must clear it. */
function oskTop(page: Page): Promise<number> {
  return page.evaluate(() => {
    const panel = document.querySelector('.us-panel') as HTMLElement;
    const osk = parseFloat(getComputedStyle(panel).getPropertyValue('--osk-h')) || 0;
    return panel.getBoundingClientRect().bottom - osk;
  });
}

test.describe('S-01 Login', () => {
  test('primary journey — happy: sign in and land on the dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('a.perera');
    await page.getByLabel('Password').fill('correct-horse');
    await page.getByRole('button', { name: 'Log In' }).click();

    await expect(page).toHaveURL('/');
    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-04');
    await expect(page.locator('.us-header')).toContainText('Engineering Auditorium A301');
  });

  test('failure 1 — rejected credentials', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('a.perera');
    await page.getByLabel('Password').fill('wrong');
    await page.getByRole('button', { name: 'Log In' }).click();

    await expect(page.getByTestId('auth-message')).toHaveText(
      'That username and password do not match. Try again.',
    );
    await expect(page.getByLabel('Username')).toHaveValue('a.perera');
    await expect(page.getByLabel('Password')).toHaveValue('');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('failure 2 — must-reset is the normal path for an imported user', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('n.silva');
    await page.getByLabel('Password').fill('temp-pass-1');
    await page.getByRole('button', { name: 'Log In' }).click();

    await expect(page).toHaveURL(/\/login\/reset$/);
  });

  test('geometry — with the keyboard open, the submit button clears the keyboard', async ({ page }) => {
    await page.goto('/login');
    // Username is autofocused on mount, which opens the keyboard before first paint.
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.us-panel')!).getPropertyValue('--osk-h').trim()))
      .toBe('320px');
    // `.us-login`'s height is CSS-transitioned (200ms) off the --osk-h change;
    // the property flips instantly but the layout settles a beat later.
    await page.waitForTimeout(300);

    const box = await page.getByRole('button', { name: 'Log In' }).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(await oskTop(page));
  });

  test('no page scroll on the login screen', async ({ page }) => {
    await page.goto('/login');
    const scrolls = await page.evaluate(
      () => document.documentElement.scrollHeight > window.innerHeight,
    );
    expect(scrolls).toBe(false);
  });

  test('no header on /login', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('.us-header')).toHaveCount(0);
  });
});
