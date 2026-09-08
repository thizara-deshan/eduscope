import { expect, test, type Page } from '@playwright/test';
import { TIMERS } from '@eduscope/shared';
import { REAL_STACK_ACCOUNTS, expect as realExpect, test as realTest } from './fixtures/real-stack.js';

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
  await expect(page.getByTestId('active-scenario')).toHaveText(name);
  await page.getByRole('button', { name: /close scenarios/i }).click();
}

async function startRecording(page: Page) {
  await page.getByRole('button', { name: 'Start Recording' }).click();
  await expect(page.getByTestId('timer-card')).toBeVisible({
    timeout: TIMERS['T-START-CONFIRM'] + 1_000,
  });
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
}

function durationMs(text: string | null): number {
  const parts = text?.match(/^(\d{2}):(\d{2}):(\d{2})$/);
  if (!parts) throw new Error(`not a transport duration: ${String(text)}`);
  return (+parts[1]! * 3_600 + +parts[2]! * 60 + +parts[3]!) * 1_000;
}

test.describe('S-07 Session transport card', () => {
  test('primary journey — ticks, freezes, resumes and saves', async ({ page }) => {
    await signIn(page);
    await startRecording(page);
    const digits = page.getByLabel('Recording duration');

    const first = await digits.textContent();
    await expect(digits).not.toHaveText(first ?? '', { timeout: 3_000 });

    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByText('Recording paused')).toBeVisible();
    const frozen = await digits.textContent();
    await page.waitForTimeout(2_000);
    expect(await digits.textContent()).toBe(frozen);

    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled({ timeout: 2_000 });
    const resumed = await digits.textContent();
    await expect(digits).not.toHaveText(resumed ?? '', { timeout: 3_000 });

    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByTestId('timer-card').getByText('Saving…')).toBeVisible();
    const actions = page.locator('.us-timercard__actions button');
    await expect(actions).toHaveCount(2);
    for (const button of await actions.all()) await expect(button).toBeDisabled();
    await expect(page.getByTestId('recording-saved')).toBeVisible({ timeout: 4_000 });
  });

  test('pipeline crash leaves a seam marker and the elapsed figure keeps advancing', async ({ page }) => {
    test.setTimeout(50_000);
    await signIn(page);
    await switchScenario(page, 'pipeline-crash-midway');
    await startRecording(page);

    const seam = page.getByText(/continued after a brief interruption/i);
    await expect(seam).toBeVisible({ timeout: 43_000 });
    const digits = page.getByLabel('Recording duration');
    const before = await digits.textContent();
    await page.waitForTimeout(1_100);
    expect(await digits.textContent()).not.toBe(before);
    await expect(page.getByTestId('recording-frame')).toBeVisible();
  });

  test('the resumed figure excludes a pause of at least three seconds', async ({ page }) => {
    await signIn(page);
    await startRecording(page);
    const digits = page.getByLabel('Recording duration');
    const displayedAtStart = durationMs(await digits.textContent());
    const wallStartedAt = Date.now();

    await page.waitForTimeout(1_100);
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByText('Recording paused')).toBeVisible();
    await page.waitForTimeout(3_100);
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled({ timeout: 2_000 });
    await page.waitForTimeout(1_100);

    const displayedDelta = durationMs(await digits.textContent()) - displayedAtStart;
    const wallDelta = Date.now() - wallStartedAt;
    expect(wallDelta - displayedDelta).toBeGreaterThanOrEqual(3_000);
  });

  test('Stop is one tap with no intermediate alertdialog', async ({ page }) => {
    await signIn(page);
    await startRecording(page);
    await page.evaluate(() => {
      (window as unknown as { __s07SawAlertdialog: boolean }).__s07SawAlertdialog = false;
      new MutationObserver(() => {
        if (document.querySelector('[role="alertdialog"]')) {
          (window as unknown as { __s07SawAlertdialog: boolean }).__s07SawAlertdialog = true;
        }
      }).observe(document.body, { childList: true, subtree: true });
    });

    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByTestId('recording-saved')).toBeVisible({ timeout: 4_000 });
    expect(await page.evaluate(
      () => (window as unknown as { __s07SawAlertdialog: boolean }).__s07SawAlertdialog,
    )).toBe(false);
  });

  test('U-2 disables transport while stale and never replays an offline Stop', async ({ page }) => {
    test.setTimeout(45_000);
    await signIn(page);
    await switchScenario(page, 'ws-flap');
    await startRecording(page);

    const card = page.getByTestId('timer-card');
    await expect(card).toHaveAttribute('data-stale', 'true', { timeout: 30_000 });
    const pause = page.getByRole('button', { name: 'Pause' });
    const stop = page.getByRole('button', { name: 'Stop' });
    await expect(pause).toBeDisabled();
    await expect(stop).toBeDisabled();
    await stop.dispatchEvent('click');

    await expect(card).not.toHaveAttribute('data-stale', 'true', { timeout: 5_000 });
    await page.waitForTimeout(3_000);
    await expect(card).toBeVisible();
    await expect(page.getByTestId('recording-notch')).toContainText('RECORDING');
    await expect(page.getByRole('button', { name: 'Stop' })).toBeEnabled();
  });
});

realTest.describe('S-07 Session transport card — real', () => {
  realTest(
    'real: pause/stop EOS deadlines resolve from server events and paused reload retains duration',
    { annotation: { type: 'adapter', description: 'real' } },
    async ({ page, realStack }) => {
      realTest.setTimeout(75_000);
      await page.goto('/login');
      await page.getByLabel('Username').fill(REAL_STACK_ACCOUNTS.lecturer.username);
      await page.getByLabel('Password').fill(REAL_STACK_ACCOUNTS.lecturer.password);
      await page.getByRole('button', { name: 'Log In' }).click();
      await realExpect(page).toHaveURL('/');
      await page.getByRole('button', { name: 'Start Recording' }).click();
      await realExpect.poll(async () => (await realStack.processAudit()).recordStarts).toBe(1);
      await realStack.control('core.pm.publish', {
        event: 'evt.pm.consumer.running', data: { consumerId: 'record:00000001', pgid: 6101 },
      });
      await realExpect(page.getByTestId('timer-card')).toBeVisible();

      await page.getByRole('button', { name: 'Pause' }).click();
      await realExpect(page.getByRole('button', { name: 'Pausing…' })).toBeDisabled();
      await realExpect(page.getByText('Recording paused')).toBeVisible({ timeout: TIMERS['T-CMD-RESOLVE'] });
      await realExpect(page.getByRole('alert')).toContainText('ended unexpectedly');
      const pausedDuration = await page.getByLabel('Recording duration').textContent();
      await page.reload();
      await realExpect(page).toHaveURL(/\/login$/);
      await page.getByLabel('Username').fill(REAL_STACK_ACCOUNTS.lecturer.username);
      await page.getByLabel('Password').fill(REAL_STACK_ACCOUNTS.lecturer.password);
      await page.getByRole('button', { name: 'Log In' }).click();
      await realExpect(page.getByText('Recording paused')).toBeVisible();
      await realExpect(page.getByLabel('Recording duration')).toHaveText(pausedDuration ?? '');

      await page.getByRole('button', { name: 'Resume' }).click();
      await realExpect.poll(async () => (await realStack.processAudit()).recordStarts).toBe(2);
      await realStack.control('core.pm.publish', {
        event: 'evt.pm.consumer.running', data: { consumerId: 'record:00000002', pgid: 6102 },
      });
      await realExpect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
      await page.evaluate(() => {
        (window as unknown as { __s07SawStopPending: boolean }).__s07SawStopPending = false;
        new MutationObserver(() => {
          if ([...document.querySelectorAll('button')].some((button) => button.textContent?.includes('Stopping'))) {
            (window as unknown as { __s07SawStopPending: boolean }).__s07SawStopPending = true;
          }
        }).observe(document.body, { childList: true, subtree: true, characterData: true });
      });
      await page.getByRole('button', { name: 'Stop' }).click();
      await realExpect.poll(() => page.evaluate(
        () => (window as unknown as { __s07SawStopPending: boolean }).__s07SawStopPending,
      )).toBe(true);
      await realExpect(page.locator('[data-screen="S-04"]')).toBeVisible({ timeout: TIMERS['T-CMD-RESOLVE'] });
      const audit = await realStack.control<{ segments: Array<{ state: string; endReason: string }> }>('core.transport-audit');
      realExpect(audit.segments).toHaveLength(2);
      realExpect(audit.segments).toEqual(expect.arrayContaining([
        expect.objectContaining({ state: 'truncated', endReason: 'pause' }),
        expect.objectContaining({ state: 'truncated', endReason: 'stop' }),
      ]));
    },
  );
});
