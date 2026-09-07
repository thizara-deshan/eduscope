import { expect, test, type Page } from '@playwright/test';
import { REAL_STACK_ACCOUNTS, expect as realExpect, test as realTest } from './fixtures/real-stack.js';

async function signIn(page: Page, username = 'admin', password = 'battery-staple') {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log In' }).click();
  await expect(page).toHaveURL('/');
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

test.describe('S-32 User Management', () => {
  test('primary: search narrows the directory; add a user; institute-owned fields are read-only on edit', async ({ page }) => {
    await signIn(page);
    await goToUsers(page);

    await page.getByLabel('Search users').fill('perera');
    await expect(page.getByTestId('user-row-a.perera')).toBeVisible();
    await expect(page.getByTestId('user-row-n.silva')).toHaveCount(0);
    await page.getByLabel('Search users').fill('');

    await page.getByRole('button', { name: 'Add user' }).click();
    await page.getByLabel('Username').fill('j.newlecturer');
    await page.getByLabel('Display name').fill('J. New Lecturer');
    await page.getByLabel('Password').fill('pw-temp-1');
    await page.getByRole('dialog').getByRole('button', { name: 'Add user' }).click();
    await expect(page.getByTestId('user-row-j.newlecturer')).toBeVisible({ timeout: 5_000 });

    await page.getByTestId('user-row-a.perera').getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByLabel('Display name')).toBeDisabled();
    await expect(page.getByLabel('Role')).toBeDisabled();
  });

  test('failure: deleting admin (self, last admin) is refused; creating a duplicate username 409s', async ({ page }) => {
    await signIn(page);
    await goToUsers(page);

    await page.getByTestId('user-row-admin').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('You cannot delete your own account.')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('button', { name: 'Add user' }).click();
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Display name').fill('Duplicate');
    await page.getByLabel('Password').fill('pw-temp-1');
    await page.getByRole('dialog').getByRole('button', { name: 'Add user' }).click();
    await expect(page.getByText('admin already exists')).toBeVisible({ timeout: 5_000 });
  });
});

interface UserRow {
  readonly id: string;
  readonly username: string;
  readonly role: string;
  readonly disabled: boolean;
}

realTest.describe('S-32 User Management — real', () => {
  realTest(
    'real: a lecturer is denied every admin surface, the sole admin cannot delete themself, and disabling a logged-in user revokes its active session',
    { annotation: { type: 'adapter', description: 'real' } },
    async ({ page, realStack }) => {
      realTest.setTimeout(90_000);
      await realStack.control('core.start');
      const base = realStack.coreBaseUrl;

      const loginAs = async (username: string, password: string): Promise<string> => {
        const response = await fetch(`${base}/auth/login`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username, password, client: 'panel' }),
        });
        const body = await response.json() as { tokens: { accessToken: string } };
        return body.tokens.accessToken;
      };
      const login = (account: keyof typeof REAL_STACK_ACCOUNTS): Promise<string> =>
        loginAs(REAL_STACK_ACCOUNTS[account].username, REAL_STACK_ACCOUNTS[account].password);

      // --- The full lecturer/admin role matrix: every users op is refused for a lecturer ---
      const lecturerAuth = { authorization: `Bearer ${await login('lecturer')}` };
      const lecturerJsonAuth = { 'content-type': 'application/json', ...lecturerAuth };
      const lecturerList = await fetch(`${base}/users`, { headers: lecturerAuth });
      realExpect(lecturerList.status).toBe(403);
      const lecturerCreate = await fetch(`${base}/users`, {
        method: 'POST', headers: lecturerJsonAuth, body: JSON.stringify({ username: 'e39-blocked', displayName: 'Blocked', role: 'lecturer', password: 'E39BlockedPass1!' }),
      });
      realExpect(lecturerCreate.status).toBe(403);
      // The role guard runs before any id lookup — a placeholder id is enough to prove the 403.
      const lecturerDelete = await fetch(`${base}/users/irrelevant-id`, { method: 'DELETE', headers: lecturerAuth });
      realExpect(lecturerDelete.status).toBe(403);

      // --- Admin surfaces are reachable ---
      const adminAuth = { authorization: `Bearer ${await login('admin')}` };
      const adminJsonAuth = { 'content-type': 'application/json', ...adminAuth };
      const { items: seededUsers } = await (await fetch(`${base}/users`, { headers: adminAuth })).json() as { items: UserRow[] };
      const adminId = seededUsers.find((u) => u.username === REAL_STACK_ACCOUNTS.admin.username)!.id;

      // --- The sole admin cannot delete their own account (last-admin/self refusal) ---
      const selfDelete = await fetch(`${base}/users/${adminId}`, { method: 'DELETE', headers: adminAuth });
      realExpect(selfDelete.status).toBe(409);
      const selfDeleteBody = await selfDelete.json() as { code: string };
      realExpect(selfDeleteBody.code).toBe('conflict');
      const stillThere = await (await fetch(`${base}/users`, { headers: adminAuth })).json() as { items: UserRow[] };
      realExpect(stillThere.items.some((u) => u.id === adminId && !u.disabled)).toBe(true);

      // --- Duplicate username is refused ---
      const duplicate = await fetch(`${base}/users`, {
        method: 'POST', headers: adminJsonAuth,
        body: JSON.stringify({ username: REAL_STACK_ACCOUNTS.lecturer.username, displayName: 'Duplicate', role: 'lecturer', password: 'E39DupePass1!' }),
      });
      realExpect(duplicate.status).toBe(409);

      // --- A second admin can delete an admin who is not the last one ---
      const created = await fetch(`${base}/users`, {
        method: 'POST', headers: adminJsonAuth,
        body: JSON.stringify({ username: 'e39-admin2', displayName: 'E39 Second Admin', role: 'admin', password: 'E39SecondAdminPass1!' }),
      });
      realExpect(created.status).toBe(201);
      const admin2Id = (await created.json() as { id: string }).id;
      const admin2Auth = { authorization: `Bearer ${await loginAs('e39-admin2', 'E39SecondAdminPass1!')}` };
      const admin2JsonAuth = { 'content-type': 'application/json', ...admin2Auth };
      // A freshly created account is forced through a password reset (same as
      // an accepted Excel import row) — clear it before this admin can reach
      // any other operation (guard.ts's RESET_ALLOWLIST is changePassword/getMe/logout only).
      const admin2Reset = await fetch(`${base}/auth/change-password`, {
        method: 'POST', headers: admin2JsonAuth, body: JSON.stringify({ currentPassword: 'E39SecondAdminPass1!', newPassword: 'E39SecondAdminPass2!' }),
      });
      realExpect(admin2Reset.status).toBe(204);

      const deleteFirstAdmin = await fetch(`${base}/users/${adminId}`, { method: 'DELETE', headers: admin2Auth });
      realExpect(deleteFirstAdmin.status).toBe(204);

      // --- Now the second admin is the sole remaining admin — deleting itself is refused ---
      const soleAdminSelfDelete = await fetch(`${base}/users/${admin2Id}`, { method: 'DELETE', headers: admin2Auth });
      realExpect(soleAdminSelfDelete.status).toBe(409);

      // --- Disabling a logged-in user revokes its active session on the very next authenticated request ---
      const targetCreate = await fetch(`${base}/users`, {
        method: 'POST', headers: admin2JsonAuth,
        body: JSON.stringify({ username: 'e39-target', displayName: 'E39 Target', role: 'lecturer', password: 'E39TargetPass1!' }),
      });
      realExpect(targetCreate.status).toBe(201);
      const targetId = (await targetCreate.json() as { id: string }).id;
      const staleAuth = { authorization: `Bearer ${await loginAs('e39-target', 'E39TargetPass1!')}` };
      realExpect((await fetch(`${base}/auth/me`, { headers: staleAuth })).status, 'the token is valid before disable').toBe(200);

      const disable = await fetch(`${base}/users/${targetId}`, {
        method: 'PATCH', headers: admin2JsonAuth, body: JSON.stringify({ disabled: true }),
      });
      realExpect(disable.status).toBe(200);

      const staleMe = await fetch(`${base}/auth/me`, { headers: staleAuth });
      realExpect(staleMe.status).toBe(401);
      const staleBody = await staleMe.json() as { code: string; meta?: { reason?: string } };
      realExpect(staleBody.code).toBe('auth.session-revoked');
      realExpect(staleBody.meta?.reason).toBe('admin');

      // --- The screen renders the real, current directory ---
      await page.goto('/login');
      await page.getByLabel('Username').fill('e39-admin2');
      await page.getByLabel('Password').fill('E39SecondAdminPass2!');
      await page.getByRole('button', { name: 'Log In' }).click();
      await realExpect(page).toHaveURL('/');
      await page.getByRole('button', { name: 'Show controls' }).click();
      await page.getByRole('button', { name: 'Advanced' }).click();
      const ack = page.getByRole('button', { name: /^Acknowledge/ });
      if (await ack.isVisible().catch(() => false)) await ack.click();
      await page.getByRole('button', { name: /User Management/ }).click();
      await realExpect(page.locator('[data-screen="S-32"]')).toBeVisible();
      await realExpect(page.getByTestId('user-row-e39-target')).toContainText('disabled');
    },
  );
});
