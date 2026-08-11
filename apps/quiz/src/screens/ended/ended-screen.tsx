import { useEffect, useRef } from 'react';
import type { QuizAppProblem, StudentQuizSessionPayload } from '@eduscope/shared';
import { QuizMobileShell } from '../../components/quiz-mobile-shell.js';
import type { ConnectionState } from '../../components/connection-strip.js';
import { FinalOwnSummary } from './final-own-summary.js';
import { NoParticipationMessage } from './no-participation-message.js';
import { StaleLinkMessage } from './stale-link-message.js';

type ClosedSession = Extract<StudentQuizSessionPayload, { state: 'closed' }>;

/**
 * S-41 Session ended. The four terminal bodies are mutually exclusive
 * (screen-inventory Wave 7): a stored `quiz.session-not-found` connect
 * problem wins first (stale link), then the discriminated
 * `participationState` from the closed session payload.
 */
export function EndedScreen({
  session,
  connectProblem,
  connectionState,
  justReconnected = false,
}: {
  session: ClosedSession | null;
  connectProblem: QuizAppProblem | null;
  connectionState: ConnectionState;
  /** True when this snapshot followed a live disruption while offline (offline-close race). */
  justReconnected?: boolean;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const staleLink = connectProblem?.code === 'quiz.session-not-found';
  const heading = staleLink ? 'This quiz link is no longer valid' : 'Quiz ended';

  return (
    <QuizMobileShell screenId="S-41" connectionState={connectionState}>
      <div className="pt-6">
        <span aria-hidden="true" className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-3xl shadow-sm">
          {staleLink ? '🔗' : '🎉'}
        </span>
        <h1 ref={headingRef} tabIndex={-1} className="mt-4 text-3xl font-extrabold tracking-tight text-text outline-none">
          {heading}
        </h1>
      </div>

      {justReconnected && (
        <p role="status" aria-live="polite" className="mt-3 inline-flex items-center gap-2 rounded-full bg-success-soft px-3 py-1 text-sm font-medium text-success">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-success" />
          Reconnected.
        </p>
      )}

      {staleLink ? (
        <StaleLinkMessage />
      ) : session?.participationState === 'participated' ? (
        <>
          <FinalOwnSummary session={session} />
          <p className="mt-5 text-base text-muted">You can close this tab now.</p>
        </>
      ) : (
        <NoParticipationMessage />
      )}
    </QuizMobileShell>
  );
}
