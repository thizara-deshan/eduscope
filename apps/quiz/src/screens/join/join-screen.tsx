'use client';

import { QuizMobileShell } from '../../components/quiz-mobile-shell.js';
import { useQuizConnectionState } from '../../store/selectors.js';
import { JoinCodeForm } from './join-code-form.js';
import { JoinStatus } from './join-status.js';
import { useJoinResolution } from './use-join-resolution.js';
import './join.css';

/**
 * S-37 Join. `/j` renders this with `autoSubmit=false` (the manual-entry
 * alias, W7-D-1); `/j/[joinCode]` renders it with `autoSubmit=true` so the QR
 * deep-link resolves without a tap. Both share one resolver — there is no
 * separate "manual join" screen.
 */
export function JoinScreen({ initialCode, autoSubmit }: { initialCode: string; autoSubmit: boolean }) {
  const connectionState = useQuizConnectionState();
  const { code, setCode, submit, status, retry } = useJoinResolution(initialCode, autoSubmit);

  return (
    <QuizMobileShell screenId="S-37" connectionState={connectionState}>
      <h1>Join the quiz</h1>
      <JoinCodeForm
        code={code}
        onChange={setCode}
        onSubmit={submit}
        disabled={connectionState !== 'online' || status === 'resolving'}
      />
      <JoinStatus status={status} onRetry={retry} />
    </QuizMobileShell>
  );
}
