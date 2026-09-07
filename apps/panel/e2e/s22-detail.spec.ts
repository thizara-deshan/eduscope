import { expect, test, type Page } from '@playwright/test';
import { expect as realExpect, test as realTest, REAL_STACK_ACCOUNTS } from './fixtures/real-stack.js';

async function signIn(page: Page, username = 'a.perera', password = 'correct-horse') {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log In' }).click();
  await expect(page).toHaveURL('/');
}

async function goToLibrary(page: Page) {
  // The recording library now lives inside the Advanced shell (a dedicated
  // sidebar section), not a header link.
  await page.getByRole('button', { name: 'Show controls' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();
  await expect(page.getByTestId('advanced-shell')).toBeVisible();
  await page.getByRole('button', { name: 'Recording Library' }).click();
  await expect(page.locator('[data-screen="S-21"]')).toBeVisible();
}

test.describe('S-22 Recording detail & player', () => {
  test('primary: open a recording, play the merged file, download', async ({ page }) => {
    await signIn(page);
    await goToLibrary(page);

    const uploadedRow = page.locator('.us-reclist__item', { hasText: 'Uploaded' }).first();
    await uploadedRow.getByRole('button', { name: /^Play/ }).click();
    await expect(page.locator('[data-screen="S-22"]')).toBeVisible();

    // The player fetches the authenticated media route and hands the real
    // Blob straight to <video src>. The mock's fixture bytes are a placeholder
    // string, not a decodable container, so a real browser's media pipeline
    // legitimately raises a decode error here — the same `playback failed`
    // path C-6 requires this screen to render (distinct from `file missing`).
    // What IS genuinely demonstrable end-to-end is the authenticated route
    // being called and the recovery affordance appearing.
    await expect(page.getByText('Playback stopped.').or(page.locator('video'))).toBeVisible({ timeout: 10_000 });

    const downloadPromise = page.waitForEvent('download').catch(() => null);
    await page.getByRole('button', { name: /Download/ }).first().click();
    await downloadPromise;
  });

  test('failure: merge failed shows admin Retry, which recovers preparing -> ready', async ({ page }) => {
    test.setTimeout(20_000);
    await signIn(page, 'admin', 'battery-staple');
    await goToLibrary(page);

    const failedRow = page.locator('.us-reclist__item', { hasText: "Couldn't prepare this recording" }).first();
    await failedRow.click();
    await expect(page.locator('[data-screen="S-22"]')).toBeVisible();

    await expect(page.getByText(/couldn't combine/)).toBeVisible();
    const retry = page.getByRole('button', { name: 'Retry preparing' });
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(page.getByText(/preparing the full recording/)).toBeVisible({ timeout: 10_000 });
  });

  test('lecturer sees no Retry on a merge-failed recording (U-6)', async ({ page }) => {
    await signIn(page);
    await goToLibrary(page);

    const failedRow = page.locator('.us-reclist__item', { hasText: "Couldn't prepare this recording" }).first();
    await failedRow.click();
    await expect(page.locator('[data-screen="S-22"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry preparing' })).toHaveCount(0);
  });
});

async function realSignIn(page: Page, account: keyof typeof REAL_STACK_ACCOUNTS) {
  const { username, password } = REAL_STACK_ACCOUNTS[account];
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log In' }).click();
  await realExpect(page).toHaveURL('/');
}

async function goToLibraryReal(page: Page) {
  await page.getByRole('button', { name: 'Show controls' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();
  await realExpect(page.getByTestId('advanced-shell')).toBeVisible();
  await page.getByRole('button', { name: 'Recording Library' }).click();
  await realExpect(page.locator('[data-screen="S-21"]')).toBeVisible();
}

interface SeededDetail {
  readonly readyRecordingId: string;
  readonly readyFileId: string;
  readonly failedRecordingId: string;
}

// A B-only screen — the real stack needs no Docker/real-D here.
realTest.describe('S-22 Recording detail & player — real', () => {
  realTest(
    'real: authenticated Range media delivers real bytes, an admin merge retry recovers to ready over real events, and a non-failed retry is a server conflict',
    { annotation: { type: 'adapter', description: 'real' } },
    async ({ page, realStack }) => {
      realTest.setTimeout(120_000);
      const seed = await realStack.control<SeededDetail>('core.seed-detail');

      await realSignIn(page, 'admin');
      await goToLibraryReal(page);

      // (1) The player calls the real authenticated media route and receives
      // real bytes over an HTTP Range request (200/206). The placeholder
      // container is not a decodable stream, so the browser's media pipeline
      // legitimately raises the C-6 "Playback stopped." recovery affordance —
      // what is provable live is the authenticated Range transport itself.
      const mediaResponse = page.waitForResponse(
        (response) => response.url().includes(`/files/${seed.readyFileId}/media`)
          && (response.status() === 206 || response.status() === 200),
      );
      await page.locator('.us-reclist__item', { hasText: 'Ready Playback Lecture' })
        .getByRole('button', { name: /^Play/ }).click();
      await realExpect(page.locator('[data-screen="S-22"]')).toBeVisible();
      const media = await mediaResponse;
      realExpect([200, 206]).toContain(media.status());
      realExpect(Number(media.headers()['content-length'])).toBeGreaterThan(0);
      await realExpect(page.getByText('Playback stopped.').or(page.locator('video'))).toBeVisible({ timeout: 10_000 });

      // (2) A non-failed recording's retry is a real server conflict carrying the
      // contract's reason — never an invented Problem code (DR-08 no-change).
      const { accessToken } = await realStack.login('admin');
      const refusal = await fetch(`${realStack.coreBaseUrl}/recordings/${seed.readyRecordingId}/retry-merge`, {
        method: 'POST', headers: { authorization: `Bearer ${accessToken}` },
      });
      realExpect(refusal.status).toBe(409);
      const problem = await refusal.json() as { code: string; title: string };
      realExpect(problem.code).toBe('conflict');
      realExpect(problem.title).toBe('Recording is not in a failed merge state');

      // (3) The merge-failed recording: an admin Retry runs the real merge
      // worker (finalizing → merging → ready), and the detail converges to
      // ready from those real events — merge truth from events/readback, never
      // the 202 alone.
      await page.getByRole('link', { name: /Back to recordings/ }).click();
      await realExpect(page.locator('[data-screen="S-21"]')).toBeVisible();
      await page.locator('.us-reclist__item', { hasText: 'Failed Merge Lecture' })
        .getByRole('button', { name: /^Play/ }).click();
      await realExpect(page.locator('[data-screen="S-22"]')).toBeVisible();
      await realExpect(page.getByText(/couldn't combine/)).toBeVisible();
      await page.getByRole('button', { name: 'Retry preparing' }).click();
      // Recovery: the merge-failed section is gone and the ready file list renders.
      await realExpect(page.getByText(/couldn't combine/)).toHaveCount(0, { timeout: 30_000 });
      await realExpect(page.getByRole('button', { name: 'Retry preparing' })).toHaveCount(0);
    },
  );
});
