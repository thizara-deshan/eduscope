import { test as base, expect } from '@playwright/test';

interface RealStackDescriptor {
  readonly coreBaseUrl: string;
  readonly quizBaseUrl: string;
  readonly quizTlsBaseUrl?: string;
  readonly controls: { readonly core: string; readonly quiz: string };
  readonly fixtureIds: Record<string, string>;
}

function descriptor(): RealStackDescriptor {
  const encoded = process.env.EDUSCOPE_REAL_STACK_DESCRIPTOR;
  if (!encoded) throw new Error('real Playwright fixture requires EDUSCOPE_REAL_STACK_DESCRIPTOR');
  return JSON.parse(encoded) as RealStackDescriptor;
}

export const test = base.extend<{ realStack: RealStackDescriptor }>({
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
    await use(stack);
  },
});

test.use({ ignoreHTTPSErrors: true });

export { expect };
