import { expect, test } from '@playwright/test';
import { forceTransition } from './overlay-helpers.js';
import { expect as realExpect, test as realTest } from './fixtures/real-stack.js';

const SESSION_URL = '/s/01JBQ8ZK3T7WBM5N2Q4XPRVC9D';

test.describe('S-40 Result', () => {
  test('scenario demo checklist: correct, incorrect, missed, rank updating/current, offline, session close', async ({ page }) => {
    await page.goto(SESSION_URL);
    await forceTransition(page, 'student.result.correct-current');
    await expect(page.getByText('Correct!')).toBeVisible();

    await forceTransition(page, 'student.result.incorrect-pending');
    await expect(page.getByText('Not quite')).toBeVisible();
    await expect(page.getByText('Updating…')).toBeVisible();

    await forceTransition(page, 'student.question.close-missed');
    await expect(page.getByText('No answer received')).toBeVisible();

    await forceTransition(page, 'student.result.rank-current');
    await expect(page.getByText(/^#\d+$/)).toBeVisible();
  });

  test('primary: correct renders +10, the correct option, score/current rank, then a new question returns to S-39', async ({ page }) => {
    await page.goto(SESSION_URL);
    await forceTransition(page, 'student.result.correct-current');

    await expect(page.getByText('Correct!')).toBeVisible();
    await expect(page.getByText('+10')).toBeVisible();
    await expect(page.getByText('30')).toBeVisible();
    await expect(page.getByText('#3')).toBeVisible();
    await expect(page.getByText('Waiting for the next question')).toBeVisible();

    await forceTransition(page, 'student.question.open-4');
    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-39');
    await expect(page.getByText('Correct!')).toHaveCount(0);
  });

  test('failure: incorrect/pending renders own vs correct answers with "Updating…", and offline preserves it', async ({ page }) => {
    await page.goto(SESSION_URL);
    await forceTransition(page, 'student.result.incorrect-pending');
    await expect(page.getByText('Not quite')).toBeVisible();
    await expect(page.getByText('Updating…')).toBeVisible();
    await expect(page.getByText('Your answer')).toBeVisible();
    await expect(page.getByText('Correct answer')).toBeVisible();

    await forceTransition(page, 'student.connection.offline');
    await expect(page.getByRole('status')).toContainText(/offline|reconnecting/i);
    await expect(page.getByText('Not quite')).toBeVisible();
    await expect(page.getByText('Updating…')).toBeVisible();
  });

  test('a rank-current transition updates only the rank, not the score', async ({ page }) => {
    await page.goto(SESSION_URL);
    await forceTransition(page, 'student.result.incorrect-pending');
    await expect(page.getByText('Updating…')).toBeVisible();
    await expect(page.getByText('20')).toBeVisible();

    await forceTransition(page, 'student.result.rank-current');
    await expect(page.getByText('#3')).toBeVisible();
    await expect(page.getByText('20')).toBeVisible();
  });

  test('session close supersedes a visible result with S-41', async ({ page }) => {
    await page.goto(SESSION_URL);
    await forceTransition(page, 'student.result.correct-current');
    await expect(page.getByText('Correct!')).toBeVisible();

    await forceTransition(page, 'student.session.close-participated');
    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-41');
  });
});

interface PublishedQuestion {
  publicationId: string;
  options: Array<{ id: string; label: string; text: string }>;
  correctOptionId: string;
}

async function registerOther(quizBaseUrl: string, quizSessionId: string, fullName: string, studentIdNumber: string): Promise<string> {
  const response = await fetch(`${quizBaseUrl}/api/student/v1/quiz-sessions/${quizSessionId}/participants`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fullName, studentIdNumber }),
  });
  const setCookie = response.headers.getSetCookie().find((v) => v.startsWith('eduscope_participant='));
  if (!setCookie) throw new Error(`registerOther(${studentIdNumber}): no participant cookie in response`);
  return setCookie.split(';', 1)[0]!.split('=', 2)[1]!;
}

function answerAs(quizBaseUrl: string, publicationId: string, cookieValue: string, selectedOptionId: string): Promise<Response> {
  return fetch(`${quizBaseUrl}/api/student/v1/publications/${publicationId}/answers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `eduscope_participant=${cookieValue}` },
    body: JSON.stringify({ selectedOptionId }),
  });
}

// eduscope:needs-real-d — exercises a real multi-participant close, offline reconnect via snapshot, and cross-participant privacy.
realTest.describe('S-40 Own result — real', () => {
  realTest(
    'real: an answer that closes while offline reconnects to a self-contained, correctly dense-ranked result with zero other-identity leakage',
    { annotation: { type: 'adapter', description: 'real' } },
    async ({ page, realStack }) => {
      realTest.setTimeout(60_000);
      const joinCode = realStack.fixtureIds.joinCode!;
      const quizSessionId = realStack.fixtureIds.quizSessionId!;
      const OTHER_NAME_1 = 'ZZZ Other Beta';
      const OTHER_ID_1 = 'IT40000002';
      const OTHER_NAME_2 = 'ZZZ Other Gamma';
      const OTHER_ID_2 = 'IT40000003';

      // Two other real participants exist in the same session so a buggy
      // implementation would have real identities available to leak.
      const otherCookie1 = await registerOther(realStack.quizBaseUrl, quizSessionId, OTHER_NAME_1, OTHER_ID_1);
      const otherCookie2 = await registerOther(realStack.quizBaseUrl, quizSessionId, OTHER_NAME_2, OTHER_ID_2);

      await page.goto(`/j/${joinCode}`);
      await page.getByLabel('Full name').fill('E-46 Focus');
      await page.getByLabel('Student ID').fill('IT40000001');
      await page.getByRole('button', { name: /join/i }).click();
      await realExpect(page).toHaveURL(`/s/${quizSessionId}`);
      await realExpect(page.getByText(/Waiting for your lecturer/)).toBeVisible({ timeout: 15_000 });

      const question = await realStack.control<PublishedQuestion>('quiz.publish-question');
      const correctButton = page.getByRole('button', { name: question.options.find((o) => o.id === question.correctOptionId)!.text });
      await realExpect(correctButton).toBeVisible({ timeout: 15_000 });
      await correctButton.click();
      await realExpect(correctButton).toHaveAttribute('data-state', 'locked', { timeout: 15_000 });

      // Disconnect BEFORE the close — the live close/result push is genuinely
      // missed; only a fresh reconnect snapshot can deliver the terminal
      // result. Other participants answer, then the question closes, all
      // while this participant holds no socket at all.
      await page.goto('about:blank');
      await answerAs(realStack.quizBaseUrl, question.publicationId, otherCookie1, question.correctOptionId); // ties for rank 1
      const wrongOption = question.options.find((o) => o.id !== question.correctOptionId)!;
      await answerAs(realStack.quizBaseUrl, question.publicationId, otherCookie2, wrongOption.id); // rank 2
      await realStack.control('quiz.close-publication', { publicationId: question.publicationId });

      // Reconnect: capture every live WS frame from the fresh connect() so the
      // privacy scan below covers the wire, not only the rendered DOM.
      const frames: string[] = [];
      page.on('websocket', (ws) => ws.on('framereceived', (f) => frames.push(String(f.payload))));
      await page.goto(`/s/${quizSessionId}`);
      await realExpect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-40', { timeout: 15_000 });
      await realExpect(page.getByText('Correct!')).toBeVisible();
      await realExpect(page.getByText('#1')).toBeVisible(); // dense rank: tied with the other correct answer
      await realExpect(page.getByText('10', { exact: true })).toBeVisible();
      await realExpect(page.getByText('Updating…')).toHaveCount(0); // rankState is 'current', never left pending

      const bodyText = await page.locator('body').innerText();
      const wireText = frames.join('\n');
      for (const leak of [OTHER_NAME_1, OTHER_ID_1, OTHER_NAME_2, OTHER_ID_2]) {
        realExpect(bodyText.includes(leak)).toBe(false);
        realExpect(wireText.includes(leak)).toBe(false);
      }
    },
  );
});
