import os from 'node:os';
import { defineConfig } from 'vitest/config';

// Many suites here boot a Fastify server plus fake upstreams and then poll for
// async effects on real wall-clock deadlines (the per-file `waitFor` helpers).
// One fork per core oversubscribes the box — with 8 cores the full run drives
// load past 16 — which starves those poll loops and produces load-induced
// flakes that pass in isolation. Give each fork real headroom so polling stays
// responsive; small CI runners still keep at least 2 forks (so a 2-core runner
// is unchanged), while an 8-core dev box runs 2 instead of 8.
const maxWorkers = Math.max(2, Math.floor(os.availableParallelism() / 4));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    restoreMocks: true,
    clearMocks: true,
    testTimeout: 10_000,
    maxWorkers,
    minWorkers: 1,
  },
});
