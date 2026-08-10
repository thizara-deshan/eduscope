import { useEffect, useRef } from 'react';
import type { QuizAppProblem, StudentQuizSessionPayload } from '@eduscope/shared';
import { QuizMobileShell } from '../../components/quiz-mobile-shell.js';
import type { ConnectionState } from '../../components/connection-strip.js';
import { FinalOwnSummary } from './final-own-summary.js';
import { NoParticipationMessage } from './no-participation-message.js';
import { StaleLinkMessage } from './stale-link-message.js';
import './ended.css';

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
      <h1 ref={headingRef} tabIndex={-1}>
        {heading}
      </h1>
      {justReconnected && (
        <p role="status" aria-live="polite">
          Reconnected.
        </p>
      )}
      {staleLink ? (
        <StaleLinkMessage />
      ) : session?.participationState === 'participated' ? (
        <>
          <FinalOwnSummary session={session} />
          <p>You can close this tab now.</p>
        </>
      ) : (
        <NoParticipationMessage />
      )}
    </QuizMobileShell>
  );
}
