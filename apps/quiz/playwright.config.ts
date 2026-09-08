import { defineConfig, devices } from '@playwright/test';

// Real-adapter runs need the frontend served over HTTPS, schemeful-same-site
// with the real quiz-service test peer (always HTTPS-only) — see
// e2e/https-frontend.mjs for why a plain-HTTP frontend can never carry the
// real SameSite=Lax participant cookie back to the API. Mock/default runs
// (no EDUSCOPE_E2E_ADAPTER) are unaffected. Kept as a literal, not imported
// from https-frontend.mjs, so this config file stays loadable under
// Playwright's own CJS/ESM config loader regardless of that script's module
// format; EDUSCOPE_QUIZ_HTTPS_PORT there defaults to the same value.
const realAdapter = process.env.EDUSCOPE_E2E_ADAPTER === 'real';
const HTTPS_PORT = Number(process.env.EDUSCOPE_QUIZ_HTTPS_PORT ?? 3443);
const baseURL = realAdapter ? `https://127.0.0.1:${String(HTTPS_PORT)}` : 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  // E-50: named `mock` and `real` projects, conditional on the adapter env so
  // existing runs are unchanged (mock/default exposes `mock`, HTTPS real runs
  // expose `real`). The gate selects one with `--project=<name>`.
  projects: realAdapter
    ? [{ name: 'real', grep: /real:/ }]
    : [{ name: 'mock', grepInvert: /real:/ }],
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    // Spread FIRST: devices['Desktop Chrome'] carries its own viewport,
    // which would silently overwrite the explicit mobile viewport below if
    // spread last (TypeScript ts(2783), caught by Next.js's build typecheck).
    ...devices['Desktop Chrome'],
    baseURL,
    // Portrait, mobile-first — screen-inventory §6's design target.
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
    ...(realAdapter ? { ignoreHTTPSErrors: true } : {}),
    // Air-gapped/firewalled hosts can't reach Playwright's browser CDN; point
    // at a locally installed Chromium instead (no effect unless the env is set).
    ...(process.env.EDUSCOPE_PLAYWRIGHT_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.EDUSCOPE_PLAYWRIGHT_CHROMIUM_PATH } }
      : {}),
  },
  webServer: realAdapter
    ? {
        command: 'pnpm build && node e2e/https-frontend.mjs',
        url: `${baseURL}/j/ABC123`,
        ignoreHTTPSErrors: true,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : {
        command: 'pnpm build && pnpm start',
        // No route exists at "/" (only /j/[joinCode] etc.) — Playwright's
        // readiness probe requires a 2xx response, so "/" 404s forever and
        // the webServer never reports ready. Probe an actual app route instead.
        url: `${baseURL}/j/ABC123`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
