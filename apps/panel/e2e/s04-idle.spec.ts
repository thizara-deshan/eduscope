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

async function observeRecordingFrame(page: Page): Promise<boolean[]> {
  const seen: boolean[] = [];
  await page.exposeFunction('__s04RecordSeen', (visible: boolean) => seen.push(visible));
  await page.evaluate(() => {
    new MutationObserver(() => {
      const frame = document.querySelector('[data-testid="recording-frame"]');
      (window as unknown as { __s04RecordSeen(value: boolean): void })
        .__s04RecordSeen(frame !== null);
    }).observe(document.body, { childList: true, subtree: true, attributes: true });
  });
  return seen;
}

test.describe('S-04 Dashboard — idle', () => {
  test('primary journey — happy: the confirmed start enters S-05 with recording chrome', async ({ page }) => {
    await signIn(page);

    await expect(page.locator('[data-screen="S-04"]')).toBeVisible();
    await expect(page.getByText(/^Good (morning|afternoon|evening),$/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'A. Perera' })).toBeVisible();
    const start = page.getByRole('button', { name: 'Start Recording' });
    await expect(start).toHaveCount(1);

    await start.click();
    await expect(page.locator('.us-hero__start')).toContainText('Starting');
    await expect(page.locator('.us-hero__start')).toBeDisabled();
    await expect(page.locator('[data-screen="S-05"]')).toBeVisible({
      timeout: TIMERS['T-START-CONFIRM'] + 1_000,
    });
    await expect(page.getByTestId('recording-frame')).toBeVisible();
  });

  test('failure — Class A: the named refusal stays inline and never shows a frame', async ({ page }) => {
    await signIn(page);
    await switchScenario(page, 'start-fails');
    const seenFrame = await observeRecordingFrame(page);
    const start = page.getByRole('button', { name: 'Start Recording' });
    const before = await start.boundingBox();

    await start.click();
    await expect(page.getByRole('alert')).toContainText(
      'The Students Camera is not connected to this device.',
    );
    const after = await page.getByRole('button', { name: 'Start Recording' }).boundingBox();

    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(after?.width).toBe(before?.width);
    expect(after?.height).toBe(before?.height);
    expect(seenFrame, 'a Class A refusal must never read as recording (B-12)').not.toContain(true);
  });

  test('failure — Class B: the second attempt reaches a plain-language error without a frame', async ({ page }) => {
    await signIn(page);
    await switchScenario(page, 'start-fails');
    const seenFrame = await observeRecordingFrame(page);

    await page.getByRole('button', { name: 'Start Recording' }).click();
    await expect(page.getByRole('alert')).toContainText(
      'The Students Camera is not connected to this device.',
    );
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await page.getByRole('button', { name: 'Start Recording' }).click();

    const error = page.getByRole('alert');
    await expect(error).toContainText('Recording did not start', {
      timeout: TIMERS['T-START-CONFIRM'] + 1_000,
    });
    await expect(error.locator('p')).not.toBeEmpty();
    expect(seenFrame, 'a Class B failed start must never read as recording (B-12)').not.toContain(true);
  });

  test('disk-full disables Start with the retention-policy figure from storage.status', async ({ page }) => {
    await signIn(page);
    await switchScenario(page, 'disk-full');

    await expect(page.getByRole('button', { name: 'Start Recording' })).toBeDisabled();
    await expect(page.getByRole('alert')).toContainText('90%');
  });

  test('geometry keeps the Start pill largest and both collapsed bar heads at 54 px', async ({ page }) => {
    await signIn(page);

    const start = await page.getByRole('button', { name: 'Start Recording' }).boundingBox();
    expect(start).not.toBeNull();
    expect(start?.width).toBeGreaterThanOrEqual(300);
    expect(start?.height).toBeGreaterThanOrEqual(96);

    const headHeights = await page.locator('.us-panelbar__head, .us-roombar__head')
      .evaluateAll((heads) => heads.map((head) => head.getBoundingClientRect().height));
    expect(headHeights).toEqual([54, 54]);
    await expect(page.locator('.us-panelbar__head')).toBeInViewport();
    await expect(page.locator('.us-roombar__head')).toBeInViewport();
  });

  test('the idle dashboard never introduces page scroll', async ({ page }) => {
    await signIn(page);
    const dimensions = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
    }));
    expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.viewportHeight);
  });
});

realTest.describe('S-04 Dashboard — idle — real', () => {
  realTest(
    'real: named source and storage refusals create no lecture session or PM consumer',
    { annotation: { type: 'adapter', description: 'real' } },
    async ({ page, realStack }) => {
      realTest.setTimeout(60_000);
      const tokens = await realStack.login('admin');
      const headers = { 'content-type': 'application/json', authorization: `Bearer ${tokens.accessToken}` };

      // Make the required presentation source unavailable through the real typed API.
      const bindingsResponse = await fetch(`${realStack.coreBaseUrl}/sources/bindings`, { headers });
      const { items: bindings } = await bindingsResponse.json() as { items: Array<{ roleId: string; physicalInputId: string | null }> };
      const presentation = bindings.find((binding) => binding.roleId === 'presentation');
      if (!presentation) throw new Error('real stack has no presentation binding');
      await fetch(`${realStack.coreBaseUrl}/sources/bindings/presentation`, {
        method: 'PUT', headers,
        body: JSON.stringify({ physicalInputId: presentation.physicalInputId, enabled: false }),
      });

      await page.goto('/login');
      await page.getByLabel('Username').fill(REAL_STACK_ACCOUNTS.lecturer.username);
      await page.getByLabel('Password').fill(REAL_STACK_ACCOUNTS.lecturer.password);
      await page.getByRole('button', { name: 'Log In' }).click();
      await realExpect(page).toHaveURL('/');
      await page.getByRole('button', { name: 'Start Recording' }).click();
      await realExpect(page.getByRole('alert')).toContainText('A required source role is unbound');
      realExpect(await realStack.recordingAudit()).toEqual({ lectureSessions: 0, recordStarts: 0 });

      await fetch(`${realStack.coreBaseUrl}/sources/bindings/presentation`, {
        method: 'PUT', headers,
        body: JSON.stringify({ physicalInputId: presentation.physicalInputId, enabled: true }),
      });
      await page.getByRole('button', { name: 'Dismiss' }).click();
      await realExpect(page.getByRole('button', { name: 'Start Recording' })).toBeEnabled();
      await realStack.control('core.storage-pressure', { totalBytes: 1_000_000_000, freeBytes: 1 });
      await realExpect(page.getByRole('alert')).toContainText("95% critical threshold");
      await realExpect(page.getByRole('button', { name: 'Start Recording' })).toBeDisabled();
      realExpect(await realStack.recordingAudit()).toEqual({ lectureSessions: 0, recordStarts: 0 });
    },
  );
});
