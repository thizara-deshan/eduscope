import { expect, test, type Locator, type Page } from '@playwright/test';
import { TIMERS } from '@eduscope/shared';

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
  { scenario = 'happy', aiDisabled = true }: { scenario?: string; aiDisabled?: boolean } = {},
) {
  await openScenarioOverlay(page);
  const scenarioRadio = page.getByRole('radio', { name: new RegExp(`^${scenario}$`) });
  if (!(await scenarioRadio.isChecked())) await scenarioRadio.check();
  const ai = page.getByRole('checkbox', { name: 'AI disabled (INT-10 go-live default)' });
  if ((await ai.isChecked()) !== aiDisabled) {
    if (aiDisabled) await ai.check();
    else await ai.uncheck();
  }
  await expect(page.getByTestId('active-scenario')).toHaveText(scenario);
  await page.getByRole('button', { name: /close scenarios/i }).click();
}

async function startRecording(page: Page) {
  await page.getByRole('button', { name: 'Start Recording' }).click();
  await expect(page.locator('[data-screen="S-05"]')).toBeVisible({
    timeout: TIMERS['T-START-CONFIRM'] + 1_000,
  });
}

async function xOrder(tiles: Locator): Promise<number[]> {
  return Promise.all((await tiles.all()).map(async (tile) => (await tile.boundingBox())!.x));
}

async function boxes(page: Page) {
  const selectors = [
    '.us-header',
    '[data-testid="recording-frame"]',
    '[data-testid="session-sidebar"]',
    '[data-testid="sources-bar"]',
    '[data-testid="room-controls-bar"]',
  ];
  return Promise.all(selectors.map(async (selector) => page.locator(selector).boundingBox()));
}

test.describe('S-05 Dashboard — session with AI disabled', () => {
  test('primary journey — assurance survives opening and closing a source preview', async ({ page }) => {
    await signIn(page);
    await configureWorld(page);
    await startRecording(page);

    const card = page.getByTestId('capture-assurance-card');
    await expect(card).toContainText('Everything this lecture needs is working');
    const before = await card.evaluate((node) => ({
      density: node.getAttribute('data-density'),
      tier: node.querySelector('[data-testid="capture-verdict"]')?.getAttribute('data-tier'),
      states: [...node.querySelectorAll('[data-testid="capture-source-tile"]')]
        .map((tile) => `${tile.getAttribute('data-role')}:${tile.getAttribute('aria-label')}`),
    }));
    await card.locator('[data-testid="capture-source-tile"][data-role="presentation"]').click();
    await expect(page.getByRole('dialog', { name: 'PC preview' })).toBeVisible();
    await page.getByRole('button', { name: 'Close preview' }).click();
    await expect(page.getByRole('dialog', { name: 'PC preview' })).toHaveCount(0);
    expect(await card.evaluate((node) => ({
      density: node.getAttribute('data-density'),
      tier: node.querySelector('[data-testid="capture-verdict"]')?.getAttribute('data-tier'),
      states: [...node.querySelectorAll('[data-testid="capture-source-tile"]')]
        .map((tile) => `${tile.getAttribute('data-role')}:${tile.getAttribute('aria-label')}`),
    }))).toEqual(before);
  });

  test('pipeline source loss raises tier 4 without reordering tiles', async ({ page }) => {
    test.setTimeout(30_000);
    await signIn(page);
    await configureWorld(page, { scenario: 'pipeline-crash-midway' });
    await startRecording(page);
    const tiles = page.getByTestId('capture-source-tile');
    const before = await xOrder(tiles);

    const verdict = page.getByTestId('capture-verdict');
    await expect(verdict).toHaveAttribute('data-tier', '4', { timeout: 13_000 });
    await expect(verdict).toContainText('CAM 1 has no signal.');
    await expect(verdict).toContainText('Your lecture is still recording.');
    expect(await xOrder(tiles)).toEqual(before);
  });

  test('both expanded bars preserve the capture-card floor without clipping the main region', async ({ page }) => {
    await signIn(page);
    await configureWorld(page);
    await startRecording(page);
    await page.getByRole('button', { name: 'Show sources' }).click();
    await page.getByRole('button', { name: 'Show controls' }).click();

    const measurements = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="capture-assurance-card"]')!;
      const main = document.querySelector('.us-dashboard__main')!;
      return {
        cardClientHeight: card.clientHeight,
        cardScrollHeight: card.scrollHeight,
        mainClientHeight: main.clientHeight,
        mainScrollHeight: main.scrollHeight,
      };
    });
    expect(measurements.cardClientHeight).toBeGreaterThanOrEqual(388);
    expect(measurements.cardScrollHeight).toBeLessThanOrEqual(measurements.cardClientHeight);
    expect(measurements.mainScrollHeight).toBeLessThanOrEqual(measurements.mainClientHeight);
  });

  test('the blocked recording-state Room Controls envelope is at most 194 px', async ({ page }) => {
    await signIn(page);
    await configureWorld(page);
    await startRecording(page);
    await page.getByRole('button', { name: 'Show controls' }).click();
    const room = await page.getByTestId('room-controls-bar').boundingBox();
    expect(room).not.toBeNull();
    expect(room!.height).toBeLessThanOrEqual(194);
  });

  test('one source fault has the same health word in S-05 and S-09', async ({ page }) => {
    test.setTimeout(25_000);
    await signIn(page);
    await configureWorld(page, { scenario: 'pipeline-crash-midway' });
    await startRecording(page);
    await page.getByRole('button', { name: 'Show sources' }).click();

    const cardTile = page.locator('[data-testid="capture-source-tile"][data-role="lecturer-cam"]');
    const barTile = page.locator('[data-testid="source-tile"][data-role="lecturer-cam"]');
    await expect(cardTile).toContainText(/reconnecting/i, { timeout: 7_000 });
    await expect(barTile).toContainText(/reconnecting/i);
  });

  test('AI enabled replaces only the main-column content across stable S-05 runs', async ({ page }) => {
    await signIn(page);
    await configureWorld(page);
    await startRecording(page);
    await expect(page.getByTestId('capture-assurance-card')).toBeVisible();
    const disabledBoxes = await boxes(page);

    await openScenarioOverlay(page);
    await page.getByRole('checkbox', { name: 'AI disabled (INT-10 go-live default)' }).uncheck();
    await page.getByTestId('e2e-start-recording').click();
    await page.getByRole('button', { name: /close scenarios/i }).click();
    await expect(page.locator('[data-screen="S-13"]')).toBeVisible({
      timeout: TIMERS['T-START-CONFIRM'] + 1_000,
    });

    expect(await boxes(page)).toEqual(disabledBoxes);
    await expect(page.getByTestId('capture-assurance-card')).toHaveCount(0);
  });
});
