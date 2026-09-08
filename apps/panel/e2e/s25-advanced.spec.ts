import { expect, test, type Page } from '@playwright/test';
import { REAL_STACK_ACCOUNTS, expect as realExpect, test as realTest } from './fixtures/real-stack.js';

const ADMIN_ONLY = [
  { path: '/advanced/network', screen: 'S-28', label: 'Network Settings' },
  { path: '/advanced/encoder', screen: 'S-29', label: 'Encoder Settings' },
  { path: '/advanced/storage', screen: 'S-30', label: 'Local Storage' },
  { path: '/advanced/firmware', screen: 'S-31', label: 'Firmware Update' },
  { path: '/advanced/users', screen: 'S-32', label: 'User Management' },
  { path: '/advanced/logs', screen: 'S-34', label: 'System Logs' },
  { path: '/advanced/uploads', screen: 'S-35', label: 'Upload Queue' },
  { path: '/advanced/device', screen: 'S-36', label: 'Device & Identity' },
] as const;

async function signInAs(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log In' }).click();
  await expect(page).toHaveURL('/');
}

async function signInLecturer(page: Page) {
  await signInAs(page, 'a.perera', 'correct-horse');
}

async function signInAdmin(page: Page) {
  await signInAs(page, 'admin', 'battery-staple');
}

async function goAdvanced(page: Page) {
  await page.getByRole('button', { name: 'Show controls' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();
  await expect(page.getByTestId('advanced-shell')).toBeVisible();
}

/** The seeded firmware.update-available alert visually overlaps S-25's topbar at its default position — clear it so header controls stay reachable. */
async function dismissAlerts(page: Page) {
  const ack = page.getByRole('button', { name: /^Acknowledge/ });
  if (await ack.isVisible().catch(() => false)) await ack.click();
}

test.describe('S-25 Advanced shell', () => {
  test('admin primary journey: 11 nav rows, chooses Streaming, aria-current moves, Back returns to /', async ({ page }) => {
    await signInAdmin(page);
    await goAdvanced(page);
    await dismissAlerts(page);
    const nav = page.getByRole('navigation', { name: 'Administration categories' });
    await expect(nav.getByRole('button')).toHaveCount(11);

    await nav.getByRole('button', { name: 'Streaming Configuration' }).click();
    await expect(nav.getByRole('button', { name: 'Streaming Configuration' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-27');

    await page.getByRole('button', { name: 'Back to Dashboard' }).click();
    await expect(page).toHaveURL('/');
  });

  test('lecturer sees only Local Capture, Streaming and Recording Library', async ({ page }) => {
    await signInLecturer(page);
    await goAdvanced(page);
    const nav = page.getByRole('navigation', { name: 'Administration categories' });
    await expect(nav.getByRole('button')).toHaveCount(3);
    await expect(nav.getByRole('button', { name: 'Local Capture Layout' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Streaming Configuration' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Recording Library' })).toBeVisible();
  });

  test('U-6: a lecturer deep-links to an admin-only route and lands in their own shell, never a 403', async ({ page }) => {
    await signInLecturer(page);
    // A programmatic client-side nav simulates a deep link without a full
    // reload — this app issues no persisted session token to restore across
    // one (token-store.ts), so a real page.goto would just bounce to /login.
    await page.evaluate(() => {
      window.history.pushState({}, '', '/advanced/network');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page).toHaveURL('/advanced/local-capture');
    await expect(page.getByTestId('advanced-shell')).toBeVisible();
    await expect(page.getByText(/403/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Network Settings' })).toHaveCount(0);
  });

  test('live restriction: recording chrome persists in Advanced and no permitted nav item disappears', async ({ page }) => {
    await signInLecturer(page);
    await page.getByRole('button', { name: 'Start Recording' }).click();
    await expect(page.locator('[data-screen="S-05"]')).toBeVisible();
    await page.getByRole('button', { name: 'Show controls' }).click();
    await page.getByRole('button', { name: 'Advanced' }).click();
    await expect(page.getByTestId('advanced-shell')).toBeVisible();
    await expect(page.getByTestId('recording-frame')).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Administration categories' });
    await expect(nav.getByRole('button', { name: 'Local Capture Layout' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Streaming Configuration' })).toBeVisible();
  });

  test('geometry: sidebar does not scroll, every nav row is >=48px, and the page has no scroll', async ({ page }) => {
    await signInAdmin(page);
    await goAdvanced(page);
    const sidebar = page.getByRole('navigation', { name: 'Administration categories' });
    const overflow = await sidebar.evaluate((el) => getComputedStyle(el).overflow);
    expect(overflow === 'visible' || overflow === 'hidden').toBe(true);
    expect(await sidebar.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(0);

    for (const row of await sidebar.getByRole('button').all()) {
      const box = await row.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(48);
    }

    const panelOverflow = await page.evaluate(() => {
      const panel = document.querySelector('.us-panel') as HTMLElement;
      return panel.scrollHeight - panel.clientHeight;
    });
    // Sub-pixel layout rounding, not a real overflow — see the sub-1px budget elsewhere in this suite.
    expect(panelOverflow).toBeLessThanOrEqual(1);
  });
});

async function realSignIn(page: Page, account: keyof typeof REAL_STACK_ACCOUNTS) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(REAL_STACK_ACCOUNTS[account].username);
  await page.getByLabel('Password').fill(REAL_STACK_ACCOUNTS[account].password);
  await page.getByRole('button', { name: 'Log In' }).click();
  await realExpect(page).toHaveURL('/');
}

async function realGoAdvanced(page: Page) {
  await page.getByRole('button', { name: 'Show controls' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();
  await realExpect(page.getByTestId('advanced-shell')).toBeVisible();
}

async function routeRealConfig(page: Page, realStack: { coreBaseUrl: string; quizTlsBaseUrl?: string; quizBaseUrl: string }) {
  await page.route('**/config.json', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        apiBaseUrl: realStack.coreBaseUrl,
        quizBaseUrl: realStack.quizTlsBaseUrl ?? realStack.quizBaseUrl,
        environment: 'integration',
        adapters: { default: 'real', overrides: {} },
      }),
    });
  });
}

realTest.describe('S-25 Advanced shell — real', () => {
  realTest(
    'real: a lecturer deep-linking to every admin child is redirected to their own shell, and the server discloses no admin data',
    { annotation: { type: 'adapter', description: 'real' } },
    async ({ page, realStack }) => {
      realTest.setTimeout(75_000);
      await routeRealConfig(page, realStack);

      // Track every response the browser rendered so we can prove no admin
      // list body was ever fetched into the lecturer's session.
      // Strictly admin-only list endpoints (services/core-api: users,
      // settings/network, settings/encoder all `x-required-role: admin`).
      // storage/firmware/health are lecturer-readable and excluded.
      const adminResponses: string[] = [];
      page.on('response', (response) => {
        if (/\/(users|settings\/network|settings\/encoder)(\?|$)/.test(new URL(response.url()).pathname)
          && response.request().method() === 'GET' && response.status() < 400) {
          adminResponses.push(response.url());
        }
      });

      await realSignIn(page, 'lecturer');
      await realGoAdvanced(page);

      for (const route of ADMIN_ONLY) {
        await page.evaluate((path) => {
          window.history.pushState({}, '', path);
          window.dispatchEvent(new PopStateEvent('popstate'));
        }, route.path);
        // UI authority: the role guard bounces to the lecturer's own default
        // category and never renders the admin screen or a raw 403.
        await realExpect(page).toHaveURL('/advanced/local-capture');
        await realExpect(page.getByTestId('advanced-shell')).toBeVisible();
        await realExpect(page.getByText(/403/)).toHaveCount(0);
        await realExpect(page.getByRole('button', { name: route.label })).toHaveCount(0);
        await realExpect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-26');
      }

      // Server authority: a direct admin call with the lecturer's own token is
      // refused, and the denial body carries no admin rows.
      const login = await fetch(`${realStack.coreBaseUrl}/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...REAL_STACK_ACCOUNTS.lecturer, client: 'panel' }),
      });
      const { tokens } = await login.json() as { tokens: { accessToken: string } };
      for (const path of ['/users', '/settings/network', '/settings/encoder']) {
        const denied = await fetch(`${realStack.coreBaseUrl}${path}`, {
          headers: { authorization: `Bearer ${tokens.accessToken}` },
        });
        realExpect(denied.status, `${path} must be admin-only`).toBe(403);
        const body = await denied.text();
        realExpect(body).not.toContain('e06-admin');
        realExpect(body).not.toContain('"items"');
      }

      // No admin-domain GET ever succeeded inside the lecturer's browser.
      realExpect(adminResponses, 'no admin list was fetched into the lecturer session').toEqual([]);
    },
  );

  realTest(
    'real: an admin reaches every advanced category at 1280×800 with ≥44px nav targets',
    { annotation: { type: 'adapter', description: 'real' } },
    async ({ page, realStack }) => {
      realTest.setTimeout(75_000);
      await page.setViewportSize({ width: 1280, height: 800 });
      await routeRealConfig(page, realStack);

      await realSignIn(page, 'admin');
      await realGoAdvanced(page);
      const nav = page.getByRole('navigation', { name: 'Administration categories' });
      await realExpect(nav.getByRole('button')).toHaveCount(11);

      for (const route of ADMIN_ONLY) {
        const button = nav.getByRole('button', { name: route.label });
        const box = await button.boundingBox();
        realExpect(box!.height, `${route.label} target height`).toBeGreaterThanOrEqual(44);
        await button.click();
        await realExpect(button).toHaveAttribute('aria-current', 'page');
        await realExpect(page.getByTestId('screen')).toHaveAttribute('data-screen', route.screen);
      }

      await page.getByRole('button', { name: 'Back to Dashboard' }).click();
      await realExpect(page).toHaveURL('/');
    },
  );
});
