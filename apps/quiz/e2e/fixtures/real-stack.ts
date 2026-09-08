import { test as base, expect } from '@playwright/test';

interface RealStackDescriptor {
  readonly coreBaseUrl: string;
  readonly quizBaseUrl: string;
  readonly quizTlsBaseUrl?: string;
  readonly controls: { readonly core: string; readonly quiz: string };
  readonly fixtureIds: Record<string, string>;
}

export interface RealStack extends RealStackDescriptor {
  control<T = unknown>(action: string, input?: unknown): Promise<T>;
}

function descriptor(): RealStackDescriptor {
  const encoded = process.env.EDUSCOPE_REAL_STACK_DESCRIPTOR;
  if (!encoded) throw new Error('real Playwright fixture requires EDUSCOPE_REAL_STACK_DESCRIPTOR');
  return JSON.parse(encoded) as RealStackDescriptor;
}

async function control<T>(stack: RealStackDescriptor, action: string, input?: unknown): Promise<T> {
  const group = action.startsWith('quiz.') ? 'quiz' : 'core';
  const response = await fetch(stack.controls[group], {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, input }),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`real-stack control ${action} returned ${String(response.status)}: ${raw}`);
  return raw.length === 0 ? (undefined as T) : (JSON.parse(raw) as T);
}

export const test = base.extend<{ realStack: RealStack }>({
  realStack: async ({ page }, use) => {
    const stack = descriptor();
    await page.route('**/config.json', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          apiBaseUrl: stack.coreBaseUrl,
          quizBaseUrl: stack.quizTlsBaseUrl ?? stack.quizBaseUrl,
          environment: 'integration',
          adapters: { default: 'real', overrides: {} },
        }),
      });
    });
    await use({ ...stack, control: (action, input) => control(stack, action, input) });
  },
});

test.use({ ignoreHTTPSErrors: true });

export { expect };
