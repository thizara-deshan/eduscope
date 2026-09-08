import { expect, test, type Page } from '@playwright/test';
import { REAL_STACK_ACCOUNTS, expect as realExpect, hashBuiltBundle, test as realTest } from './fixtures/real-stack.js';

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

async function setNetworkApplyFails(page: Page, enabled: boolean) {
  await openScenarioOverlay(page);
  const checkbox = page.getByLabel('Network apply fails');
  if (await checkbox.isChecked() !== enabled) await checkbox.click();
  await page.getByRole('button', { name: /close scenarios/i }).click();
}

async function dismissAlerts(page: Page) {
  const ack = page.getByRole('button', { name: /^Acknowledge/ });
  if (await ack.isVisible().catch(() => false)) await ack.click();
}

async function goToNetwork(page: Page) {
  await page.getByRole('button', { name: 'Show controls' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();
  await expect(page.getByTestId('advanced-shell')).toBeVisible();
  await dismissAlerts(page);
  await page.getByRole('button', { name: /Network Settings/ }).click();
  await expect(page.locator('[data-screen="S-28"]')).toBeVisible();
}

test.describe('S-28 Network Settings', () => {
  test('primary: editing the LAN address and applying re-reads the row with a new appliedAt', async ({ page }) => {
    // The seeded vLAN is DHCP (no editable IPv4 fields by design — DHCP has
    // no manual address); the LAN interface is static and exercises the same
    // apply + row-readback path this journey verifies.
    await signIn(page);
    await goToNetwork(page);

    const lanCard = page.getByRole('region', { name: 'eth0 (lan)' });
    await lanCard.getByLabel('IPv4 address octet 4').fill('50');
    await lanCard.getByRole('button', { name: 'Apply' }).click();
    await expect(lanCard.getByText(/applied/)).toBeVisible({ timeout: 5_000 });
  });

  test('failure: network apply fails leaves lastApplyError and the prior address in effect', async ({ page }) => {
    await signIn(page);
    await setNetworkApplyFails(page, true);
    await goToNetwork(page);

    const lanCard = page.getByRole('region', { name: 'eth0 (lan)' });
    await lanCard.getByLabel('IPv4 address octet 4').fill('99');
    await lanCard.getByRole('button', { name: 'Apply' }).click();
    await expect(lanCard.getByText(/previous config kept/)).toBeVisible({ timeout: 5_000 });
  });
});

interface NetworkConfigRow {
  readonly id: string;
  readonly interfaceName: string;
  readonly ipv4Address: string | null;
  readonly prefixLength: number | null;
  readonly gateway: string | null;
  readonly appliedAt: string | null;
  readonly lastApplyError: string | null;
}

interface PhysicalInputRow {
  readonly id: string;
  readonly address: string;
}

interface SourceStatusRow {
  readonly roleId: string;
  readonly state: string;
}

const SOURCES_ONLINE_STATUS = {
  publishers: {
    usb: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
    rtsp: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
    rtsp2: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
    audio: { state: 'online', bound: true, fps: null, rms: 0.4, lastError: null },
  },
  consumers: [],
} as const;

realTest.describe('S-28 Network Settings — real', () => {
  realTest(
    'real: an invalid config never reaches the helper, a valid apply persists, a failing helper leaves the row unchanged, and a camera rebind reprobes through PM',
    { annotation: { type: 'adapter', description: 'real' } },
    async ({ page, request, realStack }) => {
      realTest.setTimeout(90_000);
      await realStack.control('core.start');

      const bundleHashBefore = await hashBuiltBundle(request);

      const base = realStack.coreBaseUrl;
      const login = await fetch(`${base}/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...REAL_STACK_ACCOUNTS.admin, client: 'panel' }),
      });
      const { tokens } = await login.json() as { tokens: { accessToken: string } };
      const auth = { authorization: `Bearer ${tokens.accessToken}` };
      const jsonAuth = { 'content-type': 'application/json', ...auth };

      const { items: configs } = await (await fetch(`${base}/settings/network`, { headers: auth })).json() as { items: NetworkConfigRow[] };
      const eth0 = configs.find((c) => c.interfaceName === 'eth0');
      realExpect(eth0, 'seeded eth0 wired interface').toBeTruthy();

      // --- Class A: an invalid IPv4 address never reaches the helper ---
      const ledgerBefore = await realStack.ledger();
      const rejected = await fetch(`${base}/settings/network/${eth0!.id}`, {
        method: 'PUT', headers: jsonAuth,
        body: JSON.stringify({ addressMode: 'static', ipv4Address: '999.999.999.999', prefixLength: 24, gateway: '10.50.0.1', dnsServers: [] }),
      });
      realExpect(rejected.status).toBe(422);
      const rejectedBody = await rejected.json() as { code: string };
      realExpect(rejectedBody.code).toBe('config.invalid');
      const ledgerAfterRejection = await realStack.ledger();
      realExpect(ledgerAfterRejection.helper.length, 'invalid config must not reach the helper').toBe(ledgerBefore.helper.length);

      // --- A valid static apply persists through the real net.apply helper verb ---
      const applyValid = await fetch(`${base}/settings/network/${eth0!.id}`, {
        method: 'PUT', headers: jsonAuth,
        body: JSON.stringify({ addressMode: 'static', ipv4Address: '10.50.0.50', prefixLength: 24, gateway: '10.50.0.1', dnsServers: [] }),
      });
      realExpect(applyValid.status).toBe(202);
      const readEth0 = async (): Promise<NetworkConfigRow> => {
        const { items } = await (await fetch(`${base}/settings/network`, { headers: auth })).json() as { items: NetworkConfigRow[] };
        return items.find((c) => c.id === eth0!.id)!;
      };
      await realExpect.poll(async () => (await readEth0()).ipv4Address, { timeout: 10_000 }).toBe('10.50.0.50');
      const applied = await readEth0();
      realExpect(applied.lastApplyError).toBeNull();
      const firstAppliedAt = applied.appliedAt;
      realExpect(firstAppliedAt).toBeTruthy();

      // --- A failing helper leaves the previously applied row untouched, with a readable error ---
      await realStack.control('core.helper', { failureVerb: 'net.apply' });
      const applyFailing = await fetch(`${base}/settings/network/${eth0!.id}`, {
        method: 'PUT', headers: jsonAuth,
        body: JSON.stringify({ addressMode: 'static', ipv4Address: '10.50.0.77', prefixLength: 24, gateway: '10.50.0.1', dnsServers: [] }),
      });
      realExpect(applyFailing.status).toBe(202);
      await realExpect.poll(async () => (await readEth0()).lastApplyError, { timeout: 10_000 }).not.toBeNull();
      const afterFailure = await readEth0();
      realExpect(afterFailure.ipv4Address).toBe('10.50.0.50');
      realExpect(afterFailure.appliedAt).toBe(firstAppliedAt);
      await realStack.control('core.helper', { failureVerb: null });

      // Every helper call this test made used exactly the allowlisted net.apply verb.
      const finalLedger = await realStack.ledger();
      const newHelperCalls = finalLedger.helper.slice(ledgerBefore.helper.length);
      realExpect(newHelperCalls.length).toBeGreaterThanOrEqual(2);
      for (const call of newHelperCalls) realExpect((call as { verb: string }).verb).toBe('net.apply');

      // --- A camera IP rebind reprobes through PM: unknown immediately, online after telemetry ---
      await realStack.control('core.pm.status', { status: SOURCES_ONLINE_STATUS });
      const { items: inputs } = await (await fetch(`${base}/sources/inputs`, { headers: auth })).json() as { items: PhysicalInputRow[] };
      const lecturerCamInput = inputs.find((i) => i.address === 'rtsp://192.168.1.101/stream1');
      realExpect(lecturerCamInput, 'seeded lecturer-cam physical input').toBeTruthy();
      await realExpect.poll(async () => {
        const { items } = await (await fetch(`${base}/sources/status`, { headers: auth })).json() as { items: SourceStatusRow[] };
        return items.find((s) => s.roleId === 'lecturer-cam')?.state;
      }, { timeout: 10_000 }).toBe('online');

      const rebind = await fetch(`${base}/sources/inputs/${lecturerCamInput!.id}`, {
        method: 'PUT', headers: jsonAuth, body: JSON.stringify({ address: 'rtsp://192.168.1.201/stream1' }),
      });
      realExpect(rebind.status).toBe(200);
      const { items: rightAfter } = await (await fetch(`${base}/sources/status`, { headers: auth })).json() as { items: SourceStatusRow[] };
      realExpect(rightAfter.find((s) => s.roleId === 'lecturer-cam')?.state, 'reprobe resets to unknown before a fresh telemetry snapshot').toBe('unknown');

      await realStack.control('core.pm.status', { status: SOURCES_ONLINE_STATUS });
      await realExpect.poll(async () => {
        const { items } = await (await fetch(`${base}/sources/status`, { headers: auth })).json() as { items: SourceStatusRow[] };
        return items.find((s) => s.roleId === 'lecturer-cam')?.state;
      }, { timeout: 10_000 }).toBe('online');

      // --- None of the above rebuilt the panel bundle ---
      const bundleHashAfter = await hashBuiltBundle(request);
      realExpect(bundleHashAfter).toBe(bundleHashBefore);

      // --- Screen renders the real, persisted address without a rebuild ---
      await page.goto('/login');
      await page.getByLabel('Username').fill(REAL_STACK_ACCOUNTS.admin.username);
      await page.getByLabel('Password').fill(REAL_STACK_ACCOUNTS.admin.password);
      await page.getByRole('button', { name: 'Log In' }).click();
      await realExpect(page).toHaveURL('/');
      await page.getByRole('button', { name: 'Show controls' }).click();
      await page.getByRole('button', { name: 'Advanced' }).click();
      await realExpect(page.getByTestId('advanced-shell')).toBeVisible();
      await page.getByRole('button', { name: /Network Settings/ }).click();
      await realExpect(page.locator('[data-screen="S-28"]')).toBeVisible();
      await realExpect(page.getByLabel('IPv4 address octet 4')).toHaveValue('50');
    },
  );
});
