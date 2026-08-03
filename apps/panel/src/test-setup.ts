import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// vitest.config.ts sets `globals: false`, so @testing-library/react's
// auto-cleanup (which relies on a globally-injected `afterEach`) never
// registers on its own — without this, DOM nodes leak across tests in the
// same file and later `getByTestId` calls fail with "multiple elements found".
afterEach(cleanup);
