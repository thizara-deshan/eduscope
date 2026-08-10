import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// vitest.config.ts sets `globals: false`, so @testing-library/react's
// auto-cleanup (which relies on a globally-injected `afterEach`) never
// registers on its own — without this, DOM nodes leak across tests in the
// same file and later `getByTestId` calls fail with "multiple elements found"
// (same gap found and fixed in apps/panel, Task 13).
afterEach(cleanup);

// S-37/S-38 replace-route on resolution; nothing here renders inside a real
// Next.js app router. One shared router object so a test can import
// `useRouter` and assert on `router.replace.mock.calls` directly.
vi.mock('next/navigation', () => {
  const router = { replace: vi.fn(), push: vi.fn(), back: vi.fn(), refresh: vi.fn(), forward: vi.fn(), prefetch: vi.fn() };
  return {
    useRouter: () => router,
    usePathname: () => '/',
    useSearchParams: () => new URLSearchParams(),
  };
});

afterEach(() => vi.clearAllMocks());
