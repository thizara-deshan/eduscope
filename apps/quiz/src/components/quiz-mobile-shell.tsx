import type { ReactNode } from 'react';
import { ConnectionStrip, type ConnectionState } from './connection-strip.js';

export function QuizMobileShell({
  children,
  connectionState = 'online',
  screenId,
}: {
  children: ReactNode;
  connectionState?: ConnectionState;
  /** Sets `data-testid="screen"` / `data-screen` on the landmark (screen-inventory §6 route-skeleton contract). */
  screenId?: string;
}) {
  return (
    <div className="quiz-shell">
      <header className="quiz-shell__brand" role="banner">
        Eduscope Quiz
      </header>
      <ConnectionStrip state={connectionState} />
      <main className="quiz-shell__main" data-testid={screenId ? 'screen' : undefined} data-screen={screenId}>
        {children}
      </main>
    </div>
  );
}
