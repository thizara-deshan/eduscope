import { test as base, expect } from '@playwright/test';

interface RealStackDescriptor {
  readonly coreBaseUrl: string;
  readonly quizBaseUrl: string;
  readonly quizTlsBaseUrl?: string;
  readonly controls: { readonly core: string; readonly quiz: string };
  readonly fixtureIds: Record<string, string>;
}

/** Fixed, non-secret credentials seeded by `packages/api-client/test/real/fixtures/core-peer.ts`. */
export const REAL_STACK_ACCOUNTS = {
  lecturer: { username: 'e06-lecturer', password: 'E06LecturerPass1!' },
  other: { username: 'e06-other', password: 'E06OtherLecturerPass1!' },
  admin: { username: 'e06-admin', password: 'E06AdminPassphrase1!' },
  reset: { username: 'e06-reset', password: 'E06ResetPassphrase1!' },
  disabled: { username: 'e06-disabled', password: 'E06DisabledPassphrase1!' },
} as const;

export interface RealStack extends RealStackDescriptor {
  control<T = unknown>(action: string, input?: unknown): Promise<T>;
  login(account?: keyof typeof REAL_STACK_ACCOUNTS): Promise<{ accessToken: string }>;
  recordingAudit(): Promise<{ lectureSessions: number; recordStarts: number }>;
  processAudit(): Promise<{
    recordStarts: number; liveStarts: number; meetingStarts: number;
    processEvents: Array<{ consumerId: string; pgid: number | null; state: string }>;
  }>;
  ledger(): Promise<{
    helper: Array<{ verb: string }>;
    pm: Array<{ method: string; path: string; body?: Record<string, unknown> }>;
    relay: unknown[];
  }>;
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

/**
 * Polyfills the `URL.parse` static method (spec'd/shipped in Chromium 126+,
 * absent from older browsers such as this environment's system Chromium
 * 114). Playwright's own page-context instrumentation (playwright-core's
 * bundle, not this app) calls it unconditionally; without this, the browser
 * throws `TypeError: URL.parse is not a function` deep inside Playwright's
 * own tracking, which breaks its URL/navigation bookkeeping — the app itself
 * navigates fine, but `page.waitForURL`/`toHaveURL` never observe it.
 */
function installUrlParsePolyfill(): void {
  if (typeof URL.parse === 'function') return;
  URL.parse = (input: string | URL, base?: string | URL): URL | null => {
    try {
      return new URL(input, base);
    } catch {
      return null;
    }
  };
}

export const test = base.extend<{ realStack: RealStack }>({
  realStack: async ({ page }, use) => {
    const stack = descriptor();
    await page.addInitScript(installUrlParsePolyfill);
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
    await use({
      ...stack,
      control: (action, input) => control(stack, action, input),
      async login(account = 'lecturer') {
        const response = await fetch(`${stack.coreBaseUrl}/auth/login`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...REAL_STACK_ACCOUNTS[account], client: 'panel' }),
        });
        if (!response.ok) throw new Error(`real-stack login returned ${String(response.status)}`);
        const body = await response.json() as { tokens: { accessToken: string } };
        return { accessToken: body.tokens.accessToken };
      },
      recordingAudit: () => control(stack, 'core.recording-audit'),
      processAudit: () => control(stack, 'core.process-audit'),
      ledger: () => control(stack, 'core.ledger'),
    });
  },
});

test.use({ ignoreHTTPSErrors: true });

export { expect };
