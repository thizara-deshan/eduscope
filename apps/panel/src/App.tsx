import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { AuthProvider } from './auth/auth-context.js';
import { ClientProvider } from './client/client-provider.js';
import { createQueryClient } from './query/query-client.js';
import { createRouter } from './routes/router.js';
import './styles/tokens.css';
import './styles/app.css';

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
      <ClientProvider>
        <AuthProvider>
          <Stage>
            <RouterProvider router={router} />
          </Stage>
        </AuthProvider>
      </ClientProvider>
    </QueryClientProvider>
  );
}
