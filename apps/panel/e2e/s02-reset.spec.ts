import { expect, test, type Page } from '@playwright/test';
import { REAL_STACK_ACCOUNTS, test as realTest } from './fixtures/real-stack.js';

const COMPLIANT = 'Lecture-hall-7';

/** The y of the on-screen keyboard's top edge — the submit button must clear it. */
function oskTop(page: Page): Promise<number> {
  return page.evaluate(() => {
    const panel = document.querySelector('.us-panel') as HTMLElement;
    const osk = parseFloat(getComputedStyle(panel).getPropertyValue('--osk-h')) || 0;
    return panel.getBoundingClientRect().bottom - osk;
  });
}

test.describe('S-02 Forced/voluntary password reset', () => {
  test('primary journey — happy: forced reset lands on the dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('n.silva');
    await page.getByLabel('Password').fill('temp-pass-1');
    await page.getByRole('button', { name: 'Log In' }).click();

    await expect(page).toHaveURL(/\/login\/reset$/);
    await page.getByLabel('Current password').fill('temp-pass-1');
    await page.getByLabel('New password', { exact: true }).fill(COMPLIANT);
    await page.getByLabel('Confirm new password').fill(COMPLIANT);
    await page.getByRole('button', { name: 'Set password' }).click();

    await expect(page).toHaveURL('/');
  });

  test('failure — rejected (current): wrong current password', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('n.silva');
    await page.getByLabel('Password').fill('temp-pass-1');
    await page.getByRole('button', { name: 'Log In' }).click();
    await expect(page).toHaveURL(/\/login\/reset$/);

    await page.getByLabel('Current password').fill('wrong-current');
    await page.getByLabel('New password', { exact: true }).fill(COMPLIANT);
    await page.getByLabel('Confirm new password').fill(COMPLIANT);
    await page.getByRole('button', { name: 'Set password' }).click();

    await expect(page.getByTestId('auth-message')).toHaveText(
      'Your current password is not correct.',
    );
    await expect(page.getByLabel('Current password')).toHaveValue('');
    await expect(page.getByLabel('Current password')).toBeFocused();
    await expect(page).toHaveURL(/\/login\/reset$/);
  });

  test('geometry — submit clears the keyboard in both forced and voluntary modes', async ({ page }) => {
    // forced
    await page.goto('/login');
    await page.getByLabel('Username').fill('n.silva');
    await page.getByLabel('Password').fill('temp-pass-1');
    await page.getByRole('button', { name: 'Log In' }).click();
    await expect(page).toHaveURL(/\/login\/reset$/);
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.us-panel')!).getPropertyValue('--osk-h').trim()))
      .toBe('320px');
    // `.us-reset`'s height is CSS-transitioned (200ms) off the --osk-h change;
    // the property flips instantly but the layout settles a beat later.
    await page.waitForTimeout(300);
    let box = await page.getByRole('button', { name: 'Set password' }).boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(await oskTop(page));

    // voluntary
    await page.goto('/login');
    await page.getByLabel('Username').fill('a.perera');
    await page.getByLabel('Password').fill('correct-horse');
    await page.getByRole('button', { name: 'Log In' }).click();
    await expect(page).toHaveURL('/');
    await page.getByRole('button', { name: /A\. Perera/ }).click();
    await page.getByRole('menuitem', { name: 'Change password' }).click();
    await expect(page).toHaveURL(/\/login\/reset$/);
    await page.getByLabel('Current password').click();
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.us-panel')!).getPropertyValue('--osk-h').trim()))
      .toBe('320px');
    await page.waitForTimeout(300);
    box = await page.getByRole('button', { name: 'Set password' }).boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(await oskTop(page));
  });

  test('no header on /login/reset', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('n.silva');
    await page.getByLabel('Password').fill('temp-pass-1');
    await page.getByRole('button', { name: 'Log In' }).click();
    await expect(page).toHaveURL(/\/login\/reset$/);
    await expect(page.locator('.us-header')).toHaveCount(0);
  });

  test('no escape from forced: no control reaches / and a programmatic nav bounces back', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('n.silva');
    await page.getByLabel('Password').fill('temp-pass-1');
    await page.getByRole('button', { name: 'Log In' }).click();
    await expect(page).toHaveURL(/\/login\/reset$/);

    // No Cancel/Skip/Dashboard affordance anywhere in forced mode.
    await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /dashboard/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /skip/i })).toHaveCount(0);

    // A programmatic client-side nav to / bounces straight back (require-role.tsx:25).
    await page.evaluate(() => {
      window.history.pushState({}, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page).toHaveURL(/\/login\/reset$/);
  });
});

realTest.describe('S-02 Forced/voluntary password reset — real', () => {
  realTest(
    'real: reset-locked user is server-refused off the allowlist, wrong current password rejects, and the new password persists',
    { annotation: { type: 'adapter', description: 'real' } },
    async ({ page, realStack }) => {
      const NEW_PASSWORD = 'Lecture-hall-7';

      // The server correctly refuses the panel WS with 403 while
      // mustResetPassword is true (guard.ts INV-U-3), which the shell attempts
      // regardless of route the moment a token exists. Driving a rejected WS
      // handshake through this CDP-automated older Chromium build hangs the
      // renderer entirely, and `routeWebSocket`'s own CDP-level interception
      // is not reliable enough on this browser to prevent that — so the real
      // `WebSocket` constructor is stubbed out in-page instead. S-02 is not
      // exercising panel realtime behavior.
      await page.addInitScript(() => {
        class NoConnectWebSocket extends EventTarget {
          readyState = 3;
          close(): void {}
          send(): void {}
        }
        // @ts-expect-error -- test-only stub, not the full WebSocket surface
        window.WebSocket = NoConnectWebSocket;
      });

      const loginResponse = await fetch(`${realStack.coreBaseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: REAL_STACK_ACCOUNTS.reset.username,
          password: REAL_STACK_ACCOUNTS.reset.password,
          client: 'panel',
        }),
      });
      expect(loginResponse.status).toBe(200);
      const { tokens } = await loginResponse.json() as { tokens: { accessToken: string } };

      // Prove the refusal is server-side, not merely client routing: a
      // directly-issued bearer token cannot reach a non-allowlisted route.
      const dashboardResponse = await fetch(`${realStack.coreBaseUrl}/recording/state`, {
        headers: { authorization: `Bearer ${tokens.accessToken}` },
      });
      expect(dashboardResponse.status).toBe(403);
      const problem = await dashboardResponse.json() as { code: string };
      expect(problem.code).toBe('auth.password-reset-required');

      await page.goto('/login');
      await page.getByLabel('Username').fill(REAL_STACK_ACCOUNTS.reset.username);
      await page.getByLabel('Password').fill(REAL_STACK_ACCOUNTS.reset.password);
      await page.getByRole('button', { name: 'Log In' }).click();
      await expect(page.getByLabel('Current password')).toBeVisible();

      await page.getByLabel('Current password').fill('wrong-current');
      await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
      await page.getByLabel('Confirm new password').fill(NEW_PASSWORD);
      await page.getByRole('button', { name: 'Set password' }).click();
      await expect(page.getByTestId('auth-message')).toHaveText(
        'Your current password is not correct.',
      );
      await expect(page).toHaveURL(/\/login\/reset$/);
      // The rejected-current effect clears this field asynchronously after
      // the message commits; wait for that clear before refilling it, or the
      // refill races the effect and gets wiped out.
      await expect(page.getByLabel('Current password')).toHaveValue('');

      // Sign out remains callable while locked.
      await expect(page.getByRole('button', { name: 'Sign out' })).toBeEnabled();

      await page.getByLabel('Current password').fill(REAL_STACK_ACCOUNTS.reset.password);
      await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
      await page.getByLabel('Confirm new password').fill(NEW_PASSWORD);
      await page.getByRole('button', { name: 'Set password' }).click();
      await expect(page).toHaveURL('/');

      // Re-login with the new password proves it persisted server-side.
      await page.evaluate(() => window.location.assign('/login'));
      await page.getByLabel('Username').fill(REAL_STACK_ACCOUNTS.reset.username);
      await page.getByLabel('Password').fill(NEW_PASSWORD);
      await page.getByRole('button', { name: 'Log In' }).click();
      await expect(page).toHaveURL('/');
    },
  );
});
