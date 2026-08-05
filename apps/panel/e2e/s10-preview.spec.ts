import { expect, test, type Locator, type Page } from '@playwright/test';

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
