import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { REAL_STACK_ACCOUNTS, expect as realExpect, test as realTest } from './fixtures/real-stack.js';

const FIXTURES_DIR = join(import.meta.dirname, '../../../services/core-api/test/fixtures/users');
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

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

async function setBulkImportRejects(page: Page, enabled: boolean) {
  await openScenarioOverlay(page);
  const checkbox = page.getByLabel('Bulk import rejects');
  if (await checkbox.isChecked() !== enabled) await checkbox.click();
  await page.getByRole('button', { name: /close scenarios/i }).click();
}

async function dismissAlerts(page: Page) {
  const ack = page.getByRole('button', { name: /^Acknowledge/ });
  if (await ack.isVisible().catch(() => false)) await ack.click();
}

async function goToUsers(page: Page) {
  await page.getByRole('button', { name: 'Show controls' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();
  await expect(page.getByTestId('advanced-shell')).toBeVisible();
  await dismissAlerts(page);
  await page.getByRole('button', { name: /User Management/ }).click();
  await expect(page.locator('[data-screen="S-32"]')).toBeVisible();
}

test.describe('S-33 Excel bulk import', () => {
  test('primary: importing a .xlsx reports N accepted users, all flagged for reset', async ({ page }) => {
    await signIn(page);
    await goToUsers(page);

    await page.getByRole('button', { name: 'Bulk Import' }).click();
    await page.getByLabel('Choose roster file').setInputFiles({
      name: 'roster.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from('stub'),
    });
    await expect(page.getByTestId('import-accepted')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('import-accepted')).toContainText('created');
  });

  test('failure: Bulk import rejects shows the row->reason table and "Nothing was imported." — directory unchanged', async ({ page }) => {
    await signIn(page);
    await setBulkImportRejects(page, true);
    await goToUsers(page);
    const initialRows = await page.getByTestId(/^user-row-/).count();

    await page.getByRole('button', { name: 'Bulk Import' }).click();
    await page.getByLabel('Choose roster file').setInputFiles({
      name: 'roster.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from('stub'),
    });
    await expect(page.getByTestId('rejection-headline')).toHaveText('Nothing was imported.', { timeout: 5_000 });
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByTestId(/^user-row-/)).toHaveCount(initialRows);
  });
});

interface UserRow {
  readonly username: string;
  readonly role: string;
  readonly source: string;
}

async function goToUsersReal(page: Page) {
  await page.getByRole('button', { name: 'Show controls' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();
  await realExpect(page.getByTestId('advanced-shell')).toBeVisible();
  const ack = page.getByRole('button', { name: /^Acknowledge/ });
  if (await ack.isVisible().catch(() => false)) await ack.click();
  await page.getByRole('button', { name: /User Management/ }).click();
  await realExpect(page.locator('[data-screen="S-32"]')).toBeVisible();
}

realTest.describe('S-33 Excel bulk import — real', () => {
  realTest(
    'real: a null-cell and an in-file duplicate reject the whole batch with zero writes, and a valid roster creates every row and forces reset',
    { annotation: { type: 'adapter', description: 'real' } },
    async ({ page, realStack }) => {
      realTest.setTimeout(90_000);
      await realStack.control('core.start');
      const base = realStack.coreBaseUrl;

      await page.goto('/login');
      await page.getByLabel('Username').fill(REAL_STACK_ACCOUNTS.admin.username);
      await page.getByLabel('Password').fill(REAL_STACK_ACCOUNTS.admin.password);
      await page.getByRole('button', { name: 'Log In' }).click();
      await realExpect(page).toHaveURL('/');
      await goToUsersReal(page);

      // --- A null required cell rejects the whole batch — no row is ever written ---
      await page.getByRole('button', { name: 'Bulk Import' }).click();
      await page.getByLabel('Choose roster file').setInputFiles({
        name: 'invalid-null.xlsx', mimeType: XLSX_MIME, buffer: readFileSync(join(FIXTURES_DIR, 'invalid-null.xlsx')),
      });
      await realExpect(page.getByTestId('rejection-headline')).toHaveText('Nothing was imported.', { timeout: 10_000 });
      const nullRow = page.locator('[role="row"]').filter({ hasText: 'empty-cell' });
      await realExpect(nullRow).toContainText('3');
      await realExpect(nullRow).toContainText('displayName');
      await realExpect(page.getByTestId('user-row-import.lecturer1')).toHaveCount(0);

      // --- An in-file duplicate username also rejects the whole batch ---
      await page.getByRole('button', { name: 'Try another file' }).click();
      await page.getByLabel('Choose roster file').setInputFiles({
        name: 'duplicate.xlsx', mimeType: XLSX_MIME, buffer: readFileSync(join(FIXTURES_DIR, 'duplicate.xlsx')),
      });
      await realExpect(page.getByTestId('rejection-headline')).toHaveText('Nothing was imported.', { timeout: 10_000 });
      const dupeRow = page.locator('[role="row"]').filter({ hasText: 'duplicate-username-in-file' });
      await realExpect(dupeRow).toContainText('3');
      await realExpect(dupeRow).toContainText('username');
      await realExpect(page.getByTestId('user-row-import.lecturer1')).toHaveCount(0);

      // --- A valid roster creates every row (local and institute-sourced) with forced reset ---
      await page.getByRole('button', { name: 'Try another file' }).click();
      await page.getByLabel('Choose roster file').setInputFiles({
        name: 'valid.xlsx', mimeType: XLSX_MIME, buffer: readFileSync(join(FIXTURES_DIR, 'valid.xlsx')),
      });
      await realExpect(page.getByTestId('import-accepted')).toContainText('3', { timeout: 10_000 });
      await realExpect(page.getByTestId('import-accepted')).toContainText('created, all flagged to reset');
      await page.getByRole('button', { name: 'Close' }).click();
      await realExpect(page.getByTestId('user-row-import.lecturer1')).toBeVisible();
      await realExpect(page.getByTestId('user-row-import.admin1')).toBeVisible();

      const adminLogin = await fetch(`${base}/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...REAL_STACK_ACCOUNTS.admin, client: 'panel' }),
      });
      const adminAuth = { authorization: `Bearer ${((await adminLogin.json()) as { tokens: { accessToken: string } }).tokens.accessToken}` };
      const { items: users } = await (await fetch(`${base}/users`, { headers: adminAuth })).json() as { items: UserRow[] };
      const institute = users.find((u) => u.username === 'import.admin1');
      realExpect(institute).toMatchObject({ role: 'admin', source: 'institute' });

      // --- The accepted (local) user can log in but is confined to the reset allowlist ---
      const login = await fetch(`${base}/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'import.lecturer1', password: 'Password1', client: 'panel' }),
      });
      realExpect(login.status).toBe(200);
      const loginBody = await login.json() as { mustResetPassword: boolean; tokens: { accessToken: string } };
      realExpect(loginBody.mustResetPassword).toBe(true);
      const importedAuth = { authorization: `Bearer ${loginBody.tokens.accessToken}` };
      realExpect((await fetch(`${base}/recording/state`, { headers: importedAuth })).status, 'blocked until reset').toBe(403);
      realExpect((await fetch(`${base}/auth/me`, { headers: importedAuth })).status, 'getMe stays reachable').toBe(200);
    },
  );
});
