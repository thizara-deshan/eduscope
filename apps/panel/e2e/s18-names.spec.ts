import { expect, test, type Page } from '@playwright/test';
import { expect as realExpect, test as realTest } from './fixtures/real-stack.js';
import { getJson, publishOneQuestion, startRealRecording, waitForOpenQuizSession } from './fixtures/real-ai.js';

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

// eduscope:needs-real-d — exercises real cross-device/cross-session isolation.
realTest.describe('S-18 Response names — real', () => {
  realTest(
    'real: a foreign device cannot seize the lecture nor bleed its names in; the room keeps its own list, stale-marked not emptied',
    { annotation: { type: 'adapter', description: 'real' } },
    async ({ page, realStack }) => {
      realTest.setTimeout(120_000);
      const { token, sessionId } = await startRealRecording(page, realStack);
      await waitForOpenQuizSession(realStack, token);
      const publicationId = await publishOneQuestion(realStack, token, sessionId);

      // Our room's phones answer over live sync.
      const { submitted } = await realStack.control<{ submitted: Array<{ studentIdNumber: string }> }>(
        'quiz.submit-answers', { count: 3, correctCount: 2 },
      );
      const ourIds = submitted.map((s) => s.studentIdNumber);

      // Plant a foreign device's room and have it try to hijack our lecture.
      const foreign = await realStack.control<{ foreignName: string; foreignStudentIdNumber: string; crossDeviceStatus: number }>(
        'quiz.foreign-room', { ourLectureSessionId: sessionId },
      );
      realExpect(foreign.crossDeviceStatus, 'D denies the cross-device session seizure').toBe(409);

      // Open our room's names for this publication.
      await realExpect(page.getByTestId('insights-column')).toBeVisible();
      const card = page.getByTestId(`publication-card-${publicationId}`);
      await realExpect(card).toBeVisible({ timeout: 15_000 });
      await realExpect.poll(async () => {
        const responses = await getJson(`${realStack.coreBaseUrl}/quiz/publications/${publicationId}/responses`, token) as { items: unknown[] };
        return responses.items.length;
      }, { timeout: 25_000 }).toBe(3);
      await card.getByRole('button', { name: /responses — view names/ }).click();
      const dialog = page.getByTestId('names-dialog');
      await realExpect(dialog).toBeVisible();
      await realExpect(dialog.getByTestId('names-dialog-list').locator('li')).toHaveCount(3, { timeout: 15_000 });

      // The foreign identity never appears anywhere in our room.
      realExpect(await page.getByText(foreign.foreignName).count(), 'no foreign name leaks in').toBe(0);
      realExpect(await page.getByText(foreign.foreignStudentIdNumber).count()).toBe(0);
      const html = await page.content();
      realExpect(html.includes(foreign.foreignName), 'foreign identity absent from DOM').toBe(false);

      // Cut B<->D: the last known list is stale-marked, not replaced with empty.
      await realStack.control('quiz.device-sync', { available: false });
      await realStack.control('quiz.restart');
      await realExpect(dialog.getByTestId('names-dialog-stale')).toBeVisible({ timeout: 30_000 });
      await realExpect(dialog.getByTestId('names-dialog-list').locator('li')).toHaveCount(3);
      await realExpect(dialog.getByTestId('names-dialog-empty')).toHaveCount(0);
      realExpect(await page.getByText(foreign.foreignName).count(), 'still no foreign leak while stale').toBe(0);

      // B's own projection: exactly our three students, none foreign.
      const responses = await getJson(`${realStack.coreBaseUrl}/quiz/publications/${publicationId}/responses`, token) as { items: Array<{ studentIdNumber: string }> };
      realExpect(new Set(responses.items.map((r) => r.studentIdNumber))).toEqual(new Set(ourIds));
    },
  );
});
