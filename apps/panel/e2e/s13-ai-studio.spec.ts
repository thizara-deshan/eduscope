import { expect, test, type Page } from '@playwright/test';
import { REAL_STACK_ACCOUNTS, expect as realExpect, test as realTest } from './fixtures/real-stack.js';

function sourcesOnline(consumers: ReadonlyArray<{ id: string; state: string; pgid: number }>) {
  return {
    publishers: {
      usb: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
      rtsp: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
      rtsp2: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
      audio: { state: 'online', bound: true, fps: null, rms: 0.4, lastError: null },
    },
    consumers,
  };
}

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

async function switchScenario(page: Page, name: string) {
  await openScenarioOverlay(page);
  const radio = page.getByRole('radio', { name: new RegExp(`^${name}$`) });
  if (!(await radio.isChecked())) await radio.check();
  await page.getByRole('button', { name: /close scenarios/i }).click();
}

async function startRecording(page: Page) {
  await page.getByRole('button', { name: 'Start Recording' }).click();
  await expect(page.locator('[data-screen="S-13"]')).toBeVisible({ timeout: 10_000 });
}

test.describe('S-13 AI Studio', () => {
  test('primary: arms, interval defaults to 20, Generate Now reaches a ready banner that opens S-14', async ({ page }) => {
    test.setTimeout(45_000);
    await signIn(page);
    await startRecording(page);

    const card = page.getByTestId('ai-studio-card');
    await expect(card).toHaveAttribute('data-state', 'armed', { timeout: 5_000 });
    await expect(page.getByLabel('Auto-generation interval')).toHaveValue('20');

    await page.getByRole('button', { name: 'Generate Questions Now' }).click();
    await expect(card).toHaveAttribute('data-state', 'generating');
    await expect(card.getByRole('button', { name: 'Generating…' })).toBeDisabled();

    // Generate Now also opens S-14 directly (matching the prototype), so the
    // ready banner appearing behind it is what "opens S-14" demonstrates here.
    await expect(page.getByTestId('questions-modal')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('ai-studio-readybanner')).toBeVisible({ timeout: 15_000 });
  });

  test('failure: llm-timeout degrades the studio with a Retry; recording chrome stays live', async ({ page }) => {
    test.setTimeout(30_000);
    await signIn(page);
    await switchScenario(page, 'llm-timeout');
    await startRecording(page);

    await page.getByRole('button', { name: 'Generate Questions Now' }).click();
    const degraded = page.getByTestId('ai-studio-degraded');
    await expect(degraded).toBeVisible({ timeout: 15_000 });
    await expect(degraded.getByRole('button', { name: 'Retry' })).toBeEnabled();
    await expect(page.locator('[data-recording-state]')).toHaveAttribute('data-recording-state', 'recording');
  });

  test('kiosk: the card never causes page scroll; the interval control is a real >=44px target', async ({ page }) => {
    await signIn(page);
    await startRecording(page);
    await expect(page.getByTestId('ai-studio-card')).toHaveAttribute('data-state', 'armed', { timeout: 5_000 });

    const scrollable = await page.evaluate(() => document.documentElement.scrollHeight > document.documentElement.clientHeight
      || document.body.scrollHeight > document.body.clientHeight);
    expect(scrollable).toBe(false);

    const select = page.getByLabel('Auto-generation interval');
    const box = await select.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});

realTest.describe('S-13 AI Studio — real', () => {
  realTest(
    'real: an LLM outage holds the studio degraded with the recording continuously live; recovery yields 3–5 ready drafts',
    { annotation: { type: 'adapter', description: 'real' } },
    async ({ page, realStack }) => {
      // The unreachable path retries with real 10s + 30s backoffs before it
      // degrades, so this witness runs against a real B clock — budget for it.
      realTest.setTimeout(120_000);
      await realStack.control('core.pm.status', { status: sourcesOnline([]) });

      // Start a real recording — this arms the AI countdown against real C.
      await page.goto('/login');
      await page.getByLabel('Username').fill(REAL_STACK_ACCOUNTS.lecturer.username);
      await page.getByLabel('Password').fill(REAL_STACK_ACCOUNTS.lecturer.password);
      await page.getByRole('button', { name: 'Log In' }).click();
      await realExpect(page).toHaveURL('/');
      await page.getByRole('button', { name: 'Start Recording' }).click();
      await realExpect.poll(async () => (await realStack.processAudit()).recordStarts).toBe(1);
      await realStack.control('core.pm.publish', {
        event: 'evt.pm.consumer.running', data: { consumerId: 'record:00000001', pgid: 4101 },
      });

      const card = page.getByTestId('ai-studio-card');
      await realExpect(card).toHaveAttribute('data-state', 'armed', { timeout: 15_000 });
      await realExpect(page.getByLabel('Auto-generation interval')).toHaveValue('20');

      // Stop the LAN-LLM peer, then Generate Now: the real generation loop
      // exhausts its retries and degrades. The countdown never simulates this
      // client-side — it is B's `ai.set`/`ai.countdown` that flips the card.
      await realStack.control('core.ai', { service: 'question', offline: true });
      await page.getByRole('button', { name: 'Generate Questions Now' }).click();
      await realExpect(card).toHaveAttribute('data-state', 'degraded', { timeout: 90_000 });
      // Generate Now also opened S-14 over the card; dismiss it so the card's
      // own degraded Retry is interactable.
      await page.getByRole('button', { name: 'Close' }).click();
      const degraded = page.getByTestId('ai-studio-degraded');
      await realExpect(degraded).toBeVisible();
      await realExpect(degraded.getByRole('button', { name: 'Retry' })).toBeEnabled();

      // The lecture recording is untouched by the LLM loss — the real
      // recording chrome and the real backend both still say recording.
      await realExpect(page.getByTestId('recording-notch')).toContainText('RECORDING');
      const { accessToken } = await realStack.login('lecturer');
      const midState = await (await fetch(`${realStack.coreBaseUrl}/recording/state`, {
        headers: { authorization: `Bearer ${accessToken}` },
      })).json() as { state: string };
      realExpect(midState.state, 'recording stays live while the LLM is down').toBe('recording');
      realExpect((await realStack.processAudit()).recordStarts).toBe(1);

      // Restore the LAN-LLM peer (without restarting B/C) and queue a real
      // draft set, then Retry: the countdown recovers and a ready banner with
      // 3–5 drafts appears within B's 45-second request budget.
      await realStack.control('core.ai', { service: 'question', offline: false });
      await realStack.control('core.ai-generate', { count: 4 });
      await degraded.getByRole('button', { name: 'Retry' }).click();

      const banner = page.getByTestId('ai-studio-readybanner');
      await realExpect(banner).toBeVisible({ timeout: 60_000 });
      const draftCount = Number((await banner.getByText(/drafted from your lecture/).innerText()).match(/\d+/)?.[0] ?? '0');
      realExpect(draftCount, 'A-14: 3–5 drafts').toBeGreaterThanOrEqual(3);
      realExpect(draftCount).toBeLessThanOrEqual(5);

      // The recording was continuously live across the whole outage/recovery:
      // exactly one record consumer, never restarted.
      const finalState = await (await fetch(`${realStack.coreBaseUrl}/recording/state`, {
        headers: { authorization: `Bearer ${accessToken}` },
      })).json() as { state: string };
      realExpect(finalState.state).toBe('recording');
      const audit = await realStack.processAudit();
      realExpect(audit).toMatchObject({ recordStarts: 1 });
      realExpect(audit.processEvents.filter((event) => event.consumerId.startsWith('record:'))).toEqual([
        { consumerId: 'record:00000001', pgid: 4101, state: 'running' },
      ]);
    },
  );
});
