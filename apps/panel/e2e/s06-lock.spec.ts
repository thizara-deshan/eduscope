import { expect, test, type Page } from '@playwright/test';
import { REAL_STACK_ACCOUNTS, expect as realExpect, test as realTest } from './fixtures/real-stack.js';

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log In' }).click();
  if (username === 'n.silva') {
    await expect(page).toHaveURL(/\/login\/reset$/);
    await page.getByLabel('Current password').fill(password);
    await page.getByLabel('New password', { exact: true }).fill('New-lecturer-9');
    await page.getByLabel('Confirm new password').fill('New-lecturer-9');
    await page.getByRole('button', { name: 'Set password' }).click();
  }
  await expect(page).toHaveURL('/');
}

async function openScenarioOverlay(page: Page) {
  const hotspot = page.getByTestId('scenario-hotspot');
  const box = await hotspot.boundingBox();
  if (!box) throw new Error('scenario hotspot has no box — is the mock client active?');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(2_200);
  await page.mouse.up();
  await expect(page.getByRole('dialog', { name: /scenario/i })).toBeVisible();
}

async function seedLockedRecording(page: Page) {
  await openScenarioOverlay(page);
  const control = page.getByRole('checkbox', { name: 'Recorder owned by another user' });
  if (!(await control.isChecked())) await control.check();
  await page.getByRole('button', { name: /close scenarios/i }).click();
  await expect(page.locator('[data-screen="S-06"]')).toBeVisible();
}

async function openTakeover(page: Page) {
  await page.getByRole('button', { name: 'Take over' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Take over this recording?' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('S-06 Recorder lock and takeover', () => {
  test('primary journey — admin takes over and retains prior-owner attribution', async ({ page }) => {
    await signIn(page, 'admin', 'battery-staple');
    await seedLockedRecording(page);
    const card = page.getByTestId('lock-card');
    await expect(card).toContainText('A. Perera');
    await expect(card).toContainText('CS2043 — Lecture 7');
    const elapsed = page.getByTestId('lock-elapsed');
    const first = await elapsed.textContent();
    await page.waitForTimeout(1_100);
    expect(await elapsed.textContent()).not.toBe(first);

    const dialog = await openTakeover(page);
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await Promise.all([
      expect(dialog.getByRole('button', { name: /Taking over/ })).toBeDisabled(),
      dialog.getByRole('button', { name: 'Take over' }).click(),
    ]);
    await expect(page.locator('[data-screen="S-05"]')).toBeVisible();
    await expect(page.getByTestId('takeover-notice')).toContainText(
      'You took over this recording from A. Perera',
    );
  });

  test('takeover refused after the lecture ends replaces the destructive action with Close', async ({ page }) => {
    await signIn(page, 'admin', 'battery-staple');
    await seedLockedRecording(page);
    const dialog = await openTakeover(page);

    await openScenarioOverlay(page);
    await page.getByTestId('dev-stop').click();
    await page.getByRole('button', { name: /close scenarios/i }).click();
    await expect(page.locator('[data-recording-state]')).toHaveAttribute('data-recording-state', 'completed', {
      timeout: 4_000,
    });
    await dialog.getByRole('button', { name: 'Take over' }).click();
    await expect(dialog.getByTestId('danger-message')).toHaveText('That lecture has already ended.');
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Take over' })).toHaveCount(0);
  });

  test('one R-21 state renders the new-owner and displaced-owner sides sequentially', async ({ page }) => {
    await signIn(page, 'admin', 'battery-staple');
    await seedLockedRecording(page);
    const dialog = await openTakeover(page);
    await dialog.getByRole('button', { name: 'Take over' }).click();
    await expect(page.getByTestId('takeover-notice')).toContainText(
      'You took over this recording from A. Perera',
    );

    await page.getByRole('button', { name: /Device Administrator/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL('/login');
    await page.getByLabel('Username').fill('a.perera');
    await page.getByLabel('Password').fill('correct-horse');
    await page.getByRole('button', { name: 'Log In' }).click();

    await expect(page.locator('[data-screen="S-06"]')).toBeVisible();
    await expect(page.getByTestId('lock-card')).toBeVisible();
    await expect(page.getByTestId('takeover-notice')).toContainText(
      'An administrator took over this recording.',
    );
    await expect(page.getByTestId('takeover-notice')).toContainText('Device Administrator took over');
  });

  test('a lecturer sees no action inside the lock card', async ({ page }) => {
    await signIn(page, 'n.silva', 'temp-pass-1');
    await seedLockedRecording(page);
    const card = page.getByTestId('lock-card');
    await expect(card).toContainText('Only A. Perera or an administrator can stop this recording.');
    await expect(card.getByRole('button')).toHaveCount(0);
  });

  test('the confirmation keeps 24px danger separation and the destructive action last', async ({ page }) => {
    await signIn(page, 'admin', 'battery-staple');
    await seedLockedRecording(page);
    const dialog = await openTakeover(page);
    const footer = dialog.locator('.us-dangerconfirm__footer');
    expect(await footer.evaluate((node) => getComputedStyle(node).gap)).toBe('24px');
    const focusableLabels = await dialog.locator('button:not([disabled])').allTextContents();
    expect(focusableLabels.at(-1)?.trim()).toBe('Take over');
  });

  test('recording chrome remains visible on the non-owner lock view', async ({ page }) => {
    await signIn(page, 'admin', 'battery-staple');
    await seedLockedRecording(page);
    await expect(page.getByTestId('recording-frame')).toBeVisible();
    await expect(page.getByTestId('recording-notch')).toContainText('RECORDING');
  });
});

realTest.describe('S-06 Recorder lock and takeover — real', () => {
  realTest(
    'real: lecturer/admin takeover race preserves one owner and revokes the displaced owner',
    { annotation: { type: 'adapter', description: 'real' } },
    async ({ browser, realStack }) => {
      realTest.setTimeout(60_000);
      const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
      const [ownerPage, otherPage, adminPage] = await Promise.all(contexts.map(async (context) => {
        await context.route('**/config.json', (route) => route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({
            apiBaseUrl: realStack.coreBaseUrl, quizBaseUrl: realStack.quizTlsBaseUrl,
            environment: 'integration', adapters: { default: 'real', overrides: {} },
          }),
        }));
        return context.newPage();
      }));
      const loginUi = async (page: Page, account: typeof REAL_STACK_ACCOUNTS[keyof typeof REAL_STACK_ACCOUNTS]) => {
        await page.goto('http://127.0.0.1:4173/login');
        await page.getByLabel('Username').fill(account.username);
        await page.getByLabel('Password').fill(account.password);
        await page.getByRole('button', { name: 'Log In' }).click();
        await realExpect(page).toHaveURL('http://127.0.0.1:4173/');
      };
      await loginUi(ownerPage, REAL_STACK_ACCOUNTS.lecturer);
      await ownerPage.getByRole('button', { name: 'Start Recording' }).click();
      await realExpect.poll(async () => (await realStack.processAudit()).recordStarts).toBe(1);
      await realStack.control('core.pm.publish', {
        event: 'evt.pm.consumer.running', data: { consumerId: 'record:00000001', pgid: 5101 },
      });
      await realExpect(ownerPage.locator('[data-screen="S-05"]')).toBeVisible();

      await Promise.all([
        loginUi(otherPage, REAL_STACK_ACCOUNTS.other),
        loginUi(adminPage, REAL_STACK_ACCOUNTS.admin),
      ]);
      await realExpect(otherPage.locator('[data-screen="S-06"]')).toBeVisible();
      await realExpect(adminPage.locator('[data-screen="S-06"]')).toBeVisible();
      await realExpect(otherPage.getByTestId('lock-card').getByRole('button')).toHaveCount(0);
      await realExpect(adminPage.getByRole('button', { name: 'Take over' })).toBeVisible();

      const [otherTokens, adminTokens, ownerTokens] = await Promise.all([
        realStack.login('other'), realStack.login('admin'), realStack.login('lecturer'),
      ]);
      const takeover = (accessToken: string) => fetch(`${realStack.coreBaseUrl}/recording/takeover`, {
        method: 'POST', headers: { authorization: `Bearer ${accessToken}` },
      });
      const [lecturerResponse, adminResponse] = await Promise.all([
        takeover(otherTokens.accessToken), takeover(adminTokens.accessToken),
      ]);
      realExpect(lecturerResponse.status).toBe(403);
      realExpect((await lecturerResponse.json() as { code: string }).code).toBe('not-authorized');
      realExpect(adminResponse.status).toBe(202);
      await realExpect(adminPage.getByTestId('takeover-notice')).toContainText('You took over this recording');

      const ownerCheck = await fetch(`${realStack.coreBaseUrl}/auth/me`, {
        headers: { authorization: `Bearer ${ownerTokens.accessToken}` },
      });
      realExpect(ownerCheck.status).toBe(401);
      realExpect(await ownerCheck.json()).toMatchObject({ code: 'auth.session-revoked', meta: { reason: 'takeover' } });
      const audit = await realStack.control<{ sessions: Array<Record<string, unknown>> }>('core.takeover-audit');
      realExpect(audit.sessions).toHaveLength(1);
      realExpect(audit.sessions[0]).toMatchObject({ state: 'recording' });
      realExpect(audit.sessions[0]?.ownerUserId).not.toBe(audit.sessions[0]?.takeoverBy);
      realExpect(audit.sessions[0]?.takeoverAt).toBeTruthy();
      await Promise.all(contexts.map((context) => context.close()));
    },
  );
});
