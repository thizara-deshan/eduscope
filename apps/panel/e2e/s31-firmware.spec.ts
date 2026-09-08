import { expect, test, type Page } from '@playwright/test';
import { REAL_STACK_ACCOUNTS, expect as realExpect, test as realTest } from './fixtures/real-stack.js';

async function signIn(page: Page, username = 'admin', password = 'battery-staple') {
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

async function setFirmwareOutcome(page: Page, label: string) {
  await openScenarioOverlay(page);
  await page.getByLabel(label).check();
  await page.getByRole('button', { name: /close scenarios/i }).click();
}

async function dismissAlerts(page: Page) {
  const ack = page.getByRole('button', { name: /^Acknowledge/ });
  if (await ack.isVisible().catch(() => false)) await ack.click();
}

async function goToFirmware(page: Page) {
  await page.getByRole('button', { name: 'Show controls' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();
  await expect(page.getByTestId('advanced-shell')).toBeVisible();
  await dismissAlerts(page);
  await page.getByRole('button', { name: /Firmware Update/ }).click();
  await expect(page.locator('[data-screen="S-31"]')).toBeVisible();
}

test.describe('S-31 Firmware Update', () => {
  test('primary: update-available -> Apply steps through to done, unmissable reboot message', async ({ page }) => {
    test.setTimeout(20_000);
    await signIn(page);
    // firmwareOutcome:'update-available' is the mock's default world seed.
    await goToFirmware(page);

    await expect(page.getByTestId('firmware-up-to-date')).toBeVisible();
    await page.getByRole('button', { name: 'Check for updates' }).click();
    await expect(page.getByTestId('firmware-update-available')).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Apply update' }).click();
    await expect(page.getByTestId('firmware-done')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/reboot is required/)).toBeVisible();
  });

  test('failure: signature-fail is a loud, distinct state', async ({ page }) => {
    test.setTimeout(20_000);
    await signIn(page);
    await setFirmwareOutcome(page, 'Firmware outcome: signature-fail');
    await goToFirmware(page);

    await page.getByRole('button', { name: 'Check for updates' }).click();
    await expect(page.getByTestId('firmware-update-available')).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Apply update' }).click();
    await expect(page.getByTestId('firmware-signature-failed')).toBeVisible({ timeout: 10_000 });
  });
});

interface FirmwareRow {
  readonly state: string;
  readonly currentVersion: string;
  readonly availableVersion: string | null;
  readonly signatureVerified: boolean;
  readonly rollbackVersion: string | null;
  readonly lastError: string | null;
}

realTest.describe.configure({ mode: 'serial' });
realTest.describe('S-31 Firmware Update — real', () => {
  realTest(
    'real: an unverified update refuses apply without ever calling the helper, a bad signature at apply time fails loudly, a verified apply completes, and a failed boot rolls back and survives a restart',
    { annotation: { type: 'adapter', description: 'real' } },
    async ({ page, realStack }) => {
      realTest.setTimeout(90_000);
      await realStack.control('core.start');

      const base = realStack.coreBaseUrl;
      const login = await fetch(`${base}/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...REAL_STACK_ACCOUNTS.admin, client: 'panel' }),
      });
      const { tokens } = await login.json() as { tokens: { accessToken: string } };
      const auth = { authorization: `Bearer ${tokens.accessToken}` };

      const readFirmware = async (): Promise<FirmwareRow> => (await (await fetch(`${base}/firmware`, { headers: auth })).json()) as FirmwareRow;

      const initial = await readFirmware();
      realExpect(initial).toMatchObject({ state: 'idle', currentVersion: '0.1.0', availableVersion: null });

      // --- A check that finds an update but fails signature verification never lets apply reach the helper ---
      await realStack.control('core.firmware', { checkDetail: { availableVersion: '2.0.0', artifactDigest: 'sha256:e38-unverified', signatureVerified: false } });
      const check1 = await fetch(`${base}/firmware/check`, { method: 'POST', headers: auth });
      realExpect(check1.status).toBe(202);
      await realExpect.poll(async () => (await readFirmware()).availableVersion, { timeout: 10_000 }).toBe('2.0.0');
      realExpect((await readFirmware())).toMatchObject({ state: 'idle', signatureVerified: false });

      const ledgerBeforeApply = (await realStack.ledger()).helper as Array<{ verb: string }>;
      const refusedApply = await fetch(`${base}/firmware/apply`, { method: 'POST', headers: auth });
      realExpect(refusedApply.status).toBe(409);
      const ledgerAfterRefusal = (await realStack.ledger()).helper as Array<{ verb: string }>;
      realExpect(ledgerAfterRefusal.filter((c) => c.verb === 'firmware.apply').length,
        'a refused apply never reaches the allowlisted helper verb').toBe(ledgerBeforeApply.filter((c) => c.verb === 'firmware.apply').length);

      // --- A verified check, then a bad-signature outcome AT apply time fails loudly (never inferred from a dropped connection) ---
      await realStack.control('core.firmware', { checkDetail: { availableVersion: '2.0.0', artifactDigest: 'sha256:e38-verified', signatureVerified: true } });
      await fetch(`${base}/firmware/check`, { method: 'POST', headers: auth });
      await realExpect.poll(async () => (await readFirmware()).signatureVerified, { timeout: 10_000 }).toBe(true);

      await realStack.control('core.firmware', { applyDetail: { outcome: 'bad-signature' } });
      const badSigApply = await fetch(`${base}/firmware/apply`, { method: 'POST', headers: auth });
      realExpect(badSigApply.status).toBe(202);
      await realExpect.poll(async () => (await readFirmware()).state, { timeout: 10_000 }).toBe('failed');
      realExpect((await readFirmware()).lastError).toBe('signature verification failed');

      // --- Retrying apply with a real 'done' outcome completes and adopts the new version ---
      await realStack.control('core.firmware', { applyDetail: { outcome: 'done' } });
      const doneApply = await fetch(`${base}/firmware/apply`, { method: 'POST', headers: auth });
      realExpect(doneApply.status).toBe(202);
      await realExpect.poll(async () => (await readFirmware()).state, { timeout: 10_000 }).toBe('done');
      realExpect(await readFirmware()).toMatchObject({ currentVersion: '2.0.0', availableVersion: null });

      // --- A staged apply that fails to boot rolls back — driven entirely by the helper's own response, never a dropped connection ---
      await realStack.control('core.firmware', { checkDetail: { availableVersion: '3.0.0', artifactDigest: 'sha256:e38-v3', signatureVerified: true } });
      await fetch(`${base}/firmware/check`, { method: 'POST', headers: auth });
      await realExpect.poll(async () => (await readFirmware()).availableVersion, { timeout: 10_000 }).toBe('3.0.0');

      await realStack.control('core.firmware', { applyDetail: { outcome: 'boot-failed', rollbackVersion: '2.0.0' } });
      const rollbackApply = await fetch(`${base}/firmware/apply`, { method: 'POST', headers: auth });
      realExpect(rollbackApply.status).toBe(202);
      await realExpect.poll(async () => (await readFirmware()).state, { timeout: 10_000 }).toBe('rolled-back');
      realExpect(await readFirmware()).toMatchObject({ state: 'rolled-back', rollbackVersion: '2.0.0', currentVersion: '2.0.0' });

      // --- The rolled-back snapshot is durable: it survives a real service restart/reconnect ---
      await realStack.control('core.restart');
      realExpect(await readFirmware()).toMatchObject({ state: 'rolled-back', rollbackVersion: '2.0.0', currentVersion: '2.0.0' });

      // --- The screen renders the real, persisted rollback state ---
      await page.goto('/login');
      await page.getByLabel('Username').fill(REAL_STACK_ACCOUNTS.admin.username);
      await page.getByLabel('Password').fill(REAL_STACK_ACCOUNTS.admin.password);
      await page.getByRole('button', { name: 'Log In' }).click();
      await realExpect(page).toHaveURL('/');
      await page.getByRole('button', { name: 'Show controls' }).click();
      await page.getByRole('button', { name: 'Advanced' }).click();
      const ack = page.getByRole('button', { name: /^Acknowledge/ });
      if (await ack.isVisible().catch(() => false)) await ack.click();
      await page.getByRole('button', { name: /Firmware Update/ }).click();
      await realExpect(page.locator('[data-screen="S-31"]')).toBeVisible();
      await realExpect(page.getByTestId('firmware-rolled-back')).toContainText('Rolled back to 2.0.0');
    },
  );
});
