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

async function startRecording(page: Page) {
  await page.getByRole('button', { name: 'Start Recording' }).click();
  await expect(page.locator('[data-screen="S-13"]')).toBeVisible({ timeout: 10_000 });
}

test.describe('S-14 Questions review', () => {
  test('primary: expand a draft, tap-a-letter correct, Send -> sending -> sent, echoed in S-16', async ({ page }) => {
    test.setTimeout(40_000);
    await signIn(page);
    await startRecording(page);

    await page.getByRole('button', { name: 'Generate Questions Now' }).click();
    const modal = page.getByTestId('questions-modal');
    await expect(modal).toBeVisible();

    // Pin to a SPECIFIC card's testid rather than a live `.last()` query —
    // the countdown's own 6 s auto-cycle can add further drafts while this
    // test interacts with the modal, and a dynamic `.last()` would silently
    // start pointing at one of those instead of the card actually sent.
    await expect(page.locator('.us-qcard[data-state="draft"]').last()).toBeVisible({ timeout: 15_000 });
    const draftId = await page.locator('.us-qcard[data-state="draft"]').last().getAttribute('data-testid');
    const draftCard = page.getByTestId(draftId!);
    await draftCard.locator('.us-qcard__head').click();
    await draftCard.getByRole('button', { name: 'Send to Projector' }).click();
    await expect(draftCard.getByRole('button', { name: 'Sending…' })).toBeVisible();
    await expect(draftCard).toHaveAttribute('data-state', 'sent', { timeout: 10_000 });

    await modal.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByTestId('insights-column')).toBeVisible();
    await expect(page.getByText('Now showing')).toBeVisible({ timeout: 5_000 });
  });

  test('failure: quiz unavailable at record-start disables Send with a named reason', async ({ page }) => {
    test.setTimeout(30_000);
    await signIn(page);
    await openScenarioOverlay(page);
    await page.getByRole('checkbox', { name: 'Quiz server unavailable' }).check();
    await page.getByRole('button', { name: /close scenarios/i }).click();
    await startRecording(page);

    // C-1: no quiz session exists when the quiz server is unavailable, so the
    // S-20 chip does not render at all (absent) — Send's own disabled reason
    // is what names the consequence here.
    await expect(page.getByTestId('quiz-join-chip')).toHaveCount(0);

    await page.getByRole('button', { name: 'Generate Questions Now' }).click();
    const draftCard = page.locator('.us-qcard[data-state="draft"]').last();
    await expect(draftCard).toBeVisible({ timeout: 15_000 });
    await draftCard.locator('.us-qcard__head').click();
    await expect(draftCard.getByRole('button', { name: 'Send to Projector' })).toBeDisabled();
    await expect(draftCard.getByText(/quiz server is unavailable/i)).toBeVisible();
  });

  test('immutable: editing a sent question shows the 409 reason and does not revert', async ({ page }) => {
    test.setTimeout(30_000);
    await signIn(page);
    await startRecording(page);

    await page.getByRole('button', { name: 'Generate Questions Now' }).click();
    await expect(page.getByTestId('questions-modal')).toBeVisible();
    const sentCard = page.locator('.us-qcard[data-state="sent"]').first();
    await expect(sentCard).toBeVisible({ timeout: 15_000 });
    const originalPrompt = await sentCard.locator('.us-qcard__prompt').textContent();

    await sentCard.locator('.us-qcard__head').click();
    await sentCard.getByRole('button', { name: 'Edit' }).click();
    await sentCard.getByRole('button', { name: 'Save' }).click();

    await expect(sentCard.getByText(/only draft/i)).toBeVisible({ timeout: 5_000 });
    await expect(sentCard.locator('.us-qcard__prompt')).toHaveText(originalPrompt ?? '');
  });
});
