import { lazy, Suspense, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { resolveSelection } from '@eduscope/api-client';
import { AuthProvider } from './auth/auth-context.js';
import { ClientProvider } from './client/client-provider.js';
import { RuntimeConfigProvider, useRuntimeConfig } from './config/runtime-config.js';
import { createQueryClient } from './query/query-client.js';
import { createRouter } from './routes/router.js';
import './styles/tokens.css';
import './styles/app.css';

/**
 * The dev overlay renders `listScenarios()`, which anchors the whole scenario
 * catalog — all scripts and the machines behind them — into whatever chunk
 * imports it. It is imported through a dynamic `import()`, so it gets its own
 * chunk; gating the render on a live mock domain (below) means a fully real
 * deployment never triggers that import and never fetches the chunk.
 *
 * The gate is the ADAPTER SELECTION at RUNTIME, not `import.meta.env`: the
 * overlay only ever does anything against a mock client, so it should appear
 * exactly when a domain is running on the mock.
 */
const ScenarioOverlay = lazy(() =>
  import('./devtools/scenario-overlay.js').then((m) => ({ default: m.ScenarioOverlay })),
);

/** Renders the dev overlay only when at least one domain selects the mock. */
function DevOverlaySlot() {
  const config = useRuntimeConfig();
  const selection = resolveSelection(config);
  const anyMock = Object.values(selection).some((kind) => kind === 'mock');
  if (!anyMock) return null;
  return (
    <Suspense fallback={null}>
      <ScenarioOverlay />
    </Suspense>
  );
}

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

// One instance each for the app's lifetime — react-router owns navigation
// state internally, and TanStack Query's cache would reset on every rebuild.
const router = createRouter();
const queryClient = createQueryClient();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RuntimeConfigProvider>
        <ClientProvider>
          <AuthProvider>
            <Stage>
              <RouterProvider router={router} />
              <DevOverlaySlot />
            </Stage>
          </AuthProvider>
        </ClientProvider>
      </RuntimeConfigProvider>
    </QueryClientProvider>
  );
}
