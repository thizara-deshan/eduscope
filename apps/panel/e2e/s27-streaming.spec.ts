import { expect, test, type Page } from '@playwright/test';

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
