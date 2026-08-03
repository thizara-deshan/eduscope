import type { ReactNode } from 'react';
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

export function App() {
  return <Stage />;
}
