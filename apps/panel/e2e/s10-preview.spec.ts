import { expect, test, type Locator, type Page } from '@playwright/test';
import { REAL_STACK_ACCOUNTS, expect as realExpect, test as realTest } from './fixtures/real-stack.js';

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
  await page.getByRole('radio', { name: new RegExp(`^${name}$`) }).check();
  await page.getByRole('button', { name: /close scenarios/i }).click();
}

async function expandSources(page: Page) {
  await page.getByRole('button', { name: 'Show sources' }).click();
  await expect(page.getByTestId('source-tile')).toHaveCount(3);
}

async function openPreview(page: Page, role = 'presentation'): Promise<Locator> {
  await page.locator(`[data-testid="source-tile"][data-role="${role}"]`).click();
  const dialog = page.getByRole('dialog', {
    name: role === 'presentation' ? 'Presentation preview' : 'Lecturer Camera preview',
  });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('S-10 Source preview lightbox', () => {
  test('a live preview holds its frame shape, paints changing frames, closes, and leaves recording untouched', async ({ page }) => {
    await signIn(page);
    await expandSources(page);
    const recordingBefore = await page.locator('[data-recording-state]').getAttribute('data-recording-state');
    const dialog = await openPreview(page);
    const skeleton = page.getByTestId('preview-skeleton');
    await expect(skeleton).toBeVisible();
    const skeletonBox = await skeleton.boundingBox();

    const frame = page.getByTestId('preview-frame');
    await expect(frame).toBeVisible({ timeout: 1_000 });
    await expect(dialog).toContainText('LIVE');
    const frameBox = await frame.boundingBox();
    expect(frameBox?.width).toBe(skeletonBox?.width);
    expect(frameBox?.height).toBe(skeletonBox?.height);
    const firstFrame = await frame.getAttribute('src');
    await page.waitForTimeout(500);
    expect(await frame.getAttribute('src')).not.toBe(firstFrame);

    await page.getByRole('button', { name: 'Close preview' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('[data-recording-state]')).toHaveAttribute(
      'data-recording-state', recordingBefore!,
    );
  });

  test('a source dropping mid-preview replaces the last frame with its reason', async ({ page }) => {
    test.setTimeout(25_000);
    await signIn(page);
    await switchScenario(page, 'pipeline-crash-midway');
    await expandSources(page);
    const camera = page.locator('[data-testid="source-tile"][data-role="lecturer-cam"]');
    await expect(camera).toHaveAttribute('data-state', 'degraded', { timeout: 7_000 });
    await openPreview(page, 'lecturer-cam');
    await expect(page.getByTestId('preview-frame')).toBeVisible({ timeout: 1_000 });
    await expect(page.getByRole('status')).toHaveText(
      'source lecturer-cam is no longer available',
      { timeout: 8_000 },
    );
    await expect(page.getByTestId('preview-frame')).toHaveCount(0);
  });

  test('an offline source tile cannot start a new negotiation', async ({ page }) => {
    test.setTimeout(22_000);
    await signIn(page);
    await switchScenario(page, 'pipeline-crash-midway');
    await expandSources(page);
    const camera = page.locator('[data-testid="source-tile"][data-role="lecturer-cam"]');
    await expect(camera).toHaveAttribute('data-state', 'offline', { timeout: 14_000 });
    await expect(camera).toBeDisabled();
    await expect(page.getByRole('dialog', { name: 'Lecturer Camera preview' })).toHaveCount(0);
  });

  test('the first painted frame meets the one-second interaction budget', async ({ page }) => {
    await signIn(page);
    await expandSources(page);
    const startedAt = Date.now();
    await page.locator('[data-testid="source-tile"][data-role="presentation"]').click();
    await expect(page.getByTestId('preview-frame')).toBeVisible({ timeout: 1_000 });
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  test('the scrim closes and the explicit close target is at least 44px', async ({ page }) => {
    await signIn(page);
    await expandSources(page);
    const dialog = await openPreview(page);
    const closeBox = await page.getByRole('button', { name: 'Close preview' }).boundingBox();
    expect(closeBox?.width).toBeGreaterThanOrEqual(44);
    expect(closeBox?.height).toBeGreaterThanOrEqual(44);
    const rootBox = await page.locator('.us-previewroot').boundingBox();
    expect(rootBox).not.toBeNull();
    await page.mouse.click(rootBox!.x + 12, rootBox!.y + rootBox!.height / 2);
    await expect(dialog).toHaveCount(0);
  });

  test('the lightbox stays inside the panel-local overlay bounds', async ({ page }) => {
    await signIn(page);
    await expandSources(page);
    const dialog = await openPreview(page);
    const panelBox = await page.locator('.us-panel').boundingBox();
    const dialogBox = await dialog.boundingBox();
    expect(panelBox).not.toBeNull();
    expect(dialogBox).not.toBeNull();
    expect(dialogBox!.x).toBeGreaterThanOrEqual(panelBox!.x);
    expect(dialogBox!.y).toBeGreaterThanOrEqual(panelBox!.y);
    expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width);
    expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(panelBox!.y + panelBox!.height);
  });
});

// Real `listSourceRoles` labels (services/core-api/src/db/seeds.ts) — distinct
// from the mock's, which confirms the tile chrome is really real-backed.
const REAL_PREVIEW_LABELS = {
  presentation: 'PC',
  'lecturer-cam': 'CAM 1',
  'students-cam': 'CAM 2',
} as const;

realTest.describe('S-10 Wave-2 shell checkpoint — real source data, mock preview', () => {
  realTest(
    'real: every real source tile opens the mock JPEG sentinel with no real preview.jpg request or /ws/preview upgrade',
    { annotation: { type: 'adapter', description: 'real' } },
    async ({ page, realStack }) => {
      realTest.setTimeout(75_000);

      // Checkpoint, not integration acceptance. Every surrounding source
      // domain (auth, recording, sourcesAudio) runs real, but `preview` is
      // explicitly pinned to mock, so the lightbox is served by the
      // deterministic mock JPEG sentinel rather than a real JPEG poll. This
      // proves the mixed router keeps a real source screen and a mock preview
      // channel side by side without either masquerading as the other. Real
      // preview-over-JPEG acceptance (DR-23) stays unclaimed until E-48.
      await page.route('**/config.json', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            apiBaseUrl: realStack.coreBaseUrl,
            quizBaseUrl: realStack.quizTlsBaseUrl ?? realStack.quizBaseUrl,
            environment: 'integration',
            adapters: { default: 'real', overrides: { preview: 'mock' } },
          }),
        });
      });

      const realPreviewRequests: string[] = [];
      const previewSockets: string[] = [];
      page.on('request', (request) => {
        if (/\/sources\/[^/]+\/preview\.jpg/.test(request.url())) realPreviewRequests.push(request.url());
      });
      page.on('websocket', (ws) => {
        if (/\/ws\/preview/.test(ws.url())) previewSockets.push(ws.url());
      });

      await page.goto('/login');
      await page.getByLabel('Username').fill(REAL_STACK_ACCOUNTS.lecturer.username);
      await page.getByLabel('Password').fill(REAL_STACK_ACCOUNTS.lecturer.password);
      await page.getByRole('button', { name: 'Log In' }).click();
      await realExpect(page).toHaveURL('/');

      // Bring the real sources online so their (real) tiles are enabled.
      await realStack.control('core.pm.status', { status: {
        publishers: {
          usb: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
          rtsp: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
          rtsp2: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
          audio: { state: 'online', bound: true, fps: null, rms: 0.4, lastError: null },
        }, consumers: [],
      } });

      await page.getByRole('button', { name: 'Show sources' }).click();
      await realExpect(page.getByTestId('source-tile')).toHaveCount(3);

      for (const [role, label] of Object.entries(REAL_PREVIEW_LABELS)) {
        const tile = page.locator(`[data-testid="source-tile"][data-role="${role}"]`);
        await realExpect(tile).toHaveAttribute('data-state', 'online', { timeout: 15_000 });
        await tile.click();
        const dialog = page.getByRole('dialog', { name: `${label} preview` });
        await realExpect(dialog).toBeVisible();
        // The mock sentinel paints a live frame within the one-second budget.
        await realExpect(page.getByTestId('preview-frame')).toBeVisible({ timeout: 2_000 });
        await realExpect(dialog).toContainText('LIVE');
        await page.getByRole('button', { name: 'Close preview' }).click();
        await realExpect(dialog).toHaveCount(0);
      }

      // Provenance: the mock channel served every frame; the real JPEG
      // endpoint and any preview-signaling socket were never touched.
      realExpect(realPreviewRequests, 'preview stayed mock — no real preview.jpg poll').toEqual([]);
      realExpect(previewSockets, 'no /ws/preview upgrade — JPEG decision is signaling-free').toEqual([]);
    },
  );
});
