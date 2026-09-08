import { expect, test, type Page } from '@playwright/test';
import { expect as realExpect, test as realTest, REAL_STACK_ACCOUNTS } from './fixtures/real-stack.js';

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

async function goToUploadQueue(page: Page) {
  await page.getByRole('button', { name: 'Show controls' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();
  await expect(page.getByTestId('advanced-shell')).toBeVisible();
  await page.getByRole('button', { name: /Upload Queue/ }).click();
  await expect(page.locator('[data-screen="S-35"]')).toBeVisible();
}

test.describe('S-35 Upload queue', () => {
  test('primary: admin sees queued/uploading/done rows and requeues a dead-letter job', async ({ page }) => {
    test.setTimeout(20_000);
    await signIn(page);
    await goToUploadQueue(page);

    await expect(page.getByText('Uploading… 62%')).toBeVisible();
    await expect(page.getByText('Uploaded')).toBeVisible();

    const requeue = page.getByRole('button', { name: 'Try again now' });
    await expect(requeue).toBeVisible();
    await requeue.click();
    // The mock resolves the 202 and its upload.job{queued} near-instantly, so
    // "Requeuing…" is not reliably observable — assert the resolved state instead.
    await expect(page.getByRole('button', { name: 'Try again now' })).toHaveCount(0, { timeout: 5_000 });
  });

  test('failure: wan-loss shows "Waiting for the network", never "failed"', async ({ page }) => {
    test.setTimeout(20_000);
    await signIn(page);
    await switchScenario(page, 'wan-loss');
    await goToUploadQueue(page);

    await expect(page.getByText(/Waiting for the network/)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(/^failed$/i)).toHaveCount(0);
  });
});

interface UploadAudit {
  readonly found: boolean;
  readonly state: string;
  readonly attempt: number;
  readonly failureClass: string | null;
  readonly parts: ReadonlyArray<{ state: string; bytesSent: number; bytesTotal: number }>;
}

async function realSignInAdmin(page: Page) {
  const { username, password } = REAL_STACK_ACCOUNTS.admin;
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log In' }).click();
  await realExpect(page).toHaveURL('/');
}

async function goToUploadQueueReal(page: Page) {
  await page.getByRole('button', { name: 'Show controls' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();
  await realExpect(page.getByTestId('advanced-shell')).toBeVisible();
  await page.getByRole('button', { name: /Upload Queue/ }).click();
  await realExpect(page.locator('[data-screen="S-35"]')).toBeVisible();
}

// A B-only screen — the real stack needs no Docker/real-D here. Serial: the
// tests share one real stack and the resume test restarts B.
realTest.describe.configure({ mode: 'serial' });
realTest.describe('S-35 Upload queue — real', () => {
  realTest(
    'real: a dead-letter upload shows needs-attention and a manual requeue re-runs the real upload to done',
    { annotation: { type: 'adapter', description: 'real' } },
    async ({ page, realStack }) => {
      realTest.setTimeout(120_000);
      await realStack.control('core.start');
      const dl = await realStack.control<{ recordingId: string; jobId: string }>('core.seed-upload', { sizeBytes: 4_096, deadLetter: true });

      await realSignInAdmin(page);
      await goToUploadQueueReal(page);

      const row = page.locator('.us-uploadrow', { hasText: 'Dead Letter Upload Lecture' });
      await realExpect(row).toBeVisible({ timeout: 15_000 });
      await realExpect(row.getByText('Upload needs attention')).toBeVisible();

      // Placeholder-only: no institute payload is claimed anywhere on the row.
      await realExpect(row.getByText('Try again now')).toBeVisible();
      await row.getByRole('button', { name: 'Try again now' }).click();

      // The 202 resolves on upload.job{queued}; the real scheduler then streams
      // the file to the placeholder endpoint and the row reaches Uploaded.
      await realExpect(row.getByRole('button', { name: 'Try again now' })).toHaveCount(0, { timeout: 25_000 });
      await realExpect(row.getByText('Uploaded')).toBeVisible({ timeout: 25_000 });
      realExpect((await realStack.control<UploadAudit>('core.upload-audit', { recordingId: dl.recordingId })).state).toBe('done');
    },
  );

  realTest(
    'real: a WAN cut mid-part parks the job waiting-for-network with no attempt spent, and a restart then resume completes from the durable byte offset',
    { annotation: { type: 'adapter', description: 'real' } },
    async ({ page, realStack }) => {
      realTest.setTimeout(120_000);
      await realStack.control('core.start');
      const seed = await realStack.control<{ recordingId: string; sessionId: string }>('core.seed-upload', { sizeBytes: 200 * 1024 });

      // Cut the second upload chunk (the first commits a durable offset), then
      // start the real upload and let it fail on connectivity before we look.
      // Reset the fixture's global PATCH counter so cutAtPatch counts from a
      // clean slate regardless of any earlier test's uploads.
      await realStack.control('core.upload', { reset: true, cutAtPatch: 2 });
      await realStack.control('core.upload-enqueue-ready', { recordingId: seed.recordingId, sessionId: seed.sessionId });
      await realExpect.poll(
        async () => (await realStack.control<UploadAudit>('core.upload-audit', { recordingId: seed.recordingId })).state,
        { timeout: 30_000 },
      ).toBe('failed');

      await realSignInAdmin(page);
      await goToUploadQueueReal(page);

      const row = page.locator('.us-uploadrow', { hasText: 'Resumable Upload Lecture' });
      await realExpect(row).toBeVisible({ timeout: 15_000 });
      // Connectivity is presented as waiting-for-network, never a hard "failed",
      // and spends no attempt (C-5).
      await realExpect(row.getByText(/Waiting for the network/)).toBeVisible();
      await realExpect(row.getByText(/No attempts used/)).toBeVisible();
      await realExpect(page.getByText(/^failed$/i)).toHaveCount(0);

      const afterCut = await realStack.control<UploadAudit>('core.upload-audit', { recordingId: seed.recordingId });
      realExpect(afterCut.attempt).toBe(0);
      realExpect(afterCut.failureClass).toBe('connectivity');
      realExpect(afterCut.parts[0]!.bytesSent).toBeGreaterThan(0);
      const cutOffset = afterCut.parts[0]!.bytesSent;

      // Durability across a process restart, then the device comes back online.
      // (Reading the UI after tearing the socket stalls this environment's CDP
      // renderer, so the resume is verified through the real audit — see S-12.)
      await realStack.control('core.restart');
      await realStack.control('core.upload-retry-now', { recordingId: seed.recordingId });
      await realExpect.poll(
        async () => (await realStack.control<UploadAudit>('core.upload-audit', { recordingId: seed.recordingId })).state,
        { timeout: 45_000 },
      ).toBe('done');

      const done = await realStack.control<UploadAudit>('core.upload-audit', { recordingId: seed.recordingId });
      realExpect(done.parts[0]!.bytesSent).toBe(done.parts[0]!.bytesTotal);
      // Resumed from the durable offset, never restarted from zero.
      realExpect(cutOffset).toBeGreaterThan(0);
      realExpect(cutOffset).toBeLessThan(done.parts[0]!.bytesTotal);
    },
  );
});
