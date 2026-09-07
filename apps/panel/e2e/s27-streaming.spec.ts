import { expect, test, type Page } from '@playwright/test';
import { REAL_STACK_ACCOUNTS, expect as realExpect, test as realTest } from './fixtures/real-stack.js';

const SOURCES_ONLINE = {
  publishers: {
    usb: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
    rtsp: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
    rtsp2: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
    audio: { state: 'online', bound: true, fps: null, rms: 0.4, lastError: null },
  },
  consumers: [{ id: 'record:00000001', state: 'running', pgid: 7101 }],
} as const;

async function signInAs(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log In' }).click();
  await expect(page).toHaveURL('/');
}

async function signInLecturer(page: Page) {
  await signInAs(page, 'a.perera', 'correct-horse');
}

async function signInAdmin(page: Page) {
  await signInAs(page, 'admin', 'battery-staple');
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

async function dismissAlerts(page: Page) {
  const ack = page.getByRole('button', { name: /^Acknowledge/ });
  if (await ack.isVisible().catch(() => false)) await ack.click();
}

async function closeKeyboard(page: Page) {
  const close = page.getByRole('button', { name: 'Close keyboard' });
  if (await close.isVisible().catch(() => false)) await close.click();
}

async function goStreaming(page: Page) {
  await page.getByRole('button', { name: 'Show controls' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();
  await expect(page.getByTestId('advanced-shell')).toBeVisible();
  await page.getByRole('button', { name: 'Streaming Configuration' }).click();
  await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-27');
}

async function startRecording(page: Page) {
  await page.getByRole('button', { name: 'Start Recording' }).click();
  await expect(page.locator('[data-screen="S-05"]')).toBeVisible();
}

test.describe('S-27 Streaming Configuration', () => {
  test('primary/admin: edit the seeded target without exposing its key, set the idle default, then start streaming live', async ({ page }) => {
    await signInAdmin(page);
    await goStreaming(page);

    // Edit without exposing the stream key.
    await expect(page.getByText('Main YouTube Channel')).toBeVisible();
    await page.getByRole('button', { name: 'Edit' }).click();
    const form = page.getByTestId('stream-target-form');
    await expect(form.getByText(/Stream key.*Configured/)).toBeVisible();
    await expect(form.getByLabel(/Stream key/)).toHaveValue('');
    await form.getByLabel(/Stream key/).fill('replacement-key-999');
    await closeKeyboard(page);
    await form.getByRole('button', { name: /^Save$/ }).click();
    await expect(form).toHaveCount(0);

    // Idle default toggle.
    const toggle = page.getByRole('switch');
    await expect(toggle).toHaveAttribute('aria-label', 'Stream on next recording');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    // Go live and start streaming.
    await dismissAlerts(page);
    await page.getByRole('button', { name: 'Back to Dashboard' }).click();
    await startRecording(page);
    await page.getByRole('button', { name: 'Show controls' }).click();
    await page.getByRole('button', { name: 'Advanced' }).click();
    await page.getByRole('button', { name: 'Streaming Configuration' }).click();

    const liveToggle = page.getByRole('switch');
    await expect(liveToggle).toHaveAttribute('aria-label', 'Start streaming now');
    await liveToggle.click();
    await expect(page.getByTestId('streaming-state-word')).toHaveText(/Checking your destination|Starting|On/, { timeout: 1_000 });
    await expect(page.getByTestId('streaming-state-word')).toHaveText('On', { timeout: 5_000 });
    await expect(liveToggle).toHaveAttribute('aria-checked', 'true');
    await expect(liveToggle).toHaveAttribute('aria-label', 'Stop streaming now');

    await liveToggle.click();
    await expect(page.getByTestId('streaming-state-word')).toHaveText('Off', { timeout: 3_000 });
  });

  test('primary/lecturer: the page is reachable, the target endpoint is never called, and layout/default controls work', async ({ page }) => {
    await signInLecturer(page);
    await goStreaming(page);

    // The mock client has no real network layer to intercept — the absence
    // of any target UI (list/form/Add button) is the observable proof that
    // useStreamTargets never called listStreamTargets for this role.
    await expect(page.getByTestId('streaming-target-count')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add destination' })).toHaveCount(0);
    await expect(page.getByTestId('stream-target-form')).toHaveCount(0);
    await expect(page.getByTestId('stream-target-list')).toHaveCount(0);

    const picker = page.getByTestId('layout-preset-picker');
    await expect(picker.getByRole('button')).toHaveCount(5);
    await picker.getByRole('button', { name: /^Lecturer camera only/i }).click();
    await expect(picker.getByRole('button', { name: /^Lecturer camera only/i })).toHaveAttribute('aria-pressed', 'true');

    const toggle = page.getByRole('switch');
    await expect(toggle).toHaveAttribute('aria-label', 'Stream on next recording');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  test('failure: channel-failures reaches a named preflight failure while recording stays red, then restarts', async ({ page }) => {
    await signInAdmin(page);
    await configureWorld(page, { scenario: 'channel-failures' });
    await startRecording(page);
    await goStreaming(page);

    const toggle = page.getByRole('switch');
    await toggle.click();
    await expect(page.getByTestId('streaming-state-word')).toContainText('still recording', { timeout: 5_000 });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('[data-testid="recording-frame"]')).toBeVisible();

    // Recover: a failed consumer is acknowledged with disable (CH-10) first,
    // then a fresh enable reaches on for real (the second occurrence).
    await toggle.click();
    await expect(page.getByTestId('streaming-state-word')).toHaveText('Off', { timeout: 3_000 });
    await toggle.click();
    await expect(page.getByTestId('streaming-state-word')).toHaveText('On', { timeout: 5_000 });

    // Simulate a consumer exit via the dev transport strip.
    await openScenarioOverlay(page);
    const restartButton = page.getByTestId('dev-streaming-consumer-exited');
    await expect(restartButton).toBeEnabled();
    await restartButton.click();
    await page.getByRole('button', { name: /close scenarios/i }).click();
    await expect(page.getByTestId('streaming-state-word')).toHaveText('Restarting…', { timeout: 2_000 });
    await expect(page.getByTestId('streaming-state-word')).toHaveText('On', { timeout: 3_000 });
  });

  test('save failure: transport delay, then a named 422, then success', async ({ page }) => {
    await signInAdmin(page);
    await configureWorld(page, { scenario: 'channel-failures' });
    await goStreaming(page);

    await page.getByRole('button', { name: 'Add destination' }).click();
    const form = page.getByTestId('stream-target-form');
    await form.getByLabel('Display name').fill('Backup');
    await form.getByLabel('Ingest URL').fill('rtmp://b.example/live');
    await form.getByLabel(/Stream key/).fill('k1');
    await closeKeyboard(page);
    await form.getByRole('button', { name: /^Save$/ }).click();
    // First occurrence: 1.2 s transport delay, then a generic (unnamed) failure.
    await expect(form.getByRole('button', { name: /Saving…/ })).toBeVisible();
    await expect(page.getByText('This could not be saved.')).toBeVisible({ timeout: 3_000 });

    // Second occurrence: the named 422.
    await form.getByRole('button', { name: /^Save$/ }).click();
    await expect(page.getByText('The streaming destination rejected these settings.')).toBeVisible({ timeout: 3_000 });

    // Third occurrence: succeeds.
    await form.getByRole('button', { name: /^Save$/ }).click();
    await expect(form).toHaveCount(0, { timeout: 3_000 });
    await expect(page.getByText('Backup')).toBeVisible();
  });

  test('empty: World No streaming destinations configured renders the explanatory empty state', async ({ page }) => {
    await signInAdmin(page);
    await configureWorld(page, { worldLabel: 'No streaming destinations configured' });
    await goStreaming(page);
    await expect(page.getByTestId('stream-targets-empty')).toBeVisible();
  });

  test('secret regression: no seeded or replacement key, and no fake masked value, ever appears in the DOM', async ({ page }) => {
    await signInAdmin(page);
    await goStreaming(page);
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByTestId('stream-target-form').getByLabel(/Stream key/).fill('super-secret-value');

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('super-secret-value');
    expect(bodyText).not.toMatch(/mock-stream-key|\*{4,}|•{4,}/);
  });

  test('geometry: platform chips and Paste are >=44px and the key field is not truncated', async ({ page }) => {
    await signInAdmin(page);
    await goStreaming(page);
    await page.getByRole('button', { name: 'Add destination' }).click();
    const form = page.getByTestId('stream-target-form');

    for (const chip of await form.getByRole('button', { name: /YouTube|Facebook|Custom RTMP/ }).all()) {
      const box = await chip.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    const paste = form.getByRole('button', { name: 'Paste' });
    const pasteBox = await paste.boundingBox();
    expect(pasteBox!.height).toBeGreaterThanOrEqual(44);

    const keyField = form.getByLabel(/Stream key/);
    expect(await keyField.evaluate((el) => getComputedStyle(el).textOverflow)).not.toBe('ellipsis');

    const panelOverflow = await page.evaluate(() => {
      const panel = document.querySelector('.us-panel') as HTMLElement;
      return panel.scrollHeight - panel.clientHeight;
    });
    expect(panelOverflow).toBeLessThanOrEqual(1);
  });
});

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

realTest.describe('S-27 Streaming Configuration — real', () => {
  realTest(
    'real: write-only keys never leak, and a failing relay activates exactly the enabled targets while local recording stays live',
    { annotation: { type: 'adapter', description: 'real' } },
    async ({ page, realStack }) => {
      realTest.setTimeout(90_000);
      await routeRealConfig(page, realStack);
      await realStack.control('core.pm.status', { status: SOURCES_ONLINE });

      const base = realStack.coreBaseUrl;
      const login = await fetch(`${base}/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...REAL_STACK_ACCOUNTS.admin, client: 'panel' }),
      });
      const { tokens } = await login.json() as { tokens: { accessToken: string } };
      const auth = { authorization: `Bearer ${tokens.accessToken}` };
      const jsonAuth = { 'content-type': 'application/json', ...auth };

      // --- Create YouTube / Facebook / custom targets with distinct secrets ---
      const SECRETS = {
        youtube: 'yt-secret-KEY-1111',
        facebook: 'fb-secret-KEY-2222',
        'custom-rtmp': 'custom-secret-KEY-3333',
      } as const;
      const created: Record<string, string> = {};
      for (const [platform, streamKey] of Object.entries(SECRETS)) {
        const ingestUrl = platform === 'custom-rtmp'
          ? 'rtmp://ingest.example.edu/live'
          : platform === 'youtube'
            ? 'rtmps://a.rtmp.youtube.com/live2'
            : 'rtmps://live-api-s.facebook.com:443/rtmp';
        const res = await fetch(`${base}/settings/stream-targets`, {
          method: 'POST', headers: jsonAuth,
          body: JSON.stringify({ platform, displayName: `E20 ${platform}`, ingestUrl, streamKey }),
        });
        realExpect(res.status, `create ${platform}`).toBe(201);
        const bodyText = await res.text();
        // Write-only: the create response never echoes the secret back.
        realExpect(bodyText, `${platform} secret in create response`).not.toContain(streamKey);
        created[platform] = (JSON.parse(bodyText) as { id: string }).id;
      }

      // The list endpoint never returns any secret either.
      const listText = await (await fetch(`${base}/settings/stream-targets`, { headers: auth })).text();
      for (const secret of Object.values(SECRETS)) realExpect(listText).not.toContain(secret);

      // --- The real screen renders the targets without exposing any key ---
      await page.goto('/login');
      await page.getByLabel('Username').fill(REAL_STACK_ACCOUNTS.admin.username);
      await page.getByLabel('Password').fill(REAL_STACK_ACCOUNTS.admin.password);
      await page.getByRole('button', { name: 'Log In' }).click();
      await realExpect(page).toHaveURL('/');
      await page.getByRole('button', { name: 'Show controls' }).click();
      await page.getByRole('button', { name: 'Advanced' }).click();
      await page.getByRole('button', { name: 'Streaming Configuration' }).click();
      await realExpect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-27');
      await realExpect(page.getByText('E20 youtube')).toBeVisible();
      const dom = await page.locator('body').innerText();
      for (const secret of Object.values(SECRETS)) realExpect(dom, 'secret in DOM').not.toContain(secret);

      // --- Enable an exact subset (YouTube + Facebook, not custom) ---
      const enabled = [created.youtube, created.facebook];
      const setStreaming = await fetch(`${base}/channels/streaming`, {
        method: 'PUT', headers: jsonAuth, body: JSON.stringify({ streamTargetIds: enabled }),
      });
      realExpect(setStreaming.status).toBe(200);

      // --- Start a real local recording, then fail the relay reload ---
      const start = await fetch(`${base}/recording/start`, { method: 'POST', headers: auth });
      realExpect(start.status).toBe(202);
      await realStack.control('core.pm.publish', {
        event: 'evt.pm.consumer.running', data: { consumerId: 'record:00000001', pgid: 7101 },
      });
      await realExpect.poll(async () => {
        const state = await (await fetch(`${base}/recording/state`, { headers: auth })).json() as { state: string };
        return state.state;
      }).toBe('recording');

      await realStack.control('core.relay', { fail: true });
      const enableStream = await fetch(`${base}/channels/streaming/enable`, { method: 'POST', headers: auth });
      realExpect(enableStream.status).toBe(202);

      // Streaming fails on the relay activation...
      await realExpect.poll(async () => {
        const { items } = await (await fetch(`${base}/channels`, { headers: auth })).json() as {
          items: Array<{ status: { channelId: string; state: string } }>;
        };
        return items.find((item) => item.status.channelId === 'streaming')!.status.state;
      }, { timeout: 15_000 }).toBe('failed');

      // ...while the local recording is completely undisturbed.
      const recording = await (await fetch(`${base}/recording/state`, { headers: auth })).json() as { state: string };
      realExpect(recording.state, 'local recording stays live through the streaming failure').toBe('recording');

      // The relay peer received an activation for EXACTLY the enabled set, and
      // no secret ever reached the ledger/log.
      const ledger = await realStack.ledger();
      const activations = (ledger.relay as Array<{ action: string; streamTargetIds?: string[] }>)
        .filter((call) => call.action === 'activate');
      realExpect(activations.length).toBeGreaterThanOrEqual(1);
      realExpect([...activations.at(-1)!.streamTargetIds!].sort()).toEqual([...enabled].sort());
      const ledgerText = JSON.stringify(ledger);
      for (const secret of Object.values(SECRETS)) realExpect(ledgerText, 'secret in ledger/log').not.toContain(secret);
    },
  );
});
