import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    // Spread FIRST: devices['Desktop Chrome'] carries its own 1280x720
    // viewport, which would silently overwrite the explicit 800px height
    // below if it were spread last — confirmed by TypeScript's ts(2783)
    // ("specified more than once") once apps/quiz's stricter Next.js build
    // typecheck caught the same pattern in this file's sibling.
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4173',
    // The kiosk viewport is not a preference; it is the spec.
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm build && pnpm preview',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
