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
  const radio = page.getByRole('radio', { name: new RegExp(`^${name}$`) });
  if (!(await radio.isChecked())) await radio.check();
  await page.getByRole('button', { name: /close scenarios/i }).click();
}

async function startRecording(page: Page) {
  await page.getByRole('button', { name: 'Start Recording' }).click();
  await expect(page.locator('[data-screen="S-13"]')).toBeVisible({ timeout: 10_000 });
}

/** Pin to a SPECIFIC card's testid — the countdown's own auto-cycle can add
 * further drafts mid-test, and a live `.first()`/`.last()` query would
 * silently start pointing at one of those instead of the card actually sent. */
async function sendFirstDraft(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Generate Questions Now' }).click();
  const modal = page.getByTestId('questions-modal');
  await expect(modal.locator('.us-qcard[data-state="draft"]').first()).toBeVisible({ timeout: 15_000 });
  const draftId = await modal.locator('.us-qcard[data-state="draft"]').first().getAttribute('data-testid');
  const draftCard = page.getByTestId(draftId!);
  await draftCard.locator('.us-qcard__head').click();
  await draftCard.getByRole('button', { name: 'Send to Projector' }).click();
  await expect(draftCard).toHaveAttribute('data-state', 'sent', { timeout: 10_000 });
  await modal.getByRole('button', { name: 'Close' }).click();
  return draftCard;
}

test.describe('S-16 Previous Questions', () => {
  test('primary: send -> Now showing -> close states the reason -> re-project reveals without reopening acceptance', async ({ page }) => {
    test.setTimeout(40_000);
    await signIn(page);
    await startRecording(page);
    await sendFirstDraft(page);

    const pqCard = page.locator('.us-pqcard').first();
    await expect(pqCard).toContainText('Now showing', { timeout: 5_000 });

    await pqCard.getByRole('button', { name: 'Close' }).click();
    await expect(pqCard).not.toContainText('Now showing');
    await expect(pqCard.getByText(/closed/i)).toBeVisible({ timeout: 5_000 });

    await pqCard.getByRole('button', { name: 'Re-project' }).click();
    await expect(pqCard.getByText(/no longer respond/i)).toBeVisible({ timeout: 5_000 });
  });

  // quiz-network-loss (scenario/scripts/quiz-network-loss.ts) forces EVERY
  // sendToProjector command to be refused (409 quiz.unavailable) — there is
  // no UI path under this scenario that produces a live sent-then-stale
  // publication (Z-30's own stale flip mints an unrelated phantom id via
  // nextUlid() when no prior send has set ai.publication.ulid, so it can
  // never attach to the seed's pre-existing publication either). The
  // achievable, scenario-accurate failure demonstration is: Send is refused
  // with the named reason, no new publication is created, and the existing
  // one is untouched — recording stays untouched throughout.
  test('failure: quiz-network-loss refuses Send with a named reason; S-16 gains no new card; recording untouched', async ({ page }) => {
    test.setTimeout(30_000);
    await signIn(page);
    await switchScenario(page, 'quiz-network-loss');
    await startRecording(page);

    await page.getByRole('button', { name: 'Generate Questions Now' }).click();
    const modal = page.getByTestId('questions-modal');
    await expect(modal.locator('.us-qcard[data-state="draft"]').first()).toBeVisible({ timeout: 15_000 });
    const draftId = await modal.locator('.us-qcard[data-state="draft"]').first().getAttribute('data-testid');
    const draftCard = page.getByTestId(draftId!);
    await draftCard.locator('.us-qcard__head').click();
    await draftCard.getByRole('button', { name: 'Send to Projector' }).click();

    await expect(page.getByTestId(`${draftId}-problem`)).toContainText(/unreachable/i, { timeout: 10_000 });
    await expect(draftCard).toHaveAttribute('data-state', 'draft');
    await modal.getByRole('button', { name: 'Close' }).click();

    // Only the seed's pre-existing closed publication — no new one was created.
    await expect(page.locator('.us-pqcard')).toHaveCount(1);
    await expect(page.getByTestId('previous-questions-stale')).toHaveCount(0);
    await expect(page.locator('[data-recording-state]')).toHaveAttribute('data-recording-state', 'recording');
  });
});
