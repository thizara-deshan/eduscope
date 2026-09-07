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

async function switchScenario(page: Page, name: string) {
  await openScenarioOverlay(page);
  await page.getByRole('radio', { name: new RegExp(`^${name}$`) }).check();
  await page.getByRole('button', { name: /close scenarios/i }).click();
}

async function dismissAlerts(page: Page) {
  const ack = page.getByRole('button', { name: /^Acknowledge/ });
  if (await ack.isVisible().catch(() => false)) await ack.click();
}

async function goToDevice(page: Page) {
  await page.getByRole('button', { name: 'Show controls' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();
  await expect(page.getByTestId('advanced-shell')).toBeVisible();
  await page.getByRole('button', { name: /Device & Identity/ }).click();
  await expect(page.locator('[data-screen="S-36"]')).toBeVisible();
}

test.describe('S-36 Device & Identity', () => {
  test('primary: Provisioned chip, copy id, legible features, alerts; acknowledge stays labelled active', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await signIn(page);
    await goToDevice(page);

    await expect(page.getByTestId('provisioned-chip')).toHaveText('Provisioned');
    await page.getByRole('button', { name: 'Copy device ID' }).click();
    await expect(page.getByText(/Copied device ID/)).toBeVisible();

    await expect(page.getByText('On').first()).toBeVisible();

    const alerts = page.getByRole('region', { name: 'Active alerts' });
    const ackButton = alerts.getByRole('button', { name: 'Acknowledge' }).first();
    await ackButton.scrollIntoViewIfNeeded();
    await ackButton.click();
    await expect(alerts.getByText('✓ acknowledged · still active').first()).toBeVisible({ timeout: 5_000 });
  });

  test('failure: capture-fault drives present -> absent -> recovering -> failed, never a dead device', async ({ page }) => {
    test.setTimeout(20_000);
    await signIn(page);
    await switchScenario(page, 'capture-fault');
    await goToDevice(page);
    await dismissAlerts(page);

    await expect(page.getByText('Failed — needs a person. Camera-only recording still works.')).toBeVisible({ timeout: 15_000 });
  });
});

interface SystemAlertRow {
  readonly id: string;
  readonly raisedAt: string;
  readonly clearedAt: string | null;
  readonly acknowledgedBy: string | null;
}

const SOURCES_ONLINE_NO_CAPTURE = {
  device: { captureCardState: 'present', led: 'off' },
  publishers: {
    usb: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
    rtsp: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
    rtsp2: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
    audio: { state: 'online', bound: true, fps: null, rms: 0.4, lastError: null },
  },
  consumers: [],
} as const;

async function goToDeviceReal(page: Page) {
  await page.getByRole('button', { name: 'Show controls' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();
  await realExpect(page.getByTestId('advanced-shell')).toBeVisible();
  await page.getByRole('button', { name: /Device & Identity/ }).click();
  await realExpect(page.locator('[data-screen="S-36"]')).toBeVisible();
}

realTest.describe('S-36 Device & Identity — real', () => {
  realTest(
    'real: the identity UUID is display-only, health goes stale without telemetry, the capture card mirrors real PM state through failed, and acknowledge never clears — only a real clear/raise cycle produces a fresh occurrence',
    { annotation: { type: 'adapter', description: 'real' } },
    async ({ page, context, realStack }) => {
      realTest.setTimeout(90_000);
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await realStack.control('core.start');
      const base = realStack.coreBaseUrl;
      const auth = { authorization: `Bearer ${(await realStack.login('admin')).accessToken}` };

      const provisioning = await (await fetch(`${base}/provisioning`, { headers: auth })).json() as { deviceId: string; expectedStorageVolumeUuid: string };

      await page.goto('/login');
      await page.getByLabel('Username').fill(REAL_STACK_ACCOUNTS.admin.username);
      await page.getByLabel('Password').fill(REAL_STACK_ACCOUNTS.admin.password);
      await page.getByRole('button', { name: 'Log In' }).click();
      await realExpect(page).toHaveURL('/');
      await goToDeviceReal(page);

      // --- DIO-1: the expected storage UUID is display-only text, never fetched/cross-checked against /storage ---
      await realExpect(page.getByRole('region', { name: 'Identity' })).toContainText(provisioning.deviceId);
      await realExpect(page.getByRole('region', { name: 'Identity' })).toContainText(provisioning.expectedStorageVolumeUuid);

      const health = page.getByRole('region', { name: 'Health' });

      // --- The capture card mirrors real PM telemetry through every state, never a dead device.
      // (The fake PM's own boot default is already `present`/`off` — setting that again would be
      // a no-op telemetry change and never publish, so this sequence starts from a genuine change.) ---
      await realStack.control('core.pm.status', { status: { ...SOURCES_ONLINE_NO_CAPTURE, device: { captureCardState: 'absent', led: 'off' } } });
      await realExpect(health.getByText('Not detected')).toBeVisible({ timeout: 10_000 });

      await realStack.control('core.pm.status', { status: { ...SOURCES_ONLINE_NO_CAPTURE, device: { captureCardState: 'recovering', led: 'blink' } } });
      await realExpect(health.getByText(/Recovering — power-cycling/)).toBeVisible({ timeout: 10_000 });

      await realStack.control('core.pm.status', { status: { ...SOURCES_ONLINE_NO_CAPTURE, device: { captureCardState: 'failed', led: 'off' } } });
      await realExpect(health.getByText('Failed — needs a person. Camera-only recording still works.')).toBeVisible({ timeout: 10_000 });

      // --- Health goes stale (client-side, T-HEALTH-STALE) once no further PM telemetry arrives ---
      await realExpect(page.locator('.us-device__stale')).toBeVisible({ timeout: 10_000 });
      await realExpect(health.getByText('— checking…')).toHaveCount(3);

      // --- Alert dedup (INV-SA-1): a still-active code never grows a second row ---
      const code = 'e42-device-test';
      const first = await realStack.control<SystemAlertRow>('core.alert', {
        op: 'raise', code, severity: 'warning', category: 'Hardware', title: 'Test device condition',
      });
      const dup = await realStack.control<SystemAlertRow>('core.alert', {
        op: 'raise', code, severity: 'warning', category: 'Hardware', title: 'Test device condition',
      });
      realExpect(dup).toMatchObject({ id: first.id, raisedAt: first.raisedAt });

      // --- Acknowledging it (through the real UI) never clears it, and it stays the SAME occurrence ---
      const alerts = page.getByRole('region', { name: 'Active alerts' });
      const row = page.getByRole('article', { name: 'warning Test device condition' });
      await realExpect(row).toBeVisible({ timeout: 10_000 });
      await row.getByRole('button', { name: /^Acknowledge/ }).click();
      await realExpect(row.getByText('✓ acknowledged · still active')).toBeVisible({ timeout: 5_000 });

      const afterAck = await (await fetch(`${base}/alerts`, { headers: auth })).json() as { items: SystemAlertRow[] };
      const ackedRow = afterAck.items.find((a) => a.id === first.id)!;
      realExpect(ackedRow.acknowledgedBy, 'acknowledged').not.toBeNull();
      realExpect(ackedRow.clearedAt, 'still active — acknowledge is not clear').toBeNull();

      const stillSame = await realStack.control<SystemAlertRow>('core.alert', {
        op: 'raise', code, severity: 'warning', category: 'Hardware', title: 'Test device condition',
      });
      realExpect(stillSame.id, 'a still-true condition never re-raises as a new occurrence').toBe(first.id);

      // --- Only a real clear, then raise, produces a genuinely fresh (unacknowledged) occurrence ---
      await realStack.control('core.alert', { op: 'clear', code });
      const reraised = await realStack.control<SystemAlertRow>('core.alert', {
        op: 'raise', code, severity: 'warning', category: 'Hardware', title: 'Test device condition',
      });
      realExpect(reraised.id).not.toBe(first.id);
      realExpect(reraised.acknowledgedBy).toBeNull();

      await realExpect.poll(async () => {
        const { items } = await (await fetch(`${base}/alerts`, { headers: auth })).json() as { items: SystemAlertRow[] };
        return items.some((a) => a.id === reraised.id && a.acknowledgedBy === null);
      }, { timeout: 10_000 }).toBe(true);
      await realExpect(alerts.getByRole('article', { name: 'warning Test device condition' }).getByRole('button', { name: /^Acknowledge/ })).toBeVisible({ timeout: 10_000 });
    },
  );
});
