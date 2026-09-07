import { expect, test, type Locator, type Page } from '@playwright/test';
import { REAL_STACK_ACCOUNTS, expect as realExpect, test as realTest, type RealStack } from './fixtures/real-stack.js';

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

const wait = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

async function getJson(url: string, token: string): Promise<unknown> {
  return (await fetch(url, { headers: { authorization: `Bearer ${token}` } })).json();
}

/** Generates a real question set and sends one draft to the projector, returning the open publication id. */
async function publishOneQuestion(realStack: RealStack, coreBaseUrl: string, token: string, sessionId: string): Promise<string> {
  await realStack.control('core.ai-generate', { count: 3 });
  await fetch(`${coreBaseUrl}/ai/generate-now`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
  let draftId: string | undefined;
  for (let i = 0; i < 30 && !draftId; i += 1) {
    const rows = await getJson(`${coreBaseUrl}/ai/questions?sessionId=${sessionId}`, token) as { items?: Array<{ id: string; state: string }> } | Array<{ id: string; state: string }>;
    draftId = ('items' in rows ? rows.items! : rows).find((q) => q.state === 'draft')?.id;
    if (!draftId) await wait(500);
  }
  if (!draftId) throw new Error('publishOneQuestion: no draft generated');
  await fetch(`${coreBaseUrl}/ai/questions/${draftId}/send-to-projector`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
  let pubId: string | undefined;
  for (let i = 0; i < 30 && !pubId; i += 1) {
    const rows = await getJson(`${coreBaseUrl}/ai/publications?sessionId=${sessionId}`, token) as { items?: Array<{ id: string; state: string }> } | Array<{ id: string; state: string }>;
    pubId = ('items' in rows ? rows.items! : rows).find((p) => p.state === 'open')?.id;
    if (!pubId) await wait(500);
  }
  if (!pubId) throw new Error('publishOneQuestion: no open publication');
  return pubId;
}

async function startRealRecording(page: Page, realStack: RealStack): Promise<{ token: string; sessionId: string }> {
  await realStack.control('core.pm.status', { status: sourcesOnline([]) });
  await page.goto('/login');
  await page.getByLabel('Username').fill(REAL_STACK_ACCOUNTS.lecturer.username);
  await page.getByLabel('Password').fill(REAL_STACK_ACCOUNTS.lecturer.password);
  await page.getByRole('button', { name: 'Log In' }).click();
  await realExpect(page).toHaveURL('/');
  await page.getByRole('button', { name: 'Start Recording' }).click();
  await realExpect.poll(async () => (await realStack.processAudit()).recordStarts).toBe(1);
  await realStack.control('core.pm.publish', { event: 'evt.pm.consumer.running', data: { consumerId: 'record:00000001', pgid: 4101 } });
  const { accessToken } = await realStack.login('lecturer');
  const state = await getJson(`${realStack.coreBaseUrl}/recording/state`, accessToken) as { sessionId: string };
  return { token: accessToken, sessionId: state.sessionId };
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

// eduscope:needs-real-d — exercises the real B<->D answer-sync + replay path.
realTest.describe('S-16 Previous questions — real', () => {
  realTest(
    'real: a B<->D sync cut marks responses explicitly stale; restoring sync replays D answers into B once, converging exactly',
    { annotation: { type: 'adapter', description: 'real' } },
    async ({ page, realStack }) => {
      realTest.setTimeout(120_000);
      const { token, sessionId } = await startRealRecording(page, realStack);

      // Wait until B has minted the open quiz session against real D.
      await realExpect.poll(
        async () => (await getJson(`${realStack.coreBaseUrl}/quiz/session`, token) as { state: string }).state,
        { timeout: 20_000 },
      ).toBe('open');

      const publicationId = await publishOneQuestion(realStack, realStack.coreBaseUrl, token, sessionId);
      await realExpect(page.getByTestId('insights-column')).toBeVisible();
      await realExpect(page.getByTestId(`publication-card-${publicationId}`)).toBeVisible({ timeout: 15_000 });

      // Cut B's device-sync link while keeping D up for phones: block reconnect,
      // then bounce D to drop B's live socket. D's rows persist in Postgres.
      await realStack.control('quiz.device-sync', { available: false });
      await realStack.control('quiz.restart');

      // Phones answer D during the cut (2 correct, 1 wrong). B does not see them yet.
      const { submitted } = await realStack.control<{ submitted: Array<{ studentIdNumber: string; isCorrect: boolean }> }>(
        'quiz.submit-answers', { count: 3, correctCount: 2 },
      );

      // After T-QUIZ-SYNC-STALE (15 s) with no inbound frames, B marks the
      // publication's responses explicitly stale.
      await realExpect(page.getByTestId('previous-questions-stale')).toBeVisible({ timeout: 30_000 });

      // Restore the link: B reconnects, sends sync.hello with its watermark, and
      // D replays exactly the answers submitted during the cut.
      await realStack.control('quiz.device-sync', { available: true });
      await realExpect(page.getByTestId('previous-questions-stale')).toHaveCount(0, { timeout: 30_000 });

      // B's replayed projection converges to D's answers exactly once — three
      // responses, two correct, no duplicated student row.
      await realExpect.poll(async () => {
        const responses = await getJson(`${realStack.coreBaseUrl}/quiz/publications/${publicationId}/responses`, token) as { items: Array<{ studentIdNumber: string; isCorrect: boolean }> };
        return responses.items.length;
      }, { timeout: 20_000 }).toBe(3);

      const responses = await getJson(`${realStack.coreBaseUrl}/quiz/publications/${publicationId}/responses`, token) as { items: Array<{ studentIdNumber: string; isCorrect: boolean }>; stale: boolean };
      realExpect(responses.stale, 'no longer stale after replay').toBe(false);
      realExpect(new Set(responses.items.map((r) => r.studentIdNumber)).size, 'no duplicate student rows').toBe(3);
      realExpect(responses.items.filter((r) => r.isCorrect).length).toBe(2);
      // B's projection matches D's authoritative submission set exactly.
      realExpect(new Set(responses.items.map((r) => r.studentIdNumber)))
        .toEqual(new Set(submitted.map((s) => s.studentIdNumber)));
    },
  );
});
