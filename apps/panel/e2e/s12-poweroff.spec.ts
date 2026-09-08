import { expect, test, type Locator, type Page } from '@playwright/test';
import { TIMERS } from '@eduscope/shared';
import { REAL_STACK_ACCOUNTS, expect as realExpect, test as realTest } from './fixtures/real-stack.js';

const BLOCKED_REASON = 'This device is recording — stop the lecture first.';

const SOURCES_ONLINE = {
  publishers: {
    usb: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
    rtsp: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
    rtsp2: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
    audio: { state: 'online', bound: true, fps: null, rms: 0.4, lastError: null },
  },
  consumers: [],
} as const;

async function routeRealConfig(
  page: Page,
  realStack: { coreBaseUrl: string; quizTlsBaseUrl?: string; quizBaseUrl: string },
) {
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

async function loginReal(page: Page, account: keyof typeof REAL_STACK_ACCOUNTS) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(REAL_STACK_ACCOUNTS[account].username);
  await page.getByLabel('Password').fill(REAL_STACK_ACCOUNTS[account].password);
  await page.getByRole('button', { name: 'Log In' }).click();
}

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Username').fill('a.perera');
  await page.getByLabel('Password').fill('correct-horse');
  await page.getByRole('button', { name: 'Log In' }).click();
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

async function switchScenario(page: Page, name: string) {
  await openScenarioOverlay(page);
  await page.getByRole('radio', { name: new RegExp(`^${name}$`) }).check();
  await page.getByRole('button', { name: /close scenarios/i }).click();
}

async function openPowerOff(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Show controls' }).click();
  await page.getByRole('button', { name: 'Power off' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Power off this device?' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('S-12 Power-off confirm', () => {
  test('accepted shutdown fills the panel and suppresses the expected disconnect marker', async ({ page }) => {
    test.setTimeout(25_000);
    await signIn(page);
    const dialog = await openPowerOff(page);
    await expect(dialog).toContainText('Engineering Auditorium A301');
    await dialog.getByRole('button', { name: 'Power off' }).click();
    const terminal = page.getByRole('alert');
    await expect(terminal).toContainText('Shutting down', { timeout: 3_000 });
    const terminalBox = await terminal.boundingBox();
    const panelBox = await page.getByTestId('us-panel').boundingBox();
    expect(terminalBox).toEqual(panelBox);
    await page.waitForTimeout(TIMERS['T-WS-STALE'] + 500);
    await expect(terminal).toContainText('Shutting down');
    await expect(page.getByText('Not connected — this may be out of date.')).toHaveCount(0);
  });

  test('a recording started behind the confirm replaces destruction with the lecture jump', async ({ page }) => {
    await signIn(page);
    const dialog = await openPowerOff(page);
    await openScenarioOverlay(page);
    await page.getByTestId('e2e-start-recording').click();
    await page.getByRole('button', { name: /close scenarios/i }).click();
    await expect(page.locator('[data-screen="S-05"]')).toBeVisible({ timeout: 3_000 });
    await dialog.getByRole('button', { name: 'Power off' }).click();
    await expect(dialog.getByTestId('danger-message')).toHaveText(BLOCKED_REASON);
    await expect(dialog.getByRole('button', { name: 'Power off' })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Go to the lecture' }).click();
    await expect(page.getByTestId('timer-card')).toBeFocused();
  });

  test('destruction requires expand, entry, and confirm taps', async ({ page }) => {
    await signIn(page);
    await expect(page.getByRole('button', { name: 'Power off' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Show controls' }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: 'Power off' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Power off this device?' });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Power off' }).click();
    await expect(page.getByRole('alert')).toContainText('Shutting down', { timeout: 3_000 });
  });

  test('the room entry is blocked with an inline reason while recording', async ({ page }) => {
    await signIn(page);
    await page.getByRole('button', { name: 'Start Recording' }).click();
    await expect(page.locator('[data-screen="S-05"]')).toBeVisible({ timeout: 3_000 });
    await page.getByRole('button', { name: 'Show controls' }).click();
    const power = page.getByRole('button', { name: 'Power off' });
    await expect(power).toBeDisabled();
    await expect(power).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText(BLOCKED_REASON)).toBeVisible();
    await expect(page.getByRole('alertdialog', { name: 'Power off this device?' })).toHaveCount(0);
  });

  test('poweroff-not-halted traverses refusal, not-halted, retry, and terminal acceptance', async ({ page }) => {
    test.setTimeout(30_000);
    await signIn(page);
    await switchScenario(page, 'poweroff-not-halted');

    let dialog = await openPowerOff(page);
    await dialog.getByRole('button', { name: 'Power off' }).click();
    await expect(dialog.getByTestId('danger-message')).toHaveText(
      'The device could not be reached to shut it down.',
    );
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).click();

    await page.getByRole('button', { name: 'Power off' }).click();
    dialog = page.getByRole('alertdialog', { name: 'Power off this device?' });
    await dialog.getByRole('button', { name: 'Power off' }).click();
    await expect(page.getByText('The device has not shut down yet.')).toBeVisible({ timeout: 11_000 });
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('alert')).toContainText('Shutting down', { timeout: 3_000 });
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  });

  test('an accepted command does not optimistically close its pending dialog', async ({ page }) => {
    await signIn(page);
    const dialog = await openPowerOff(page);
    await dialog.getByRole('button', { name: 'Power off' }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Powering off/ })).toBeDisabled();
  });
});

realTest.describe('S-12 Power-off confirm — real', () => {
  // Runs first so the device is genuinely idle. It drops the socket with
  // `core.ws.drop` (which restarts the same server) rather than a hard stop,
  // leaving the stack alive and session-free for the refusal race below.
  realTest(
    'real: an accepted power-off runs the real privileged helper and stays pending on the 202, with no resolving event',
    { annotation: { type: 'adapter', description: 'real' } },
    async ({ page, realStack }) => {
      realTest.setTimeout(75_000);

      // Scope note (shared with E-03's real witness): this witness deliberately
      // does not tear a genuine real WebSocket away and then read the resulting
      // terminal UI through the browser. A real socket drop leaves the panel
      // trying to reconnect to a now-dead server, and this environment's
      // CDP-driven Chromium renderer stalls the instant that reconnect connect
      // fails — so the `accepted` state update computes but never paints. The
      // "transport closure is success, before the 10 s not-halted ceiling, with
      // no `power.state` event" behaviour for that same real adapter code is
      // covered end-to-end at the unit level against a real fake transport in
      // apps/panel/src/screens/room/use-power-off.test.ts (this task). Here we
      // prove what IS safely drivable live: a real accepted 202 that stays
      // pending (202 is acceptance, not completion) and a real privileged
      // system.poweroff invocation.
      await routeRealConfig(page, realStack);

      await loginReal(page, 'lecturer');
      await realExpect(page.locator('[data-screen="S-04"]')).toBeVisible();

      await page.getByRole('button', { name: 'Show controls' }).click();
      await page.getByRole('button', { name: 'Power off' }).click();
      const dialog = page.getByRole('alertdialog', { name: 'Power off this device?' });
      await realExpect(dialog).toBeVisible();

      const accepted202 = page.waitForResponse(
        (response) => response.url().includes('/device/power-off') && response.request().method() === 'POST',
      );
      await dialog.getByRole('button', { name: 'Power off' }).click();
      // The 202 is acceptance, not completion: the dialog stays pending and
      // never optimistically claims the device shut down.
      await realExpect(dialog.getByRole('button', { name: /Powering off/ })).toBeDisabled();
      realExpect((await accepted202).status()).toBe(202);
      await realExpect(page.getByRole('alert')).toHaveCount(0);

      // The privileged helper genuinely ran system.poweroff exactly once.
      await realExpect
        .poll(async () => (await realStack.ledger()).helper.filter((entry) => entry.verb === 'system.poweroff').length)
        .toBe(1);
    },
  );

  realTest(
    'real: a recording started behind the confirm turns power-off into a server refusal with zero new helper invocation',
    { annotation: { type: 'adapter', description: 'real' } },
    async ({ page, realStack }) => {
      realTest.setTimeout(90_000);
      await routeRealConfig(page, realStack);
      await realStack.control('core.pm.status', { status: SOURCES_ONLINE });

      const helperBefore = (await realStack.ledger()).helper
        .filter((entry) => entry.verb === 'system.poweroff').length;

      await loginReal(page, 'lecturer');
      await realExpect(page.locator('[data-screen="S-04"]')).toBeVisible();

      // Open the confirm while genuinely idle.
      await page.getByRole('button', { name: 'Show controls' }).click();
      await page.getByRole('button', { name: 'Power off' }).click();
      const dialog = page.getByRole('alertdialog', { name: 'Power off this device?' });
      await realExpect(dialog).toBeVisible();

      // A second context opens a real recording behind the still-open confirm.
      const ownerRes = await fetch(`${realStack.coreBaseUrl}/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...REAL_STACK_ACCOUNTS.lecturer, client: 'panel' }),
      });
      const { tokens } = await ownerRes.json() as { tokens: { accessToken: string } };
      const startRes = await fetch(`${realStack.coreBaseUrl}/recording/start`, {
        method: 'POST', headers: { authorization: `Bearer ${tokens.accessToken}` },
      });
      realExpect(startRes.status).toBe(202);
      await realStack.control('core.pm.publish', {
        event: 'evt.pm.consumer.running', data: { consumerId: 'record:00000001', pgid: 7101 },
      });
      await realExpect(page.locator('[data-screen="S-05"]')).toBeVisible({ timeout: 15_000 });

      // Confirm now: the server refuses because a recording is active.
      await dialog.getByRole('button', { name: 'Power off' }).click();
      await realExpect(dialog.getByTestId('danger-message')).toHaveText(BLOCKED_REASON);
      await realExpect(dialog.getByRole('button', { name: 'Power off' })).toHaveCount(0);

      // The recording guard rejected before any privileged verb: the helper
      // was never invoked for this attempt.
      const helperAfter = (await realStack.ledger()).helper
        .filter((entry) => entry.verb === 'system.poweroff').length;
      realExpect(helperAfter).toBe(helperBefore);
    },
  );
});
