import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { AuthProvider } from './auth/auth-context.js';
import { ClientProvider, useClient } from './client/client-provider.js';
import { createQueryClient } from './query/query-client.js';
import { createRouter } from './routes/router.js';
import { useRecordingState } from './store/selectors.js';
import './styles/tokens.css';
import './styles/app.css';

/**
 * The dev overlay renders `listScenarios()`, which anchors the whole scenario
 * catalog — all seven scripts and the machines behind them — into whatever chunk
 * imports it. `import.meta.env.DEV` is statically replaced at build time, so this
 * ternary lets Rollup drop the entire subtree from a production build instead of
 * shipping a debug tool to a lecture-hall kiosk.
 */
const ScenarioOverlay = import.meta.env.DEV
  ? lazy(() =>
      import('./devtools/scenario-overlay.js').then((m) => ({ default: m.ScenarioOverlay })),
    )
  : () => null;

/**
 * The kiosk stage. `.us-panel` is capped at 1280x800 and is the positioning
 * context for every overlay (frontend-conventions §3, prototype CLAUDE.md).
 */
export function Stage({ children }: { children?: ReactNode }) {
  return (
    <div className="us-stage">
      <div className="us-panel" data-testid="us-panel">
        {children}
      </div>
    </div>
  );
}

/**
 * Two scaffold-only seams for the smoke test (Task 19):
 *  - `data-recording-state` mirrors the WS store so e2e asserts on STATE, not
 *    on screen markup that prompt 09 will replace wholesale.
 *  - the start button is a placeholder for S-04's Start pill and is removed
 *    the moment S-04 lands.
 */
declare global {
  interface Window {
    __renderCount?: number;
  }
}

function ScaffoldShell() {
  const client = useClient();
  const state = useRecordingState(); // atomic selector — see store/selectors.ts

  // Gate 1e counts COMMITS of this component to prove telemetry never renders.
  // It lives in an effect, not the render body: StrictMode renders twice and
  // throws one away, so a counter incremented during render reports 2x per
  // commit and mutates module state from a function that must stay pure.
  // Removed with the button when S-04 lands.
  useEffect(() => {
    window.__renderCount = (window.__renderCount ?? 0) + 1;
  });

  return (
    <div data-recording-state={state}>
      <button
        type="button"
        data-testid="e2e-start-recording"
        onClick={() => {
          void client.startRecording().catch(() => {
            /* refusals surface in S-04; the scaffold only needs the command sent */
          });
        }}
      >
        Start recording
      </button>
    </div>
  );
}

// One instance each for the app's lifetime — react-router owns navigation
// state internally, and TanStack Query's cache would reset on every rebuild.
const router = createRouter();
const queryClient = createQueryClient();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ClientProvider>
        <AuthProvider>
          <Stage>
            <RouterProvider router={router} />
            <Suspense fallback={null}>
              <ScenarioOverlay />
            </Suspense>
            <ScaffoldShell />
          </Stage>
        </AuthProvider>
      </ClientProvider>
    </QueryClientProvider>
  );
}
