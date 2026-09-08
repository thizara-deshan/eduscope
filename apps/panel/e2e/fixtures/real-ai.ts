import { expect as realExpect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { REAL_STACK_ACCOUNTS, type RealStack } from './real-stack.js';

/** A PM status snapshot with every capture source online. */
export function sourcesOnline(consumers: ReadonlyArray<{ id: string; state: string; pgid: number }>) {
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

export const wait = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

export async function getJson(url: string, token: string): Promise<unknown> {
  return (await fetch(url, { headers: { authorization: `Bearer ${token}` } })).json();
}

function rows<T>(value: unknown): T[] {
  const v = value as { items?: T[] } | T[];
  return Array.isArray(v) ? v : v.items ?? [];
}

/** Logs in the seeded lecturer, starts a real recording, and returns a bearer + the lecture session id. */
export async function startRealRecording(page: Page, realStack: RealStack): Promise<{ token: string; sessionId: string }> {
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

/** Blocks until B has minted the open quiz session against real D. */
export async function waitForOpenQuizSession(realStack: RealStack, token: string): Promise<void> {
  await realExpect.poll(
    async () => (await getJson(`${realStack.coreBaseUrl}/quiz/session`, token) as { state: string }).state,
    { timeout: 20_000 },
  ).toBe('open');
}

/** Generates a real question set and sends one draft to the projector, returning the open publication id. */
export async function publishOneQuestion(realStack: RealStack, token: string, sessionId: string): Promise<string> {
  const base = realStack.coreBaseUrl;
  await realStack.control('core.ai-generate', { count: 3 });
  await fetch(`${base}/ai/generate-now`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
  let draftId: string | undefined;
  for (let i = 0; i < 30 && !draftId; i += 1) {
    draftId = rows<{ id: string; state: string }>(await getJson(`${base}/ai/questions?sessionId=${sessionId}`, token)).find((q) => q.state === 'draft')?.id;
    if (!draftId) await wait(500);
  }
  if (!draftId) throw new Error('publishOneQuestion: no draft generated');
  await fetch(`${base}/ai/questions/${draftId}/send-to-projector`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
  let pubId: string | undefined;
  for (let i = 0; i < 30 && !pubId; i += 1) {
    pubId = rows<{ id: string; state: string }>(await getJson(`${base}/ai/publications?sessionId=${sessionId}`, token)).find((p) => p.state === 'open')?.id;
    if (!pubId) await wait(500);
  }
  if (!pubId) throw new Error('publishOneQuestion: no open publication');
  return pubId;
}
