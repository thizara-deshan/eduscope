import { expect, test, type Page } from '@playwright/test';
import { expect as realExpect, test as realTest, REAL_STACK_ACCOUNTS } from './fixtures/real-stack.js';

async function signIn(page: Page, username = 'a.perera', password = 'correct-horse') {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
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

/** A seeded alert can visually overlap the selection bar's action button — clear it first (mirrors S-25's dismissAlerts). */
async function dismissAlerts(page: Page) {
  const ack = page.getByRole('button', { name: /^Acknowledge/ });
  if (await ack.isVisible().catch(() => false)) await ack.click();
}

async function selectFirstRowAndOpenExport(page: Page) {
  // The recording library now lives inside the Advanced shell (a dedicated
  // sidebar section), not a header link.
  await page.getByRole('button', { name: 'Show controls' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();
  await expect(page.getByTestId('advanced-shell')).toBeVisible();
  await page.getByRole('button', { name: 'Recording Library' }).click();
  await expect(page.locator('[data-screen="S-21"]')).toBeVisible();
  await dismissAlerts(page);
  await page.getByRole('button', { name: 'Select' }).click();
  await page.locator('.us-reclist__checkbox').first().check();
  await page.getByRole('button', { name: /Copy to USB/ }).click();
  await expect(page.getByRole('dialog', { name: 'Copy to USB' })).toBeVisible();
}

test.describe('S-23 USB export flow', () => {
  test('primary: select, pick a drive, watch real-byte progress to completed, "Safe to remove"', async ({ page }) => {
    test.setTimeout(30_000);
    await signIn(page);
    await selectFirstRowAndOpenExport(page);

    await expect(page.getByText('Choose a drive:')).toBeVisible();
    await page.getByRole('button', { name: /BACKUP-1/ }).click();
    await page.getByRole('button', { name: /Copy .* GB →/ }).click();

    await expect(page.getByText('Copying…')).toBeVisible();
    await expect(page.getByText('Safe to remove the drive.')).toBeVisible({ timeout: 15_000 });
  });

  test('failure: usb-pull — the source is safe, Try again re-copies', async ({ page }) => {
    test.setTimeout(30_000);
    await signIn(page);
    await switchScenario(page, 'usb-pull');
    await selectFirstRowAndOpenExport(page);

    await page.getByRole('button', { name: /BACKUP-1/ }).click();
    await page.getByRole('button', { name: /Copy .* GB →/ }).click();

    await expect(page.getByText(/removed before the copy finished/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/recordings are safe on the device/)).toBeVisible();
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('Copying…')).toBeVisible();
  });
});

interface SeededDetail {
  readonly readyRecordingId: string;
}

function sidOf(accessToken: string): string {
  return (JSON.parse(Buffer.from(accessToken.split('.')[1]!, 'base64url').toString('utf8')) as { sid: string }).sid;
}

// A B-only screen — the real stack needs no Docker/real-D here.
realTest.describe('S-23 USB export — real', () => {
  realTest(
    'real: a capacity shortfall refuses the copy, a real copy completes to "Safe to remove", and a second auth session receives no USB/job events',
    { annotation: { type: 'adapter', description: 'real' } },
    async ({ page, realStack }) => {
      realTest.setTimeout(120_000);
      const seed = await realStack.control<SeededDetail>('core.seed-detail');
      await realStack.control('core.usb.restore'); // known-good starting capacity

      const { username, password } = REAL_STACK_ACCOUNTS.admin;
      await page.goto('/login');
      await page.getByLabel('Username').fill(username);
      await page.getByLabel('Password').fill(password);
      await page.getByRole('button', { name: 'Log In' }).click();
      await realExpect(page).toHaveURL('/');

      await page.getByRole('button', { name: 'Show controls' }).click();
      await page.getByRole('button', { name: 'Advanced' }).click();
      await realExpect(page.getByTestId('advanced-shell')).toBeVisible();
      await page.getByRole('button', { name: 'Recording Library' }).click();
      await realExpect(page.locator('[data-screen="S-21"]')).toBeVisible();

      await page.getByRole('button', { name: 'Select' }).click();
      await page.getByRole('checkbox', { name: 'Select Ready Playback Lecture' }).check();
      await page.getByRole('button', { name: /Copy to USB/ }).click();
      const dialog = page.getByRole('dialog', { name: 'Copy to USB' });
      await realExpect(dialog).toBeVisible();
      await realExpect(page.getByText('Choose a drive:')).toBeVisible();

      // Fill the drive after it was listed: a live usb.volumes over the real WS
      // pushes the modal into the contracted no-room state (CG-21).
      await realStack.control('core.usb.fill', { freeBytes: 100 });
      await realExpect(page.getByText(/None of the connected drives has room/)).toBeVisible({ timeout: 10_000 });

      // Restore capacity and run a genuine copy through to the terminal
      // "Safe to remove" — real bytes land on the USB mount.
      await realStack.control('core.usb.restore');
      await realExpect(page.getByText('Choose a drive:')).toBeVisible({ timeout: 10_000 });
      await dialog.getByRole('button', { name: /E-06 USB/ }).click();
      await dialog.getByRole('button', { name: /^Copy / }).click();
      await realExpect(page.getByText('Safe to remove the drive.')).toBeVisible({ timeout: 20_000 });

      // Session scoping (KEEP B-32): a second auth session that never opened the
      // export flow is not permitted usb.volumes or the creating session's
      // export.job on the real scoped-subscription registry the hub gates on.
      const requester = await realStack.login('admin');
      const bystander = await realStack.login('admin');
      const created = await fetch(`${realStack.coreBaseUrl}/exports`, {
        method: 'POST',
        headers: { authorization: `Bearer ${requester.accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ recordingIds: [seed.readyRecordingId], targetDevicePath: '/dev/e06-usb' }),
      });
      realExpect(created.status).toBe(202);
      const job = await created.json() as { id: string };
      const allows = async (accessToken: string, stream: string, scope?: string): Promise<boolean> =>
        (await realStack.control<{ allows: boolean }>('core.scoped-allows', { authSessionId: sidOf(accessToken), stream, scope })).allows;

      realExpect(await allows(requester.accessToken, 'export.job', job.id)).toBe(true);
      realExpect(await allows(bystander.accessToken, 'export.job', job.id)).toBe(false);
      realExpect(await allows(bystander.accessToken, 'usb.volumes')).toBe(false);
    },
  );
});
