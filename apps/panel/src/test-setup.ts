import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

// React's `act()` (imported directly from 'react', not @testing-library/react)
// warns "not configured to support act" unless this global is set — RTL's own
// render()/renderHook() set it internally, but a bare `import { act } from
// 'react'` in a test file (used for flushing fake-timer-driven state updates)
// runs before that, so it must be set here instead.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// vitest.config.ts sets `globals: false`, so @testing-library/react's
// auto-cleanup (which relies on a globally-injected `afterEach`) never
// registers on its own — without this, DOM nodes leak across tests in the
// same file and later `getByTestId` calls fail with "multiple elements found".
afterEach(cleanup);

// The panel now fetches deploy-owned `/config.json` before constructing any
// client (Workstream E-01). There is no dev server in unit tests, so serve the
// committed mock demo config here — the real network is never contacted. Tests
// that need a specific runtime config inject it via `<RuntimeConfigProvider
// config=…>` or their own fetch, both of which bypass this fallback.
const realFetch = globalThis.fetch?.bind(globalThis);
globalThis.fetch = ((input: unknown, init?: unknown): Promise<Response> => {
  const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? '');
  if (url.endsWith('/config.json')) {
    return Promise.resolve(
      new Response(
        JSON.stringify({
          apiBaseUrl: '/api/v1',
          quizBaseUrl: 'https://quiz.example.edu',
          environment: 'development',
          adapters: { default: 'mock', overrides: {} },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
  }
  if (realFetch) return realFetch(input as RequestInfo, init as RequestInit);
  return Promise.reject(new Error(`unstubbed fetch: ${url}`));
}) as typeof fetch;
