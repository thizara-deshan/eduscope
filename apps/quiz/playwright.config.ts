import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    // Spread FIRST: devices['Desktop Chrome'] carries its own viewport,
    // which would silently overwrite the explicit mobile viewport below if
    // spread last (TypeScript ts(2783), caught by Next.js's build typecheck).
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:3000',
    // Portrait, mobile-first — screen-inventory §6's design target.
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm build && pnpm start',
    // No route exists at "/" (only /j/[joinCode] etc.) — Playwright's
    // readiness probe requires a 2xx response, so "/" 404s forever and
    // the webServer never reports ready. Probe an actual app route instead.
    url: 'http://127.0.0.1:3000/j/ABC123',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
