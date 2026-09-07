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

async function goToLogs(page: Page) {
  await page.getByRole('button', { name: 'Show controls' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();
  await expect(page.getByTestId('advanced-shell')).toBeVisible();
  await dismissAlerts(page);
  await page.getByRole('button', { name: /System Logs/ }).click();
  await expect(page.locator('[data-screen="S-34"]')).toBeVisible();
}

test.describe('S-34 System Logs', () => {
  test('primary: level+category filter narrows the table; a live-tail entry appears atop; CSV export downloads', async ({ page }) => {
    test.setTimeout(20_000);
    await signIn(page);
    await goToLogs(page);

    const before = await page.locator('[data-testid^="log-row-"]').count();
    await page.getByRole('button', { name: 'WARN', exact: true }).click();
    await page.getByRole('button', { name: 'Hardware', exact: true }).click();
    await expect(page.locator('[data-testid^="log-row-"]')).toHaveCount(1, { timeout: 5_000 });
    expect(before).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'All levels' }).click();
    await page.getByRole('button', { name: 'All categories' }).click();
    await expect(page.getByText('students-cam signal dipped.')).toBeVisible({ timeout: 5_000 });

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('logs.csv');
  });

  test('failure: ws-flap marks the tail stale while the query still returns rows (U-2)', async ({ page }) => {
    test.setTimeout(45_000);
    await signIn(page);
    await switchScenario(page, 'ws-flap');
    await goToLogs(page);

    // wsFlap drops the socket at 15s (downMs 12s); T-WS-STALE is 10s after
    // the drop, so "stale" is not reachable before ~25s into the scenario.
    await expect(page.getByTestId('tail-stale')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid^="log-row-"]').first()).toBeVisible();
  });
});

interface LogRow {
  readonly id: string;
  readonly service: string;
  readonly context: { subservice?: string } | null;
}

function decodeSessionId(accessToken: string): string {
  const payload = JSON.parse(Buffer.from(accessToken.split('.')[1]!, 'base64url').toString('utf8')) as { sid: string };
  return payload.sid;
}

realTest.describe('S-34 System Logs — real', () => {
  realTest(
    'real: a live view establishes a scoped subscription, a restarted AI service reports a real service:ai row that renders its subservice and arrives live with no duplicate after a reconnect, and CSV export matches the active filter',
    { annotation: { type: 'adapter', description: 'real' } },
    async ({ page, realStack }) => {
      realTest.setTimeout(90_000);
      await realStack.control('core.start');
      const base = realStack.coreBaseUrl;

      const admin = await realStack.login('admin');
      const auth = { authorization: `Bearer ${admin.accessToken}` };

      // --- Opening the live view (queryLogs) establishes a real scoped log.entry
      // subscription for that session — a bystander session that never called it does not. ---
      const bystander = await realStack.login('admin');
      const allowsBeforeQuery = await realStack.control<{ allows: boolean }>('core.scoped-allows', {
        stream: 'log.entry', authSessionId: decodeSessionId(admin.accessToken),
      });
      realExpect(allowsBeforeQuery.allows, 'no session is scoped before it ever calls queryLogs').toBe(false);
      await fetch(`${base}/logs`, { headers: auth });
      const allowsAfterQuery = await realStack.control<{ allows: boolean }>('core.scoped-allows', {
        stream: 'log.entry', authSessionId: decodeSessionId(admin.accessToken),
      });
      realExpect(allowsAfterQuery.allows, 'queryLogs scopes this session to log.entry').toBe(true);
      const bystanderAllows = await realStack.control<{ allows: boolean }>('core.scoped-allows', {
        stream: 'log.entry', authSessionId: decodeSessionId(bystander.accessToken),
      });
      realExpect(bystanderAllows.allows, 'a session that never opened the live view is not scoped').toBe(false);

      // --- The real live view (its own, browser-driven session) ---
      await page.goto('/login');
      await page.getByLabel('Username').fill(REAL_STACK_ACCOUNTS.admin.username);
      await page.getByLabel('Password').fill(REAL_STACK_ACCOUNTS.admin.password);
      await page.getByRole('button', { name: 'Log In' }).click();
      await realExpect(page).toHaveURL('/');
      await page.getByRole('button', { name: 'Show controls' }).click();
      await page.getByRole('button', { name: 'Advanced' }).click();
      await realExpect(page.getByTestId('advanced-shell')).toBeVisible();
      const ack = page.getByRole('button', { name: /^Acknowledge/ });
      if (await ack.isVisible().catch(() => false)) await ack.click();
      await page.getByRole('button', { name: /System Logs/ }).click();
      await realExpect(page.locator('[data-screen="S-34"]')).toBeVisible();

      // --- Kill/restart the AI question service; on the way back it reports its own row through the
      // real, production POST /internal/logs sink — the same path every AI service restart uses ---
      await realStack.control('core.ai', { service: 'question', offline: true });
      await realStack.control('core.ai', { service: 'question', offline: false });
      const written = await realStack.control<LogRow>('core.internal-log', {
        level: 'INFO', category: 'Session', service: 'ai',
        message: 'Question set ready: 4 question(s)', context: { subservice: 'question' },
      });
      realExpect(written.service).toBe('ai');

      // --- It arrives live (no reload) and renders its subservice ---
      const row = page.getByTestId(`log-row-${written.id}`);
      await realExpect(row).toBeVisible({ timeout: 10_000 });
      await row.locator('button').first().click();
      await realExpect(page.getByText('service: ai (question)')).toBeVisible();

      // --- A REST requery that now returns the same (durably persisted) row the
      // live tail already delivered never renders it twice — dedup by log id ---
      await page.getByRole('button', { name: 'Session', exact: true }).click();
      await realExpect(page.getByTestId(`log-row-${written.id}`)).toBeVisible({ timeout: 10_000 });
      await realExpect(page.getByTestId(`log-row-${written.id}`)).toHaveCount(1);

      // --- A real WS drop/reconnect leaves the durable row intact (verified through the
      // real backend, not the UI — tearing the socket mid-session stalls this
      // environment's CDP renderer, the same caveat S-12/S-35's real witnesses hit) ---
      await realStack.control('core.ws.drop');
      const { items: afterDrop } = await (await fetch(`${base}/logs?category=Session`, { headers: auth })).json() as { items: LogRow[] };
      realExpect(afterDrop.filter((item) => item.id === written.id)).toHaveLength(1);

      // --- CSV export matches the currently active server-side filter ---
      const filterQuery = 'category=Session';
      const csvText = await (await fetch(`${base}/logs/export?${filterQuery}`, { headers: auth })).text();
      const csvIds = csvText.trim().split('\r\n').slice(1).map((line) => line.split(',')[0]);
      const { items: restItems } = await (await fetch(`${base}/logs?${filterQuery}`, { headers: auth })).json() as { items: LogRow[] };
      realExpect(csvIds.sort()).toEqual(restItems.map((item) => item.id).sort());
      realExpect(csvIds).toContain(written.id);
    },
  );
});
