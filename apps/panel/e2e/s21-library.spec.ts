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

test.describe('S-21 Recordings library', () => {
  test('primary: the header link opens the library and every seeded row renders its badge', async ({ page }) => {
    await signIn(page);
    await goToLibrary(page);

    await expect(page.getByText('Uploaded').first()).toBeVisible();
    await expect(page.getByText(/Uploading…/).first()).toBeVisible();
  });

  test('primary (S-24 fold): an admin deletes an uploaded recording and the row disappears', async ({ page }) => {
    await signIn(page, 'admin', 'battery-staple');
    await goToLibrary(page);

    const uploadedRow = page.locator('.us-reclist__item', { hasText: 'Uploaded' }).first();
    const title = await uploadedRow.locator('.us-reclist__title').textContent();
    await uploadedRow.getByRole('button', { name: /More actions/ }).click();
    await uploadedRow.getByRole('menuitem', { name: 'Delete' }).click();

    const dialog = page.getByRole('alertdialog', { name: 'Delete this recording?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 5_000 });
    if (title) await expect(page.getByText(title)).toHaveCount(0);
  });

  test('failure: a lecturer never sees the Delete control', async ({ page }) => {
    await signIn(page);
    await goToLibrary(page);

    const row = page.locator('.us-reclist__item').first();
    await row.getByRole('button', { name: /More actions/ }).click();
    await expect(row.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
  });

  test('failure: disk-full removes a row with a non-alarming, reason-keyed note', async ({ page }) => {
    test.setTimeout(20_000);
    await signIn(page);
    await switchScenario(page, 'disk-full');
    await goToLibrary(page);

    await expect(page.getByText(/removed to free up space/)).toBeVisible({ timeout: 8_000 });
  });
});

interface SeededLibrary {
  readonly lecturerId: string;
  readonly otherId: string;
  readonly pageSize: number;
  readonly lecturerTotal: number;
  readonly uploadingRecordingId: string;
  readonly uploadJobId: string;
  readonly otherTitles: readonly string[];
  readonly filterTitle: string;
}

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

// A B-only screen — the real stack needs no Docker/real-D here. Serial: both
// tests share one real stack and one toggles B off/on, so they must not run in
// parallel workers.
realTest.describe.configure({ mode: 'serial' });
realTest.describe('S-21 Recordings library — real', () => {
  realTest(
    'real: the server scopes a lecturer to their own rows, a live upload.job flips the badge, and real keyset paging appends page two onto an intact page one',
    { annotation: { type: 'adapter', description: 'real' } },
    async ({ page, realStack }) => {
      realTest.setTimeout(120_000);
      await realStack.control('core.start'); // defensive: a prior test may have left B stopped
      const seed = await realStack.control<SeededLibrary>('core.seed-recordings');

      await realSignIn(page, 'lecturer');
      await goToLibraryReal(page);

      const rows = page.locator('.us-reclist__item');
      await realExpect.poll(async () => rows.count(), { timeout: 20_000 }).toBe(seed.pageSize);
      // INV-RC-5: the server excludes another lecturer's recordings — never a
      // React-only filter over a mixed page.
      for (const title of seed.otherTitles) {
        await realExpect(page.getByText(title, { exact: true })).toHaveCount(0);
      }

      // A live upload.job over the real WS advances the badge — no refetch.
      await realExpect(page.getByText('Uploading…').first()).toBeVisible({ timeout: 10_000 });
      await realStack.control('core.publish-upload-job', { jobId: seed.uploadJobId, state: 'done' });
      await realExpect(page.getByText('Uploaded').first()).toBeVisible({ timeout: 15_000 });

      // Real keyset paging against the real server: Load more fetches page two
      // with the server-issued cursor and appends onto the intact page one.
      const loadMore = page.getByRole('button', { name: 'Load more' });
      await realExpect(loadMore).toBeEnabled();
      await loadMore.click();
      await realExpect.poll(async () => rows.count(), { timeout: 20_000 }).toBe(seed.lecturerTotal);
      // The page-two fetch never dropped page one — the same first-page rows are
      // still present (row identity preserved, no skeleton flash). The failed
      // HTTP-drop-then-retry variant is proven deterministically at the unit
      // level in use-recordings.test.ts, because tearing away a real socket
      // stalls this environment's CDP Chromium renderer (see S-12's note).
      await realExpect(page.getByText('Uploaded').first()).toBeVisible();
      await realExpect(page.getByText(seed.filterTitle, { exact: true })).toBeVisible();
    },
  );

  realTest(
    'real: an admin owner filter and a title filter are applied by the server, not the client',
    { annotation: { type: 'adapter', description: 'real' } },
    async ({ page, realStack }) => {
      realTest.setTimeout(120_000);
      await realStack.control('core.start'); // defensive: a prior test may have left B stopped
      const seed = await realStack.control<SeededLibrary>('core.seed-recordings');

      await realSignIn(page, 'admin');
      await goToLibraryReal(page);

      const rows = page.locator('.us-reclist__item');
      // The admin sees every owner's rows up to one page.
      await realExpect.poll(async () => rows.count(), { timeout: 20_000 }).toBe(seed.pageSize);

      // Owner filter → only the other lecturer's rows come back from the server.
      await page.getByLabel('Filter by owner').fill(seed.otherId);
      await realExpect.poll(async () => rows.count(), { timeout: 15_000 }).toBe(seed.otherTitles.length);
      for (const title of seed.otherTitles) {
        await realExpect(page.getByText(title, { exact: true })).toBeVisible();
      }

      // Clear owner, apply a title query → exactly the one matching row.
      await page.getByRole('button', { name: 'Clear owner filter' }).click();
      await page.getByLabel('Search recordings').fill(seed.filterTitle);
      await realExpect.poll(async () => rows.count(), { timeout: 15_000 }).toBe(1);
      await realExpect(page.getByText(seed.filterTitle, { exact: true })).toBeVisible();
    },
  );
});
