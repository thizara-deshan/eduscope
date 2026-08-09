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

/** Pin to a SPECIFIC card's testid — see s16-previous-questions.spec.ts's helper comment. */
async function sendFirstDraft(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Generate Questions Now' }).click();
  const modal = page.getByTestId('questions-modal');
  await expect(modal.locator('.us-qcard[data-state="draft"]').first()).toBeVisible({ timeout: 15_000 });
  const draftId = await modal.locator('.us-qcard[data-state="draft"]').first().getAttribute('data-testid');
  const draftCard = page.getByTestId(draftId!);
  await draftCard.locator('.us-qcard__head').click();
  await draftCard.getByRole('button', { name: 'Send to Projector' }).click();
  await expect(draftCard).toHaveAttribute('data-state', 'sent', { timeout: 10_000 });
  await modal.getByRole('button', { name: 'Close' }).click();
}

test.describe('S-18 Response names', () => {
  test('primary: a S-16 badge opens the dialog and the three filters switch', async ({ page }) => {
    test.setTimeout(30_000);
    await signIn(page);
    await startRecording(page);
    await sendFirstDraft(page);

    const pqCard = page.locator('.us-pqcard').first();
    await pqCard.getByRole('button', { name: /responses — view names/i }).click();

    const dialog = page.getByTestId('names-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('tab', { name: /^Correct/ }).click();
    await expect(dialog.getByRole('tab', { name: /^Correct/ })).toHaveAttribute('aria-selected', 'true');
    await dialog.getByRole('tab', { name: /^Incorrect/ }).click();
    await expect(dialog.getByRole('tab', { name: /^Incorrect/ })).toHaveAttribute('aria-selected', 'true');
  });

  // quiz-network-loss forces EVERY sendToProjector command to be refused
  // (409 quiz.unavailable, scenario/scripts/quiz-network-loss.ts), so this
  // does NOT send a new question first — `listPublicationResponses` reads
  // the GLOBAL `quiz.sync` machine state for `stale` (mock/rest/quiz.ts),
  // not a per-publication WS correlation, so the banner is reachable for
  // the seed's pre-existing publication once Z-30 flips sync to `stale`
  // ~3s after world build, with no live send required at all.
  test('failure: quiz-network-loss shows a stale banner with syncedAt', async ({ page }) => {
    test.setTimeout(30_000);
    await signIn(page);
    await switchScenario(page, 'quiz-network-loss');
    await startRecording(page);
    // `listPublicationResponses` is fetched once (staleTime: Infinity, no
    // invalidate-on-event wiring) — wait past Z-30's ~3s stale flip so the
    // dialog's FIRST fetch already observes the stale sync state.
    await page.waitForTimeout(3_500);

    const pqCard = page.locator('.us-pqcard').first();
    await pqCard.getByRole('button', { name: /responses — view names/i }).click();
    const dialog = page.getByTestId('names-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('names-dialog-stale')).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByTestId('names-dialog-stale')).toContainText(/synced/i);
  });
});
