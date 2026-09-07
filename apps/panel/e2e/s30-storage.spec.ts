import { existsSync } from 'node:fs';
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

async function setDiskHealth(page: Page, label: string) {
  await openScenarioOverlay(page);
  await page.getByLabel(label).check();
  await page.getByRole('button', { name: /close scenarios/i }).click();
}

async function dismissAlerts(page: Page) {
  const ack = page.getByRole('button', { name: /^Acknowledge/ });
  if (await ack.isVisible().catch(() => false)) await ack.click();
}

async function goToStorage(page: Page) {
  await page.getByRole('button', { name: 'Show controls' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();
  await expect(page.getByTestId('advanced-shell')).toBeVisible();
  await dismissAlerts(page);
  await page.getByRole('button', { name: /Local Storage/ }).click();
  await expect(page.locator('[data-screen="S-30"]')).toBeVisible();
}

test.describe('S-30 Local Storage', () => {
  test('primary: stats, SMART (in words) and retention numbers render; format stays disabled until the name matches', async ({ page }) => {
    await signIn(page);
    await goToStorage(page);

    await expect(page.getByText(/free of/)).toBeVisible();
    await expect(page.getByText('good')).toBeVisible();
    await expect(page.getByText(/past 90 days/)).toBeVisible();

    await page.getByRole('button', { name: 'Format…' }).click();
    const formatButton = page.getByRole('button', { name: 'Format volume' });
    await expect(formatButton).toBeDisabled();
    await page.getByLabel('Type RECORDINGS to confirm formatting').fill('RECORDINGS');
    await expect(formatButton).toBeEnabled();
  });

  test('failure: failing SMART renders honestly', async ({ page }) => {
    await signIn(page);
    await setDiskHealth(page, 'Disk health: failing');
    await goToStorage(page);
    await expect(page.getByText('failing')).toBeVisible();
  });
});

interface StorageOverview {
  readonly pressure: string;
  readonly totalBytes: number;
  readonly freeBytes: number;
  readonly volumes: ReadonlyArray<{ id: string; uuid: string; devicePath: string; filesystem: string; state: string }>;
  readonly policy: {
    readonly maxAgeDays: number;
    readonly warningThresholdPct: number;
    readonly criticalThresholdPct: number;
    readonly earlyDeleteOrder: string;
    readonly neverDeleteUnuploaded: boolean;
    readonly refuseStartWhenCritical: boolean;
  };
}

interface RecordingRow {
  readonly state: string;
}

interface RetentionSeed {
  readonly ageEligibleId: string;
  readonly unuploadedId: string;
  readonly pressureOlderId: string;
  readonly pressureNewerId: string;
  readonly foreignPath: string;
}

realTest.describe.configure({ mode: 'serial' });
realTest.describe('S-30 Local Storage — real', () => {
  realTest(
    'real: helper refusal and a wrong confirmation both prevent a scratch-volume format, a correct confirmation formats it, the retention sweep deletes only uploaded-oldest rows, and a critical volume refuses recording start',
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
      const jsonAuth = { 'content-type': 'application/json', ...auth };

      // --- Displayed policy equals the real, seeded server policy ---
      const overviewBefore = await (await fetch(`${base}/storage`, { headers: auth })).json() as StorageOverview;
      realExpect(overviewBefore.policy).toMatchObject({
        maxAgeDays: 14, warningThresholdPct: 80, criticalThresholdPct: 95,
        earlyDeleteOrder: 'uploaded-oldest-first', neverDeleteUnuploaded: true, refuseStartWhenCritical: true,
      });

      // --- The one real scratch (recordings-role) volume: mount its matching device, then
      // helper refusal and a wrong confirmation both refuse format ---
      await realStack.control('core.mount-scratch-device');
      const seededVolume = overviewBefore.volumes.find((v) => v.uuid === 'e06-recordings');
      realExpect(seededVolume, 'the boot-seeded recordings volume').toBeTruthy();
      const volumeId = seededVolume!.id;
      const expectedConfirm = seededVolume!.label ?? seededVolume!.uuid;
      const filesystemBefore = seededVolume!.filesystem;

      const wrongConfirm = await fetch(`${base}/storage/volumes/${volumeId}/format`, {
        method: 'POST', headers: jsonAuth, body: JSON.stringify({ confirmText: 'not-the-name' }),
      });
      realExpect(wrongConfirm.status).toBe(422);
      realExpect((await wrongConfirm.json() as { code: string }).code).toBe('validation.invalid');

      await realStack.control('core.helper', { failureVerb: 'volume.format' });
      const helperRefused = await fetch(`${base}/storage/volumes/${volumeId}/format`, {
        method: 'POST', headers: jsonAuth, body: JSON.stringify({ confirmText: expectedConfirm }),
      });
      realExpect(helperRefused.status).toBe(422);
      const afterRefusal = ((await (await fetch(`${base}/storage`, { headers: auth })).json()) as StorageOverview)
        .volumes.find((v) => v.id === volumeId)!;
      realExpect(afterRefusal).toMatchObject({ filesystem: filesystemBefore, state: 'mounted' });
      await realStack.control('core.helper', { failureVerb: null });

      const correctFormat = await fetch(`${base}/storage/volumes/${volumeId}/format`, {
        method: 'POST', headers: jsonAuth, body: JSON.stringify({ confirmText: expectedConfirm }),
      });
      realExpect(correctFormat.status).toBe(202);
      const afterFormat = ((await (await fetch(`${base}/storage`, { headers: auth })).json()) as StorageOverview)
        .volumes.find((v) => v.id === volumeId)!;
      realExpect(afterFormat).toMatchObject({ filesystem: 'ext4', state: 'mounted' });
      const helperLedger = (await realStack.ledger()).helper as Array<{ verb: string }>;
      const formatVerbs = helperLedger.filter((call) => call.verb.startsWith('volume.')).map((call) => call.verb);
      realExpect(formatVerbs).toContain('volume.unmount');
      realExpect(formatVerbs).toContain('volume.format');
      realExpect(formatVerbs).toContain('volume.mount');

      // --- Retention: seed uploaded/unuploaded/foreign rows, sweep, assert uploaded-oldest only ---
      const seed = await realStack.control<RetentionSeed>('core.seed-retention');
      realExpect(existsSync(seed.foreignPath), 'the foreign file exists before any sweep').toBe(true);

      await realStack.control('core.retention-sweep', { trigger: 'scheduled' });
      const readState = async (recordingId: string): Promise<string> =>
        ((await (await fetch(`${base}/recordings/${recordingId}`, { headers: auth })).json()) as RecordingRow).state;

      realExpect(await readState(seed.ageEligibleId), 'age-expired and uploaded is deleted by the age sweep').toBe('deleted');
      realExpect(await readState(seed.unuploadedId), 'age-expired but never uploaded survives').toBe('ready');
      realExpect(await readState(seed.pressureOlderId), 'not age-expired yet').toBe('ready');
      realExpect(await readState(seed.pressureNewerId), 'not age-expired yet').toBe('ready');
      realExpect(existsSync(seed.foreignPath), 'a foreign file with no DB row is never touched').toBe(true);

      await realStack.control('core.storage-pressure-step', {
        critical: { totalBytes: 1_000_000_000, freeBytes: 10_000_000 },
        ok: { totalBytes: 1_000_000_000, freeBytes: 800_000_000 },
        relieveAfterCalls: 1,
      });
      await realStack.control('core.retention-sweep', { trigger: 'pressure' });

      realExpect(await readState(seed.pressureOlderId), 'the older uploaded recording is relieved first').toBe('deleted');
      realExpect(await readState(seed.pressureNewerId), 'the sweep stops as soon as pressure clears').toBe('ready');
      realExpect(await readState(seed.unuploadedId), 'still never deleted by the pressure sweep').toBe('ready');
      realExpect(existsSync(seed.foreignPath), 'still untouched after the pressure sweep').toBe(true);

      // --- Start is refused while storage is critical, and no session row is created ---
      await realStack.control('core.storage-pressure', { totalBytes: 1_000_000_000, freeBytes: 10_000_000 });
      const auditBefore = await realStack.recordingAudit();
      const refusedStart = await fetch(`${base}/recording/start`, { method: 'POST', headers: auth });
      realExpect(refusedStart.status).toBe(422);
      realExpect((await refusedStart.json() as { code: string }).code).toBe('storage.critical');
      const auditAfter = await realStack.recordingAudit();
      realExpect(auditAfter.lectureSessions).toBe(auditBefore.lectureSessions);
      realExpect(auditAfter.recordStarts).toBe(auditBefore.recordStarts);

      // Restore healthy storage before the UI check below reads it.
      await realStack.control('core.storage-pressure', { totalBytes: 1_000_000_000, freeBytes: 800_000_000 });

      // --- The screen renders the real, server-computed retention policy text ---
      await page.goto('/login');
      await page.getByLabel('Username').fill(REAL_STACK_ACCOUNTS.admin.username);
      await page.getByLabel('Password').fill(REAL_STACK_ACCOUNTS.admin.password);
      await page.getByRole('button', { name: 'Log In' }).click();
      await realExpect(page).toHaveURL('/');
      await page.getByRole('button', { name: 'Show controls' }).click();
      await page.getByRole('button', { name: 'Advanced' }).click();
      const ack = page.getByRole('button', { name: /^Acknowledge/ });
      if (await ack.isVisible().catch(() => false)) await ack.click();
      await page.getByRole('button', { name: /Local Storage/ }).click();
      await realExpect(page.locator('[data-screen="S-30"]')).toBeVisible();
      await realExpect(page.getByText(/past 14 days/)).toBeVisible();
      await realExpect(page.getByText(/80% used/)).toBeVisible();
      await realExpect(page.getByText(/95% used/)).toBeVisible();
    },
  );
});
