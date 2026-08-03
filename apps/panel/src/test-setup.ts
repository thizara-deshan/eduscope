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
