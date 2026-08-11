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
    <div className="flex min-h-[100dvh] flex-col">
      <header
        role="banner"
        className="sticky top-0 z-10 flex min-h-[52px] items-center gap-2.5 border-b border-border bg-surface/85 px-5 backdrop-blur-md"
      >
        <span
          aria-hidden="true"
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-[15px] font-bold text-primary-fg shadow-sm"
        >
          E
        </span>
        <span className="text-[15px] font-bold tracking-tight text-text">Eduscope Quiz</span>
      </header>
      <ConnectionStrip state={connectionState} />
      <main
        className="quiz-shell__main flex-1"
        data-testid={screenId ? 'screen' : undefined}
        data-screen={screenId}
      >
        {children}
      </main>
    </div>
  );
}
