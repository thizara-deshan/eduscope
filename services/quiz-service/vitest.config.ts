import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    hookTimeout: 60_000,
    testTimeout: 90_000,
    fileParallelism: false,
  },
});
