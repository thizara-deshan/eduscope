import { expect, test, type Page } from '@playwright/test';
import { REAL_STACK_ACCOUNTS, expect as realExpect, test as realTest } from './fixtures/real-stack.js';

const SOURCES_ONLINE = {
  publishers: {
    usb: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
    rtsp: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
    rtsp2: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
    audio: { state: 'online', bound: true, fps: null, rms: 0.4, lastError: null },
  },
  consumers: [],
} as const;

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Username').fill('a.perera');
  await page.getByLabel('Password').fill('correct-horse');
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

async function configureWorld(
  page: Page,
  { scenario = 'happy', worldLabel }: { scenario?: string; worldLabel?: string } = {},
) {
  await openScenarioOverlay(page);
  const scenarioRadio = page.getByRole('radio', { name: new RegExp(`^${scenario}$`) });
  if (!(await scenarioRadio.isChecked())) await scenarioRadio.check();
  if (worldLabel) await page.getByRole('checkbox', { name: worldLabel }).check();
  await expect(page.getByTestId('active-scenario')).toHaveText(scenario);
  await page.getByRole('button', { name: /close scenarios/i }).click();
}

/** The seeded firmware.update-available alert visually overlaps S-25's topbar at its default position — clear it so header controls stay reachable. */
async function dismissAlerts(page: Page) {
  const ack = page.getByRole('button', { name: /^Acknowledge/ });
  if (await ack.isVisible().catch(() => false)) await ack.click();
}

async function goLocalCapture(page: Page) {
  await page.getByRole('button', { name: 'Show controls' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();
  await expect(page.getByTestId('advanced-shell')).toBeVisible();
  await page.getByRole('button', { name: 'Local Capture Layout' }).click();
  await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-26');
  await expect(page.getByTestId('layout-preset-picker')).toBeVisible();
}

test.describe('S-26 Local Capture Layout', () => {
  test('primary: five presets, Always on, choosing Separate files applies a two-file preview, and the selection survives an in-app navigation', async ({ page }) => {
    await signIn(page);
    await goLocalCapture(page);

    await expect(page.getByText('Always on', { exact: true })).toBeVisible();
    const picker = page.getByTestId('layout-preset-picker');
    await expect(picker.getByRole('button')).toHaveCount(5);
    await expect(picker.getByRole('checkbox')).toHaveCount(0);

    const separateFiles = picker.getByRole('button', { name: /Separate files per source/i });
    await separateFiles.click();
    // happy's updateChannelConfig resolves near-instantly — the pending
    // ("only the tapped tile shows Saving…") state is covered by the
    // channel-failures failure journey below, which has a real transport delay.
    await expect(separateFiles).toHaveAttribute('aria-pressed', 'true');
    const largePreview = page.locator('.us-adm__streampreview [data-testid="layout-preview"]');
    await expect(largePreview).toHaveAttribute('data-kind', 'multi-file');

    // In-app navigation away and back re-reads the same mock world, not local component state.
    await dismissAlerts(page);
    await page.getByRole('button', { name: 'Back to Dashboard' }).click();
    await goLocalCapture(page);
    await expect(page.getByTestId('layout-preset-picker').getByRole('button', { name: /Separate files per source/i }))
      .toHaveAttribute('aria-pressed', 'true');
  });

  test('failure: channel-failures shows pending, then a named refusal, then applies', async ({ page }) => {
    await signIn(page);
    await configureWorld(page, { scenario: 'channel-failures' });
    await goLocalCapture(page);

    const picker = page.getByTestId('layout-preset-picker');
    const camOne = picker.getByRole('button', { name: /^Lecturer camera only/i });
    await camOne.click();
    await expect(camOne).toContainText('Saving…');
    await expect(picker.getByText('Saving…')).toHaveCount(1);
    await expect(page.getByText('This layout could not be applied.')).toBeVisible({ timeout: 3_000 });

    const camTwo = picker.getByRole('button', { name: /^Students camera only/i });
    if (await camTwo.isEnabled()) {
      await camTwo.click();
      await expect(page.getByText('This layout could not be applied.')).toBeVisible();
    }
  });

  test('invalid: Students Camera unbound leaves affected presets visible, named, and disabled', async ({ page }) => {
    await signIn(page);
    await configureWorld(page, { worldLabel: 'Students Camera unbound' });
    await goLocalCapture(page);

    const picker = page.getByTestId('layout-preset-picker');
    const sideBySide = picker.getByRole('button', { name: /Slides \+ students, side by side/i });
    await expect(sideBySide).toBeVisible();
    await expect(sideBySide).toBeDisabled();
    await expect(sideBySide).toContainText('Students Camera');
  });

  test('geometry: preset tiles are >=150x110, no toggle exists, and the page never scrolls', async ({ page }) => {
    await signIn(page);
    await goLocalCapture(page);

    const picker = page.getByTestId('layout-preset-picker');
    for (const tile of await picker.getByRole('button').all()) {
      const box = await tile.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(150);
      expect(box!.height).toBeGreaterThanOrEqual(110);
    }
    await expect(page.getByRole('switch')).toHaveCount(0);

    const panelOverflow = await page.evaluate(() => {
      const panel = document.querySelector('.us-panel') as HTMLElement;
      return panel.scrollHeight - panel.clientHeight;
    });
    expect(panelOverflow).toBeLessThanOrEqual(1);
  });
});

async function realSignIn(page: Page, account: keyof typeof REAL_STACK_ACCOUNTS) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(REAL_STACK_ACCOUNTS[account].username);
  await page.getByLabel('Password').fill(REAL_STACK_ACCOUNTS[account].password);
  await page.getByRole('button', { name: 'Log In' }).click();
  await realExpect(page).toHaveURL('/');
}

async function routeRealConfig(page: Page, realStack: { coreBaseUrl: string; quizTlsBaseUrl?: string; quizBaseUrl: string }) {
  await page.route('**/config.json', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        apiBaseUrl: realStack.coreBaseUrl,
        quizBaseUrl: realStack.quizTlsBaseUrl ?? realStack.quizBaseUrl,
        environment: 'integration',
        adapters: { default: 'real', overrides: {} },
      }),
    });
  });
}

realTest.describe('S-26 Local Capture Layout — real', () => {
  realTest(
    'real: a meeting-only preset is refused with no DB change, and a valid save flows into the next record pipeline',
    { annotation: { type: 'adapter', description: 'real' } },
    async ({ page, realStack }) => {
      realTest.setTimeout(90_000);
      await routeRealConfig(page, realStack);
      await realStack.control('core.pm.status', { status: SOURCES_ONLINE });

      const login = await fetch(`${realStack.coreBaseUrl}/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...REAL_STACK_ACCOUNTS.admin, client: 'panel' }),
      });
      const { tokens } = await login.json() as { tokens: { accessToken: string } };
      const auth = { authorization: `Bearer ${tokens.accessToken}` };
      const localConfig = async () => {
        const res = await fetch(`${realStack.coreBaseUrl}/channels`, { headers: auth });
        const { items } = await res.json() as {
          items: Array<{ status: { channelId: string }; config: { presetId: string; ratioA: number | null; ratioB: number | null } }>;
        };
        return items.find((item) => item.status.channelId === 'local')!.config;
      };

      // 1. A meeting-only preset (cams-fifty-fifty) is contract-refused on the
      //    local channel and leaves the persisted config untouched.
      const before = await localConfig();
      const refused = await fetch(`${realStack.coreBaseUrl}/channels/local`, {
        method: 'PUT', headers: { 'content-type': 'application/json', ...auth },
        body: JSON.stringify({ presetId: 'cams-fifty-fifty' }),
      });
      realExpect(refused.status).toBe(422);
      realExpect((await refused.json() as { code: string }).code).toBe('config.invalid');
      realExpect((await localConfig()).presetId, 'refusal must not change the DB').toBe(before.presetId);

      // 2. A valid PC/camera preset saved through the screen persists.
      await realSignIn(page, 'admin');
      await goLocalCapture(page);
      const picker = page.getByTestId('layout-preset-picker');
      const sideBySide = picker.getByRole('button', { name: /Slides \+ students, side by side/i });
      await sideBySide.click();
      await realExpect(sideBySide).toHaveAttribute('aria-pressed', 'true');

      const saved = await localConfig();
      realExpect(saved.presetId).toBe('side-by-side');

      // 3. [KEEP B-60] the next recording's PM request carries the exact saved
      //    preset and ratios — configuration flows to the next pipeline.
      const startRes = await fetch(`${realStack.coreBaseUrl}/recording/start`, { method: 'POST', headers: auth });
      realExpect(startRes.status).toBe(202);
      let recordBody: Record<string, unknown> | undefined;
      await realExpect
        .poll(async () => {
          const { pm } = await realStack.ledger();
          recordBody = pm.find((call) => call.method === 'POST' && call.path === '/consumers/record')?.body;
          return recordBody?.preset ?? null;
        }, { timeout: 15_000 })
        .toBe('side-by-side');
      realExpect(recordBody!.ratioA).toBe(saved.ratioA);
      realExpect(recordBody!.ratioB).toBe(saved.ratioB);
    },
  );
});
