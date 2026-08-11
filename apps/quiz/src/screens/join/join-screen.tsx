'use client';

import { QuizMobileShell } from '../../components/quiz-mobile-shell.js';
import { Card, CardContent } from '../../components/ui/card.js';
import { useQuizConnectionState } from '../../store/selectors.js';
import { JoinCodeForm } from './join-code-form.js';
import { JoinStatus } from './join-status.js';
import { useJoinResolution } from './use-join-resolution.js';

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
      <div className="pt-6">
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">Live quiz</p>
        <h1 className="mt-1.5 text-3xl font-extrabold tracking-tight text-text">Join the quiz</h1>
        <p className="mt-2 text-base text-muted">Enter the code shown on your lecturer&rsquo;s screen.</p>
      </div>

      <Card className="mt-6">
        <CardContent className="p-5">
          <JoinCodeForm
            code={code}
            onChange={setCode}
            onSubmit={submit}
            disabled={connectionState !== 'online' || status === 'resolving'}
          />
        </CardContent>
      </Card>

      <JoinStatus status={status} onRetry={retry} />
    </QuizMobileShell>
  );
}
