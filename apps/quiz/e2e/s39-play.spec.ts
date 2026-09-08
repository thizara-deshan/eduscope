import { expect, test } from '@playwright/test';
import { chooseScenario, forceTransition } from './overlay-helpers.js';
import { expect as realExpect, test as realTest } from './fixtures/real-stack.js';

const SESSION_URL = '/s/01JBQ8ZK3T7WBM5N2Q4XPRVC9D';

test.describe('S-39 Play', () => {
  test('scenario demo checklist: waiting, answerable option counts, and no timer/confirm dialog', async ({ page }) => {
    await page.goto(SESSION_URL);
    await forceTransition(page, 'student.question.none');
    await expect(page.getByText(/Waiting for your lecturer/)).toBeVisible();

    await forceTransition(page, 'student.question.open-2');
    await expect(page.locator('.quiz-answer')).toHaveCount(2);
    await forceTransition(page, 'student.question.open-3');
    await expect(page.locator('.quiz-answer')).toHaveCount(3);
    await forceTransition(page, 'student.question.open-4');
    await expect(page.locator('.quiz-answer')).toHaveCount(4);

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText(/[0-9]+:[0-9]{2}/)).toHaveCount(0);
  });

  test('primary: a single tap optimistically locks, the accepted reply keeps it locked, then a result supersedes S-39', async ({ page }) => {
    await page.goto(SESSION_URL);
    const first = page.locator('.quiz-answer').first();
    await first.click();
    await expect(first).toHaveAttribute('data-state', 'submitting');
    await expect(first).toHaveAttribute('data-state', 'locked', { timeout: 5_000 });
    await expect(first).toBeDisabled();

    await forceTransition(page, 'student.result.correct-current');
    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-40');
  });

  test('already-accepted reconciles to the server-stored option and locks out further taps', async ({ page }) => {
    await page.goto(SESSION_URL);
    await chooseScenario(page, 'student-quiz-returning');
    const options = page.locator('.quiz-answer');
    // storedOptionId is option B (index 1) — the snapshot arrives already
    // reconciled, so every option (including the stored one) is inert.
    await expect(options.nth(1)).toHaveAttribute('data-state', 'locked', { timeout: 5_000 });
    await expect(options.nth(0)).toHaveAttribute('data-state', 'idle');
    await expect(options.nth(0)).toBeDisabled();
    await expect(options.nth(1)).toBeDisabled();
  });

  test('failure: a late answer renders the explicit refusal, not accepted copy', async ({ page }) => {
    await page.goto(SESSION_URL);
    await chooseScenario(page, 'student-quiz-late-answer');
    await page.locator('.quiz-answer').first().click();
    await expect(page.getByText('Question closed before your answer arrived.')).toBeVisible();
    await expect(page.getByText(/accepted/i)).toHaveCount(0);
  });

  test('a lost reply returns to answerable with retry copy; retrying locks the stored answer', async ({ page }) => {
    await page.goto(SESSION_URL);
    await chooseScenario(page, 'student-quiz-failures');
    const first = page.locator('.quiz-answer').first();
    await first.click();
    await expect(page.getByText(/try again/i)).toBeVisible();
    await expect(first).toBeEnabled();

    await first.click();
    await expect(first).toHaveAttribute('data-state', 'locked', { timeout: 5_000 });
  });

  test('missed: forcing a close-missed transition delegates to S-40, never incorrect', async ({ page }) => {
    await page.goto(SESSION_URL);
    await forceTransition(page, 'student.question.close-missed');
    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-40');
    await expect(page.getByText('No answer received')).toBeVisible();
  });

  test('offline retains and dims the question; reconnect restores it with no stale flash', async ({ page }) => {
    await page.goto(SESSION_URL);
    await forceTransition(page, 'student.connection.offline');
    const options = page.locator('.quiz-answer');
    await expect(options.first()).toBeDisabled();

    await forceTransition(page, 'student.connection.restore');
    await expect(options.first()).toBeEnabled({ timeout: 5_000 });
    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-39');
  });

  test('a closed session supersedes the live screen with S-41', async ({ page }) => {
    await page.goto(SESSION_URL);
    await forceTransition(page, 'student.session.close-participated');
    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-41');
  });
});

interface PublishedQuestion {
  publicationId: string;
  options: Array<{ id: string; label: string; text: string }>;
  correctOptionId: string;
}

// eduscope:needs-real-d — exercises real D publish/answer/close and a genuine reconnect.
realTest.describe('S-39 Play — real', () => {
  realTest(
    'real: an accepted answer survives a later close, a closed publication refuses a late tap, a lost reply reconciles to the stored option, and each race stores exactly one row',
    { annotation: { type: 'adapter', description: 'real' } },
    async ({ page, realStack }) => {
      realTest.setTimeout(60_000);
      const joinCode = realStack.fixtureIds.joinCode!;
      const quizSessionId = realStack.fixtureIds.quizSessionId!;

      await page.goto(`/j/${joinCode}`);
      await page.getByLabel('Full name').fill('E-45 Student');
      await page.getByLabel('Student ID').fill('IT20000001');
      await page.getByRole('button', { name: /join/i }).click();
      await realExpect(page).toHaveURL(`/s/${quizSessionId}`);
      await realExpect(page.getByText(/Waiting for your lecturer/)).toBeVisible({ timeout: 15_000 });

      // Ordering A — answer commits, THEN the question closes: the first
      // server result is final. Closing also pushes the participant's own
      // result live (D-06), so the screen correctly supersedes to S-40 —
      // this is not a stuck/reverted S-39, it is the documented "a result
      // supersedes S-39" transition (already unit/mock-covered); what this
      // task proves is that exactly the ACCEPTED row survives it.
      const first = await realStack.control<PublishedQuestion>('quiz.publish-question');
      const firstOption = first.options[0]!;
      const firstButton = page.getByRole('button', { name: firstOption.text });
      await realExpect(firstButton).toBeVisible({ timeout: 15_000 });
      await firstButton.click();
      await realExpect(firstButton).toHaveAttribute('data-state', 'locked', { timeout: 15_000 });
      await realStack.control('quiz.close-publication', { publicationId: first.publicationId });
      await realExpect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-40', { timeout: 15_000 });
      const afterA = await realStack.control<{ count: number }>('quiz.answer-audit', { publicationId: first.publicationId });
      realExpect(afterA.count).toBe(1);

      // Ordering B — the question closes before any tap arrives. Once closed,
      // D's own live result push moves every connected participant straight
      // to S-40 (same as ordering A), so there is no window left to tap
      // through the UI — the only way to observe "closed before the reply"
      // is the REST boundary itself: a direct submit (the same request the
      // browser would have sent) is refused, never silently accepted.
      const second = await realStack.control<PublishedQuestion>('quiz.publish-question');
      await realExpect(page.getByRole('button', { name: second.options[0]!.text })).toBeVisible({ timeout: 15_000 });
      await realStack.control('quiz.close-publication', { publicationId: second.publicationId });
      await realExpect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-40', { timeout: 15_000 });
      const cookieForB = (await page.context().cookies()).find((c) => c.name === 'eduscope_participant');
      if (!cookieForB) throw new Error('no participant cookie was set');
      const lateAnswer = await fetch(`${realStack.quizBaseUrl}/api/student/v1/publications/${second.publicationId}/answers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: `eduscope_participant=${cookieForB.value}` },
        body: JSON.stringify({ selectedOptionId: second.options[0]!.id }),
      });
      realExpect(lateAnswer.status).toBe(409);
      const lateProblem = await lateAnswer.json() as { code: string };
      realExpect(lateProblem.code).toBe('question.closed');
      const afterB = await realStack.control<{ count: number }>('quiz.answer-audit', { publicationId: second.publicationId });
      realExpect(afterB.count).toBe(0);

      // Lost reply — the real submitAnswer response never reaches the
      // browser (simulated by submitting directly against D with the
      // browser's own real participant cookie), then the student's own tap
      // arrives for a DIFFERENT option: D's first stored answer wins, the UI
      // reconciles to it rather than the tap, and exactly one row exists.
      const third = await realStack.control<PublishedQuestion>('quiz.publish-question');
      const thirdOptionA = third.options[0]!;
      const thirdOptionB = third.options[1]!;
      const thirdButtonA = page.getByRole('button', { name: thirdOptionA.text });
      await realExpect(thirdButtonA).toBeVisible({ timeout: 15_000 });

      const participantCookie = (await page.context().cookies()).find((c) => c.name === 'eduscope_participant');
      if (!participantCookie) throw new Error('no participant cookie was set');
      const lostReply = await fetch(`${realStack.quizBaseUrl}/api/student/v1/publications/${third.publicationId}/answers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: `eduscope_participant=${participantCookie.value}` },
        body: JSON.stringify({ selectedOptionId: thirdOptionA.id }),
      });
      realExpect(lostReply.status).toBe(200);

      const thirdButtonB = page.getByRole('button', { name: thirdOptionB.text });
      await thirdButtonB.click();
      // The stored (first) option reconciles as locked; the tapped option
      // never becomes the selection.
      await realExpect(thirdButtonA).toHaveAttribute('data-state', 'locked', { timeout: 15_000 });
      await realExpect(thirdButtonB).toHaveAttribute('data-state', 'idle');
      const afterLostReply = await realStack.control<{ count: number }>('quiz.answer-audit', { publicationId: third.publicationId });
      realExpect(afterLostReply.count).toBe(1);

      // Reconnect: a fresh page load re-authenticates with the same cookie
      // and the snapshot atomically reconciles back to the already-locked
      // answer, not a blank/idle question.
      await page.reload();
      await realExpect(thirdButtonA).toHaveAttribute('data-state', 'locked', { timeout: 15_000 });
      await realExpect(thirdButtonA).toBeDisabled();
    },
  );
});
