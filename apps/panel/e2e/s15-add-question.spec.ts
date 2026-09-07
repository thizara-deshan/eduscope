import { expect, test, type Page } from '@playwright/test';
import { REAL_STACK_ACCOUNTS, expect as realExpect, test as realTest } from './fixtures/real-stack.js';

interface QuestionAudit {
  questions: Array<{
    id: string; provenance: string; state: string; createdBy: string | null;
    createAudit: { actorUserId: string | null; actorKind: string } | null;
  }>;
}

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

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Username').fill('a.perera');
  await page.getByLabel('Password').fill('correct-horse');
  await page.getByRole('button', { name: 'Log In' }).click();
  await expect(page).toHaveURL('/');
}

async function startRecording(page: Page) {
  await page.getByRole('button', { name: 'Start Recording' }).click();
  await expect(page.locator('[data-screen="S-13"]')).toBeVisible({ timeout: 10_000 });
}

async function openAddQuestion(page: Page) {
  await page.getByRole('button', { name: 'Generate Questions Now' }).click();
  await expect(page.getByTestId('questions-modal')).toBeVisible();
  await page.getByRole('button', { name: 'Add Question' }).click();
  const dialog = page.getByTestId('add-question-dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('S-15 Add Question', () => {
  test('primary: prompt + 2 choices + correct -> save -> a new Yours draft appears in S-14', async ({ page }) => {
    test.setTimeout(30_000);
    await signIn(page);
    await startRecording(page);
    const dialog = await openAddQuestion(page);

    await dialog.getByLabel('Question', { exact: true }).fill('What year did the course start?');
    await dialog.getByRole('textbox', { name: 'Choice A' }).fill('2024');
    await dialog.getByRole('textbox', { name: 'Choice B' }).fill('2025');
    // Blur the field so the on-screen keyboard closes and stops covering the
    // correct-answer letter row (the OSK stays open after Playwright's
    // programmatic .fill(), unlike a real tap-away).
    await dialog.locator('h2').click();
    await dialog.getByRole('button', { name: 'Mark choice B as correct' }).click();
    await dialog.getByRole('button', { name: 'Save Question' }).click();

    await expect(page.getByTestId('add-question-dialog')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText('What year did the course start?')).toBeVisible();
    await expect(page.getByText('Yours').first()).toBeVisible();
  });

  test('invalid: submit stays blocked until the prompt and every choice are filled', async ({ page }) => {
    test.setTimeout(30_000);
    await signIn(page);
    await startRecording(page);
    const dialog = await openAddQuestion(page);

    await expect(dialog.getByRole('button', { name: 'Save Question' })).toBeDisabled();
    await expect(page.getByTestId('add-question-invalid-reason')).toContainText(/enter a question/i);

    await dialog.getByLabel('Question', { exact: true }).fill('A question?');
    await expect(page.getByTestId('add-question-invalid-reason')).toContainText(/fill in every choice/i);

    await dialog.getByRole('textbox', { name: 'Choice A' }).fill('X');
    await dialog.getByRole('textbox', { name: 'Choice B' }).fill('Y');
    await expect(dialog.getByRole('button', { name: 'Save Question' })).toBeEnabled();
  });
});

realTest.describe('S-15 Add Question — real', () => {
  realTest(
    'real: the server refuses an invalid MCQ (zero rows) while a valid one persists as a lecturer-authored draft with a user-actor audit row',
    { annotation: { type: 'adapter', description: 'real' } },
    async ({ page, realStack }) => {
      realTest.setTimeout(90_000);
      await realStack.control('core.pm.status', { status: sourcesOnline([]) });

      await page.goto('/login');
      await page.getByLabel('Username').fill(REAL_STACK_ACCOUNTS.lecturer.username);
      await page.getByLabel('Password').fill(REAL_STACK_ACCOUNTS.lecturer.password);
      await page.getByRole('button', { name: 'Log In' }).click();
      await realExpect(page).toHaveURL('/');
      await page.getByRole('button', { name: 'Start Recording' }).click();
      await realExpect.poll(async () => (await realStack.processAudit()).recordStarts).toBe(1);
      await realStack.control('core.pm.publish', {
        event: 'evt.pm.consumer.running', data: { consumerId: 'record:00000001', pgid: 4101 },
      });
      await realExpect(page.getByTestId('ai-studio-card')).toHaveAttribute('data-state', 'armed', { timeout: 15_000 });

      const { accessToken } = await realStack.login('lecturer');
      const me = await (await fetch(`${realStack.coreBaseUrl}/auth/me`, {
        headers: { authorization: `Bearer ${accessToken}` },
      })).json() as { id: string };

      // Client validation is assistance, not authority: prove the server is the
      // authority by submitting an invalid correctness shape (two correct
      // options) directly. It must be refused and leave zero rows.
      const refusal = await fetch(`${realStack.coreBaseUrl}/ai/questions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ prompt: 'Two correct answers?', options: [
          { text: 'A', isCorrect: true }, { text: 'B', isCorrect: true },
        ] }),
      });
      realExpect(refusal.status).toBe(422);
      realExpect((await refusal.json() as { code: string }).code).toBe('validation.invalid');
      realExpect((await realStack.control<QuestionAudit>('core.question-audit')).questions, 'refused submit stored nothing').toHaveLength(0);

      // A valid 2–4 option MCQ authored in the dialog persists as a draft.
      await page.getByRole('button', { name: 'Generate Questions Now' }).click();
      await realExpect(page.getByTestId('questions-modal')).toBeVisible();
      await page.getByRole('button', { name: 'Add Question' }).click();
      const dialog = page.getByTestId('add-question-dialog');
      await realExpect(dialog).toBeVisible();
      await dialog.getByLabel('Question', { exact: true }).fill('Which layer routes packets?');
      await dialog.getByRole('textbox', { name: 'Choice A' }).fill('Network');
      await dialog.getByRole('textbox', { name: 'Choice B' }).fill('Physical');
      await dialog.locator('h2').click();
      await dialog.getByRole('button', { name: 'Mark choice B as correct' }).click();
      await dialog.getByRole('button', { name: 'Save Question' }).click();

      // The dialog only closes on the real `ai.question{draft,lecturer-authored}`
      // echo — never the 202 — so its dismissal is itself proof the echo landed.
      await realExpect(dialog).toHaveCount(0, { timeout: 15_000 });

      // Exactly one lecturer-authored draft, with lecturer provenance and a
      // user-actor audit row naming this lecturer.
      const audit = await realStack.control<QuestionAudit>('core.question-audit');
      const authored = audit.questions.filter((q) => q.provenance === 'lecturer-authored');
      realExpect(authored).toHaveLength(1);
      realExpect(authored[0]!).toMatchObject({ state: 'draft', createdBy: me.id });
      realExpect(authored[0]!.createAudit).toMatchObject({ actorKind: 'user', actorUserId: me.id });
    },
  );
});
