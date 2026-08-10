import { expect, type Page } from '@playwright/test';

/** The overlay is reachable only by a 2s long-press on an invisible corner target. */
export async function openScenarioOverlay(page: Page) {
  const hotspot = page.getByTestId('quiz-scenario-hotspot');
  const box = await hotspot.boundingBox();
  if (!box) throw new Error('quiz scenario hotspot has no box — is the mock client active?');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(2_200);
  await page.mouse.up();
  await expect(page.getByRole('dialog', { name: /scenario/i })).toBeVisible();
}

export async function chooseScenario(page: Page, scenario: string) {
  await openScenarioOverlay(page);
  await page.getByRole('radio', { name: new RegExp(`^${scenario}$`) }).check();
  await page.getByRole('button', { name: 'Close scenarios' }).click();
}

export async function forceTransition(page: Page, transitionId: string) {
  await openScenarioOverlay(page);
  await page.getByTestId(`quiz-force-${transitionId}`).click();
  await page.getByRole('button', { name: 'Close scenarios' }).click();
}
