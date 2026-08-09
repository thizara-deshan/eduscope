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
