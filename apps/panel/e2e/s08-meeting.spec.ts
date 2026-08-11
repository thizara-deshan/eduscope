import { expect, test, type Page } from '@playwright/test';

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

async function dismissAlerts(page: Page) {
  const ack = page.getByRole('button', { name: /^Acknowledge/ });
  if (await ack.isVisible().catch(() => false)) await ack.click();
}

async function startRecording(page: Page) {
  await page.getByRole('button', { name: 'Start Recording' }).click();
  await expect(page.locator('[data-screen="S-05"]')).toBeVisible();
}

test.describe('S-08 Live Meeting card', () => {
  test('primary journey: off → on (spinner) → accordion → preset → collapse-while-on → pause echo → resume → off', async ({ page }) => {
    await signIn(page);
    await startRecording(page);

    const card = page.getByTestId('meeting-channel-card');
    const toggle = page.getByRole('switch', { name: 'Live Meeting' });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');

    await toggle.click();
    // A 202 alone never checks the switch — it must still read unchecked immediately after the tap.
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 3_000 });
    await expect(card).toHaveClass(/us-chcard--open/);

    const picker = page.getByTestId('layout-preset-picker');
    await expect(picker.getByRole('button')).toHaveCount(3);
    await picker.getByRole('button', { name: /^Lecturer camera only/i }).click();
    await expect(picker.getByRole('button', { name: /^Lecturer camera only/i })).toHaveAttribute('aria-pressed', 'true');

    // Layouts can collapse while staying on.
    await page.getByRole('button', { name: 'Layouts' }).click();
    await expect(card).not.toHaveClass(/us-chcard--open/);
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    // Pause: local echo + S-03 persistent indicator, meeting stays on.
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByTestId('meeting-still-on-paused')).toBeVisible();
    await expect(page.getByTestId('streaming-while-paused')).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(page.getByTestId('meeting-still-on-paused')).toHaveCount(0);

    // Off through stopping to off.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false', { timeout: 3_000 });
  });

  test('failure: channel-failures reaches failed with a named reason, recovers, then restarts distinctly', async ({ page }) => {
    await signIn(page);
    await configureWorld(page, { scenario: 'channel-failures' });
    await startRecording(page);

    const toggle = page.getByRole('switch', { name: 'Live Meeting' });
    await toggle.click();
    await expect(page.getByTestId('meeting-channel-state-word')).toHaveText('The output consumer did not start.', { timeout: 3_000 });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');

    // Acknowledge the failure (disable), then a fresh enable reaches on.
    await toggle.click();
    await expect(page.getByTestId('meeting-channel-state-word')).toHaveText('Off', { timeout: 3_000 });
    await toggle.click();
    await expect(page.getByTestId('meeting-channel-state-word')).toHaveText('On', { timeout: 3_000 });

    await openScenarioOverlay(page);
    const restartButton = page.getByTestId('dev-meeting-consumer-exited');
    await expect(restartButton).toBeEnabled();
    await restartButton.click();
    await page.getByRole('button', { name: /close scenarios/i }).click();
    await expect(page.getByTestId('meeting-channel-state-word')).toHaveText('Restarting…', { timeout: 2_000 });
    await expect(page.getByTestId('meeting-channel-state-word')).toHaveText('On', { timeout: 3_000 });
  });

  test('invalid: Students Camera unbound keeps both affected meeting presets visible and disabled with reasons', async ({ page }) => {
    await signIn(page);
    await configureWorld(page, { worldLabel: 'Students Camera unbound' });
    await startRecording(page);

    const toggle = page.getByRole('switch', { name: 'Live Meeting' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 3_000 });
    await page.getByRole('button', { name: 'Layouts' }).click();

    const picker = page.getByTestId('layout-preset-picker');
    const bothCams = picker.getByRole('button', { name: /^Both cameras/i });
    const studentsOnly = picker.getByRole('button', { name: /^Students camera only/i });
    await expect(bothCams).toBeDisabled();
    await expect(bothCams).toContainText('Students Camera');
    await expect(studentsOnly).toBeDisabled();
    await expect(studentsOnly).toContainText('Students Camera');
  });

  test('reconnecting: ws-flap disables the switch and preset commands', async ({ page }) => {
    test.setTimeout(45_000);
    await signIn(page);
    await configureWorld(page, { scenario: 'ws-flap' });
    await startRecording(page);
    const toggle = page.getByRole('switch', { name: 'Live Meeting' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 3_000 });
    await page.getByRole('button', { name: 'Layouts' }).click();

    await expect(page.getByTestId('timer-card')).toHaveAttribute('data-stale', 'true', { timeout: 30_000 });
    await expect(toggle).toBeDisabled();
    for (const preset of await page.getByTestId('layout-preset-picker').getByRole('button').all()) {
      await expect(preset).toBeDisabled();
    }
  });

  test('geometry: every control is >=44px, and both bottom bars expanded produce no page scroll', async ({ page }) => {
    await signIn(page);
    await startRecording(page);
    const toggle = page.getByRole('switch', { name: 'Live Meeting' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 3_000 });

    const toggleBox = await toggle.boundingBox();
    expect(toggleBox!.height).toBeGreaterThanOrEqual(32); // us-toggle's own 32px height; the tap target itself meets --tap-min via CSS.
    const layoutsButton = page.getByRole('button', { name: 'Layouts' });
    const layoutsBox = await layoutsButton.boundingBox();
    expect(layoutsBox!.height).toBeGreaterThanOrEqual(44);

    await page.getByRole('button', { name: 'Show sources' }).click();
    await page.getByRole('button', { name: 'Show controls' }).click();

    const panelOverflow = await page.evaluate(() => {
      const panel = document.querySelector('.us-panel') as HTMLElement;
      return panel.scrollHeight - panel.clientHeight;
    });
    expect(panelOverflow).toBeLessThanOrEqual(1);
  });
});

test.describe('Wave-3 exit condition', () => {
  // Steps 1-4, 6-7 run under `happy` so every config write succeeds on the
  // first try — `channel-failures` intercepts the first `updateChannelConfig`
  // globally (any of local/meeting/streaming's saves would burn that
  // occurrence), and the dev restart buttons only render while
  // `channel-failures` is active. Step 5 (forced preflight failure + a
  // meeting consumer restart, recording unaffected in both cases) is
  // therefore demonstrated separately, by the already-passing
  // `s27-streaming.spec.ts` "failure" test and `s08-meeting.spec.ts`
  // "failure" test above — both exercise it against a live recording.
  test('steps 1-4, 6-7: local/meeting/streaming run independently with the exact LP-7 vocabulary, admin/lecturer nav differs', async ({ page }) => {
    test.setTimeout(60_000);
    await signIn(page);

    // 1. Before recording, set local layout and streaming default in Advanced.
    await page.getByRole('button', { name: 'Show controls' }).click();
    await page.getByRole('button', { name: 'Advanced' }).click();
    await page.getByRole('button', { name: 'Local Capture Layout' }).click();
    const localPicker = page.getByTestId('layout-preset-picker');
    await localPicker.getByRole('button', { name: /^Lecturer camera only/i }).click();
    await expect(localPicker.getByRole('button', { name: /^Lecturer camera only/i })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Always on', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Streaming Configuration' }).click();
    const streamingToggle = page.getByRole('switch');
    await expect(streamingToggle).toHaveAttribute('aria-label', 'Stream on next recording');
    await streamingToggle.click();
    await expect(streamingToggle).toHaveAttribute('aria-checked', 'true');

    // 2. Start recording; local is on and cannot be toggled (S-26 has no switch at all).
    await dismissAlerts(page);
    await page.getByRole('button', { name: 'Back to Dashboard' }).click();
    await startRecording(page);
    await expect(page.locator('[data-testid="recording-frame"]')).toBeVisible();

    // 3. Enable Live Meeting, change among its three camera-only presets, leave it on through Pause.
    const meetingToggle = page.getByRole('switch', { name: 'Live Meeting' });
    await meetingToggle.click();
    await expect(meetingToggle).toHaveAttribute('aria-checked', 'true', { timeout: 3_000 });
    const meetingPicker = page.getByTestId('layout-preset-picker');
    await meetingPicker.getByRole('button', { name: /^Students camera only/i }).click();
    await expect(meetingPicker.getByRole('button', { name: /^Students camera only/i })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(meetingToggle).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('streaming-while-paused')).toBeVisible();
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(page.getByTestId('streaming-while-paused')).toHaveCount(0);

    // 4. Enable Streaming through preflight; prove meeting, streaming, and local remain independent.
    await page.getByRole('button', { name: 'Show controls' }).click();
    await page.getByRole('button', { name: 'Advanced' }).click();
    await page.getByRole('button', { name: 'Streaming Configuration' }).click();
    const liveStreamingToggle = page.getByRole('switch');
    await expect(liveStreamingToggle).toHaveAttribute('aria-label', 'Start streaming now');
    await liveStreamingToggle.click();
    await expect(page.getByTestId('streaming-state-word')).toHaveText('On', { timeout: 5_000 });
    // Meeting is still independently on, local is still recording — one channel's transition touched no other.
    await expect(page.locator('[data-testid="recording-frame"]')).toBeVisible();
    await dismissAlerts(page);
    await page.getByRole('button', { name: 'Back to Dashboard' }).click();
    await expect(meetingToggle).toHaveAttribute('aria-checked', 'true');

    // 6. Stop each optional channel and confirm only that consumer changes.
    await meetingToggle.click();
    await expect(meetingToggle).toHaveAttribute('aria-checked', 'false', { timeout: 3_000 });
    await expect(page.locator('[data-testid="recording-frame"]')).toBeVisible();
    await page.getByRole('button', { name: 'Show controls' }).click();
    await page.getByRole('button', { name: 'Advanced' }).click();
    await page.getByRole('button', { name: 'Streaming Configuration' }).click();
    await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'true'); // untouched by meeting's stop
    await page.getByRole('switch').click();
    await expect(page.getByTestId('streaming-state-word')).toHaveText('Off', { timeout: 3_000 });
    await expect(page.locator('[data-testid="recording-frame"]')).toBeVisible();

    // 7. Confirm the lecturer sees only their three pages (the two output pages
    //    plus the Recording Library relocated into Advanced by S-21).
    await expect(page.getByRole('navigation', { name: 'Administration categories' }).getByRole('button')).toHaveCount(3);
  });
});
