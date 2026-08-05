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

async function expandRoom(page: Page) {
  await page.getByRole('button', { name: 'Show controls' }).click();
  await expect(page.getByRole('region', { name: 'MICROPHONE' })).toBeVisible();
}

test.describe('S-11 Room controls bar', () => {
  test('the primary room journey exposes three regions, mutes, and collapses', async ({ page }) => {
    await signIn(page);
    await expandRoom(page);
    await expect(page.getByRole('region', { name: 'MICROPHONE' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'POWER' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'NOT CONNECTED' })).toBeVisible();
    const mic = page.getByRole('region', { name: 'MICROPHONE' });
    await mic.getByRole('switch', { name: 'Lecturer Mic' }).click();
    await expect(page.getByTestId('mic-master-state')).toHaveText('Muted');
    await page.getByRole('button', { name: 'Collapse' }).click();
    await expect(page.getByRole('region', { name: 'MICROPHONE' })).toHaveCount(0);
  });

  test('a failed mute keeps Live truth and names the failed direction', async ({ page }) => {
    await signIn(page);
    await openScenarioOverlay(page);
    await page.getByRole('checkbox', { name: 'Mic changes fail to apply' }).check();
    await page.getByRole('button', { name: /close scenarios/i }).click();
    await expandRoom(page);
    const mic = page.getByRole('region', { name: 'MICROPHONE' });
    await mic.getByRole('switch', { name: 'Lecturer Mic' }).click();
    await expect(mic.getByRole('switch', { name: 'Lecturer Mic' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('mic-master-state')).toHaveText("Still live — the mute didn't apply.");
  });

  test('the expanded idle bar stays within its 168px envelope', async ({ page }) => {
    await signIn(page);
    await expandRoom(page);
    const box = await page.getByTestId('room-controls-bar').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeLessThanOrEqual(168);
  });

  test('the expanded bar has exactly four tab stops', async ({ page }) => {
    await signIn(page);
    await expandRoom(page);
    await page.getByRole('button', { name: 'Advanced' }).focus();
    const labels: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      labels.push(await page.evaluate(() => {
        const element = document.activeElement as HTMLElement;
        return element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '';
      }));
      await page.keyboard.press('Tab');
    }
    expect(labels).toEqual(['Advanced', 'Collapse', 'Lecturer Mic', 'Power off']);
    await expect(page.getByTestId('room-controls-bar').locator(':focus')).toHaveCount(0);
  });

  test('S-11 and S-09 read and update one shared microphone truth', async ({ page }) => {
    await signIn(page);
    await expandRoom(page);
    const room = page.getByRole('region', { name: 'MICROPHONE' });
    await room.getByRole('switch', { name: 'Lecturer Mic' }).click();
    await expect(page.getByTestId('mic-master-state')).toHaveText('Muted');

    await page.getByRole('button', { name: 'Show sources' }).click();
    const sources = page.getByTestId('mic-row');
    await expect(sources.getByTestId('mic-state')).toHaveText('Muted');
    await sources.getByRole('switch', { name: 'Lecturer Mic' }).click();
    await expect(sources.getByTestId('mic-state')).toHaveText('Live');
    await expect(page.getByTestId('mic-master-state')).toHaveText('Live');
  });

  test('the not-connected region makes no state claims', async ({ page }) => {
    await signIn(page);
    await expandRoom(page);
    const text = await page.getByRole('region', { name: 'NOT CONNECTED' }).innerText();
    expect(text).not.toMatch(/\b(on|off|lowered|raised|\d+%|\d+°C)\b/i);
  });
});
