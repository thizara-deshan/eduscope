import { expect, test, type Page } from '@playwright/test';

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
