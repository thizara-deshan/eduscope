import { expect, test } from '@playwright/test';
import { chooseScenario, forceTransition, openScenarioOverlay } from './overlay-helpers.js';
import { expect as realExpect, test as realTest } from './fixtures/real-stack.js';

test.describe('S-37 Join', () => {
  test('scenario demo checklist', async ({ page }) => {
    // resolving: student-quiz-happy's restDelayMs keeps the skeleton visible.
    await page.goto('/j');
    await chooseScenario(page, 'student-quiz-happy');
    await page.getByRole('textbox', { name: /quiz code/i }).fill('ABC123');
    await page.getByRole('button', { name: 'Join' }).click();
    await expect(page.getByTestId('join-skeleton')).toBeVisible();
    // open, new participant -> replace-route to register (S-38).
    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-38');
  });

  test('primary: open + new participant replace-routes to registration', async ({ page }) => {
    await page.goto('/j');
    await page.getByRole('textbox', { name: /quiz code/i }).fill('ABC123');
    await page.getByRole('button', { name: 'Join' }).click();
    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-38');
    expect(page.url()).toContain('/j/ABC123/register');
  });

  test('primary: manual entry normalizes a lowercase code', async ({ page }) => {
    await page.goto('/j');
    await page.getByRole('textbox', { name: /quiz code/i }).fill('abc123');
    await page.getByRole('button', { name: 'Join' }).click();
    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-38');
    expect(page.url()).toContain('/j/abc123/register');
  });

  test('open + returning participant replace-routes straight to the session', async ({ page }) => {
    await page.goto('/j');
    await chooseScenario(page, 'student-quiz-returning');
    await page.getByRole('textbox', { name: /quiz code/i }).fill('ABC123');
    await page.getByRole('button', { name: 'Join' }).click();
    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-39');
    expect(page.url()).toContain('/s/01JBQ8ZK3T7WBM5N2Q4XPRVC9D');
  });

  test('closed session replace-routes to the terminal S-41 screen', async ({ page }) => {
    await page.goto('/j');
    await chooseScenario(page, 'student-quiz-closed');
    await page.getByRole('textbox', { name: /quiz code/i }).fill('ABC123');
    await page.getByRole('button', { name: 'Join' }).click();
    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-41');
  });

  test('session not found stays on S-37, editable, with a named error', async ({ page }) => {
    await page.goto('/j');
    await page.getByRole('textbox', { name: /quiz code/i }).fill('INVALID');
    await page.getByRole('button', { name: 'Join' }).click();
    await expect(page.getByText('That quiz code is not active.')).toBeVisible();
    await expect(page.getByRole('textbox', { name: /quiz code/i })).toHaveValue('INVALID');
  });

  test('failure: unreachable resolve shows retry copy, and retrying succeeds', async ({ page }) => {
    await page.goto('/j');
    await chooseScenario(page, 'student-quiz-failures');
    await page.getByRole('textbox', { name: /quiz code/i }).fill('ABC123');
    await page.getByRole('button', { name: 'Join' }).click();
    await expect(page.getByText('Something went wrong. Try again.')).toBeVisible();
    await expect(page.getByRole('textbox', { name: /quiz code/i })).toHaveValue('ABC123');

    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-38');
  });

  test('offline retains the code and disables Join; restore permits a retry', async ({ page }) => {
    await page.goto('/j');
    await page.getByRole('textbox', { name: /quiz code/i }).fill('ABC123');

    await forceTransition(page, 'student.connection.offline');
    await expect(page.getByRole('status')).toContainText(/offline|reconnecting/i);
    await expect(page.getByRole('button', { name: 'Join' })).toBeDisabled();
    await expect(page.getByRole('textbox', { name: /quiz code/i })).toHaveValue('ABC123');

    await forceTransition(page, 'student.connection.restore');
    await expect(page.getByRole('button', { name: 'Join' })).toBeEnabled({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Join' }).click();
    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-38');
  });
});

test('S-37 overlay reachability sanity', async ({ page }) => {
  await page.goto('/j');
  await openScenarioOverlay(page);
  await expect(page.getByLabel('student-quiz-happy')).toBeVisible();
});

// eduscope:needs-real-d — exercises real D join-code resolution, registration and session close.
realTest.describe('S-37 Join — real', () => {
  realTest(
    'real: invalid/unreachable codes get distinct copy, resolve never creates a participant, a returning cookie skips registration, and a closed code lands on S-41',
    { annotation: { type: 'adapter', description: 'real' } },
    async ({ page, realStack }) => {
      realTest.setTimeout(60_000);
      const joinCode = realStack.fixtureIds.joinCode!;
      const quizSessionId = realStack.fixtureIds.quizSessionId!;

      // Invalid code: named, editable, distinct from every other failure copy.
      await page.goto('/j');
      await page.getByRole('textbox', { name: /quiz code/i }).fill('ZZZZZZ');
      await page.getByRole('button', { name: 'Join' }).click();
      await realExpect(page.getByText('That quiz code is not active.')).toBeVisible();
      await realExpect(page.getByRole('textbox', { name: /quiz code/i })).toHaveValue('ZZZZZZ');

      // D unreachable: distinct retry copy, not reinterpreted as not-found.
      await realStack.control('quiz.stop');
      await page.goto(`/j/${joinCode}`);
      await realExpect(page.getByText('Something went wrong. Try again.')).toBeVisible();
      await realStack.control('quiz.start');

      // A read-only anonymous resolve must never create a participant row.
      const before = await realStack.control<{ count: number }>('quiz.participant-audit', { quizSessionId });
      realExpect(before.count).toBe(0);
      await page.goto(`/j/${joinCode}`);
      await realExpect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-38');
      const afterResolve = await realStack.control<{ count: number }>('quiz.participant-audit', { quizSessionId });
      realExpect(afterResolve.count).toBe(0);

      // Register through the real S-38 UI — this is what actually issues the
      // real participant cookie in the browser (a manually injected cookie
      // can't faithfully stand in for the one a genuine submit sets).
      await page.getByLabel('Full name').fill('E-43 Student');
      await page.getByLabel('Student ID').fill('IT12345678');
      await page.getByRole('button', { name: 'Join' }).click();
      await realExpect(page).toHaveURL(`/s/${quizSessionId}`);
      // The waiting copy only ever renders from a genuine snapshot's
      // question:none event — a still-connecting/never-connected screen
      // would leave this real Playwright wait to time out, unlike the
      // data-screen attribute alone (which is present in both cases).
      await realExpect(page.getByText(/Waiting for your lecturer.s next question/)).toBeVisible({ timeout: 15_000 });
      const afterRegister = await realStack.control<{ count: number }>('quiz.participant-audit', { quizSessionId });
      realExpect(afterRegister.count).toBe(1);

      // Visiting the join link with that cookie replace-routes straight past
      // S-38 to the live session — no second participant is created.
      await page.goto(`/j/${joinCode}`);
      await realExpect(page).toHaveURL(`/s/${quizSessionId}`);
      await realExpect(page.getByText(/Waiting for your lecturer.s next question/)).toBeVisible({ timeout: 15_000 });
      const afterReturn = await realStack.control<{ count: number }>('quiz.participant-audit', { quizSessionId });
      realExpect(afterReturn.count).toBe(1);

      // Close the real session (D's own device-facing close endpoint) and
      // revisit with the same (already valid) participant cookie: the join
      // resolve still routes to the session, which now renders S-41, not an
      // S-37 error — closed is a resolve OUTCOME, never a stuck join screen.
      await realStack.control('quiz.close-session', { quizSessionId });
      await page.goto(`/j/${joinCode}`);
      await realExpect(page).toHaveURL(`/s/${quizSessionId}`);
      await realExpect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-41', { timeout: 15_000 });
    },
  );
});
