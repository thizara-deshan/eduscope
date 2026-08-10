import type { ReactNode } from 'react';
import { ConnectionStrip, type ConnectionState } from './connection-strip.js';

export function QuizMobileShell({
  children,
  connectionState = 'online',
}: {
  children: ReactNode;
  connectionState?: ConnectionState;
}) {
  return (
    <div className="quiz-shell">
      <header className="quiz-shell__brand" role="banner">
        Eduscope Quiz
      </header>
      <ConnectionStrip state={connectionState} />
      <main className="quiz-shell__main">{children}</main>
    </div>
  );
}
