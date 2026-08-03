import type { ReactNode } from 'react';
import { RouterProvider } from 'react-router';
import { AuthProvider } from './auth/auth-context.js';
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

// One router instance for the app's lifetime — react-router owns navigation
// state internally, so this must not be rebuilt on every render.
const router = createRouter();

export function App() {
  return (
    <AuthProvider>
      <Stage>
        <RouterProvider router={router} />
      </Stage>
    </AuthProvider>
  );
}
