import { defineWorkspace } from 'vitest/config';

/**
 * Without this, a root `vitest run` executes the app suites (.test.tsx) under
 * the default Node environment with no JSX transform and they all fail — which
 * would make CI's `test` job and Gate 4 meaningless.
 *
 * The two globs delegate to each package's own vitest config, so
 * `pnpm --filter @eduscope/panel test` (used throughout this plan) and a root
 * `pnpm test` run byte-identical settings. Only the root-level `tools/` suite,
 * which belongs to no package, is configured inline.
 */
export default defineWorkspace([
  'packages/*',
  // apps/* delegates to each app's own vitest.config.ts — apps/panel and
  // apps/quiz (added in Tasks 13/18) each set up their own jsdom
  // environment and the React plugin there, not here.
  'apps/*',
  {
    test: {
      name: 'tools',
      environment: 'node',
      include: ['tools/**/*.test.ts'],
    },
  },
]);
