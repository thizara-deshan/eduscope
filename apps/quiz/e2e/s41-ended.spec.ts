import { expect, test } from '@playwright/test';
import { chooseScenario, forceTransition } from './overlay-helpers.js';
import { expect as realExpect, test as realTest } from './fixtures/real-stack.js';

const SESSION_URL = '/s/01JBQ8ZK3T7WBM5N2Q4XPRVC9D';

test.describe('S-41 Session ended', () => {
  test('scenario demo checklist: participated, never answered, offline-close, direct not-found', async ({ page }) => {
    await page.goto(SESSION_URL);
    await forceTransition(page, 'student.session.close-participated');
    await expect(page.getByRole('heading', { name: 'Quiz ended' })).toBeVisible();
    await expect(page.getByText('You can close this tab now.')).toBeVisible();

    await forceTransition(page, 'student.session.close-none');
    await expect(page.getByText(/didn.t answer any questions/i)).toBeVisible();
  });

  test('primary: participated close shows final score/rank/answered count, close-tab copy, and no controls', async ({ page }) => {
    await page.goto(SESSION_URL);
    await forceTransition(page, 'student.session.close-participated');

    await expect(page.getByRole('heading', { name: 'Quiz ended' })).toBeVisible();
    await expect(page.getByText('30')).toBeVisible(); // final score
    await expect(page.getByText('#3')).toBeVisible(); // final own rank
    await expect(page.getByText('3', { exact: true })).toBeVisible(); // answered count
    await expect(page.getByText('You can close this tab now.')).toBeVisible();
    await expect(page.locator('main button')).toHaveCount(0);
    await expect(page.getByRole('link')).toHaveCount(0);
  });

  test('failure: an offline-close reconnect lands directly on the terminal summary with a "Reconnected" announcement', async ({ page }) => {
    await page.goto(SESSION_URL);
    await forceTransition(page, 'student.connection.offline');
    await forceTransition(page, 'student.session.prepare-close-participated');
    await forceTransition(page, 'student.connection.restore');

    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-41', { timeout: 15_000 });
    await expect(page.getByText('30')).toBeVisible();
    await expect(page.getByText('Reconnected.')).toBeVisible();
  });

  test('failure: a direct session-not-found link shows stale-link copy without a fabricated summary', async ({ page }) => {
    await page.goto(SESSION_URL);
    await chooseScenario(page, 'student-quiz-session-not-found');

    await expect(page.getByRole('heading', { name: 'This quiz link is no longer valid' })).toBeVisible();
    await expect(page.getByText('Final score')).toHaveCount(0);
    await expect(page.getByText(/didn.t answer/i)).toHaveCount(0);
  });
});

interface PublishedQuestion {
  publicationId: string;
  options: Array<{ id: string; label: string; text: string }>;
  correctOptionId: string;
}

// eduscope:needs-real-d — exercises a real session close, a D process restart against the same DB, and dual-participant reconnect.
realTest.describe('S-41 Session ended — real', () => {
  realTest(
    'real: participated and never-answered summaries both survive a D restart against the same DB, with no control back to play and no stale question reopen',
    { annotation: { type: 'adapter', description: 'real' } },
    async ({ page, realStack }) => {
      realTest.setTimeout(60_000);
      const joinCode = realStack.fixtureIds.joinCode!;
      const quizSessionId = realStack.fixtureIds.quizSessionId!;

      // Participant A answers a real question before the session ends.
      await page.goto(`/j/${joinCode}`);
      await page.getByLabel('Full name').fill('E-47 Participated');
      await page.getByLabel('Student ID').fill('IT50000001');
      await page.getByRole('button', { name: /join/i }).click();
      await realExpect(page).toHaveURL(`/s/${quizSessionId}`);
      await realExpect(page.getByText(/Waiting for your lecturer/)).toBeVisible({ timeout: 15_000 });

      const question = await realStack.control<PublishedQuestion>('quiz.publish-question');
      const correctButton = page.getByRole('button', { name: question.options.find((o) => o.id === question.correctOptionId)!.text });
      await realExpect(correctButton).toBeVisible({ timeout: 15_000 });
      await correctButton.click();
      await realExpect(correctButton).toHaveAttribute('data-state', 'locked', { timeout: 15_000 });
      await realStack.control('quiz.close-publication', { publicationId: question.publicationId });
      await realExpect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-40', { timeout: 15_000 });

      // Participant B (real, registered directly) never answers anything.
      const registerB = await fetch(`${realStack.quizBaseUrl}/api/student/v1/quiz-sessions/${quizSessionId}/participants`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fullName: 'E-47 Never Answered', studentIdNumber: 'IT50000002' }),
      });
      const setCookieB = registerB.headers.getSetCookie().find((v) => v.startsWith('eduscope_participant='));
      if (!setCookieB) throw new Error('participant B: no participant cookie in response');
      const cookieB = setCookieB.split(';', 1)[0]!.split('=', 2)[1]!;

      // Close the session, then restart D against the same Postgres DB —
      // both terminal summaries must be computed fresh from durable rows,
      // never from in-memory state that a restart would have wiped.
      await realStack.control('quiz.close-session', { quizSessionId });
      await realStack.control('quiz.restart');

      // A reconnects: deterministic participated summary, no stale question.
      await page.goto(`/s/${quizSessionId}`);
      await realExpect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-41', { timeout: 15_000 });
      await realExpect(page.getByRole('heading', { name: 'Quiz ended' })).toBeVisible();
      await realExpect(page.getByText('You can close this tab now.')).toBeVisible();
      await realExpect(page.getByText(question.options.find((o) => o.id === question.correctOptionId)!.text)).toHaveCount(0);
      await realExpect(page.locator('main button')).toHaveCount(0);
      await realExpect(page.getByRole('link')).toHaveCount(0);

      // B reconnects (same page, B's own real cookie): deterministic
      // no-participation summary, also with no control back to play.
      await page.context().clearCookies();
      const quizOrigin = new URL(realStack.quizTlsBaseUrl!);
      await page.context().addCookies([{
        name: 'eduscope_participant', value: cookieB,
        domain: quizOrigin.hostname, path: '/api/student/v1', secure: true, httpOnly: true, sameSite: 'Lax',
      }]);
      await page.goto(`/s/${quizSessionId}`);
      await realExpect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-41', { timeout: 15_000 });
      await realExpect(page.getByRole('heading', { name: 'Quiz ended' })).toBeVisible();
      await realExpect(page.getByText(/didn.t answer any questions/i)).toBeVisible();
      await realExpect(page.locator('main button')).toHaveCount(0);
      await realExpect(page.getByRole('link')).toHaveCount(0);
    },
  );
});
