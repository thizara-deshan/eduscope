import { expect, test } from '@playwright/test';
import { chooseScenario, forceTransition } from './overlay-helpers.js';
import { expect as realExpect, test as realTest } from './fixtures/real-stack.js';

test.describe('S-38 Self-registration', () => {
  test('scenario demo checklist: empty, filling, both field failures, submitting', async ({ page }) => {
    await page.goto('/j/ABC123/register');
    await expect(page.getByLabel('Full name')).toHaveValue('');
    await expect(page.getByLabel('Student ID')).toHaveValue('');
    // The policy hint is contract-provided, not hardcoded.
    await expect(page.getByText('Two uppercase letters followed by 7 or 8 digits')).toBeVisible();

    await page.getByLabel('Full name').fill('K. Fernando');
    await page.getByLabel('Student ID').fill('IT12345678');
    await expect(page.getByLabel('Full name')).toHaveValue('K. Fernando');

    await expect(page.getByRole('textbox')).toHaveCount(2);
    await expect(page.locator('form button')).toHaveCount(1);
  });

  test('primary: anonymous join with a valid name/ID creates a participant and routes to the session', async ({ page }) => {
    await page.goto('/j/ABC123/register');
    await page.getByLabel('Full name').fill('K. Fernando');
    await page.getByLabel('Student ID').fill('IT12345678');
    await page.getByRole('button', { name: /join/i }).click();

    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-39');
    expect(page.url()).toContain('/s/01JBQ8ZK3T7WBM5N2Q4XPRVC9D');
  });

  test('a malformed student ID stays on S-38 with the invalid field focused', async ({ page }) => {
    await page.goto('/j/ABC123/register');
    await page.getByLabel('Full name').fill('K. Fernando');
    await page.getByLabel('Student ID').fill('it12');
    await page.getByRole('button', { name: /join/i }).click();

    await expect(page.getByText('Student ID: Two uppercase letters followed by 7 or 8 digits')).toBeVisible();
    await expect(page.getByLabel('Student ID')).toBeFocused();
    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-38');
  });

  test('failure: a race with a closing session routes to the S-41 terminal screen', async ({ page }) => {
    await page.goto('/j/ABC123/register');
    await chooseScenario(page, 'student-quiz-registration-closed');
    await page.getByLabel('Full name').fill('K. Fernando');
    await page.getByLabel('Student ID').fill('IT12345678');
    await page.getByRole('button', { name: /join/i }).click();

    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-41');
  });

  test('duplicate rejoin routes to the session with no separate interstitial', async ({ page }) => {
    await page.goto('/j/ABC123/register');
    await chooseScenario(page, 'student-quiz-returning');
    await page.getByLabel('Full name').fill('K. Fernando');
    await page.getByLabel('Student ID').fill('IT12345678');
    await page.getByRole('button', { name: /join/i }).click();

    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-39');
    expect(page.url()).toContain('/s/01JBQ8ZK3T7WBM5N2Q4XPRVC9D');
  });

  test('offline retains values and blocks submit; restore permits an explicit resubmit', async ({ page }) => {
    await page.goto('/j/ABC123/register');
    await page.getByLabel('Full name').fill('K. Fernando');
    await page.getByLabel('Student ID').fill('IT12345678');

    await forceTransition(page, 'student.connection.offline');
    await expect(page.getByRole('button', { name: /join/i })).toBeDisabled();
    await expect(page.getByLabel('Full name')).toHaveValue('K. Fernando');

    await forceTransition(page, 'student.connection.restore');
    await expect(page.getByRole('button', { name: /join/i })).toBeEnabled({ timeout: 5_000 });
    await page.getByRole('button', { name: /join/i }).click();
    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-39');
  });
});

// eduscope:needs-real-d — exercises real D registration, rejoin, cookie attributes and session-closed race.
realTest.describe('S-38 Self-registration — real', () => {
  realTest(
    'real: registers then rejoins as one durable participant with a JS-invisible cookie, and a session closed before submit is refused with no participant created',
    { annotation: { type: 'adapter', description: 'real' } },
    async ({ page, realStack }) => {
      realTest.setTimeout(60_000);
      const joinCode = realStack.fixtureIds.joinCode!;
      const quizSessionId = realStack.fixtureIds.quizSessionId!;
      const registerUrl = `**/api/student/v1/quiz-sessions/${quizSessionId}/participants`;

      // First registration: created.
      await page.goto(`/j/${joinCode}`);
      await page.getByLabel('Full name').fill('E-44 Student');
      await page.getByLabel('Student ID').fill('IT10000001');
      const [createdResponse] = await Promise.all([
        page.waitForResponse(registerUrl),
        page.getByRole('button', { name: /join/i }).click(),
      ]);
      const created = await createdResponse.json() as { participantId: string; outcome: string };
      realExpect(created.outcome).toBe('created');
      await realExpect(page).toHaveURL(`/s/${quizSessionId}`);

      // The participant cookie is Secure/HttpOnly/SameSite=Lax, scoped to the
      // student API path, and never readable from page JS.
      const cookies = await page.context().cookies();
      const participantCookie = cookies.find((c) => c.name === 'eduscope_participant');
      if (!participantCookie) throw new Error('no participant cookie was set');
      realExpect(participantCookie.httpOnly).toBe(true);
      realExpect(participantCookie.secure).toBe(true);
      realExpect(participantCookie.sameSite).toBe('Lax');
      realExpect(participantCookie.path).toBe('/api/student/v1');
      const visibleToJs = await page.evaluate(() => document.cookie.includes('eduscope_participant'));
      realExpect(visibleToJs).toBe(false);

      const afterFirst = await realStack.control<{ count: number }>('quiz.participant-audit', { quizSessionId });
      realExpect(afterFirst.count).toBe(1);

      // Rejoin: same student ID from a cookie-less visit reuses the SAME
      // participant row and reports `rejoined`, never a second row.
      await page.context().clearCookies();
      await page.goto(`/j/${joinCode}`);
      await realExpect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-38');
      await page.getByLabel('Full name').fill('E-44 Student');
      await page.getByLabel('Student ID').fill('IT10000001');
      const [rejoinedResponse] = await Promise.all([
        page.waitForResponse(registerUrl),
        page.getByRole('button', { name: /join/i }).click(),
      ]);
      const rejoined = await rejoinedResponse.json() as { participantId: string; outcome: string };
      realExpect(rejoined.outcome).toBe('rejoined');
      realExpect(rejoined.participantId).toBe(created.participantId);
      await realExpect(page).toHaveURL(`/s/${quizSessionId}`);
      const afterRejoin = await realStack.control<{ count: number }>('quiz.participant-audit', { quizSessionId });
      realExpect(afterRejoin.count).toBe(1);

      // A session closed AFTER resolve but BEFORE submit refuses registration
      // (D's own state check) with no participant created — replace-routing
      // this never-registered visitor away is S-39/40/41's own concern
      // (later tasks), not this screen's; here only the refusal itself and
      // the durable row count are this task's job to prove.
      await page.context().clearCookies();
      await page.goto(`/j/${joinCode}`);
      await realExpect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-38');
      await page.getByLabel('Full name').fill('Late Student');
      await page.getByLabel('Student ID').fill('IT99999999');
      await realStack.control('quiz.close-session', { quizSessionId });
      const [closedResponse] = await Promise.all([
        page.waitForResponse(registerUrl),
        page.getByRole('button', { name: /join/i }).click(),
      ]);
      realExpect(closedResponse.status()).toBe(409);
      const closedProblem = await closedResponse.json() as { code: string };
      realExpect(closedProblem.code).toBe('quiz.session-closed');
      await realExpect(page).toHaveURL(`/s/${quizSessionId}`);
      const afterRace = await realStack.control<{ count: number }>('quiz.participant-audit', { quizSessionId });
      realExpect(afterRace.count).toBe(1);
    },
  );
});
