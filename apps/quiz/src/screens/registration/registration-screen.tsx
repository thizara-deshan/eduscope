'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { TransportError } from '@eduscope/api-client';
import { QuizAppProblemError } from '@eduscope/api-client/quiz';
import { QuizMobileShell } from '../../components/quiz-mobile-shell.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';
import { useQuizClient } from '../../client/quiz-client-provider.js';
import { useQuizConnectionState } from '../../store/selectors.js';
import { RegistrationForm } from './registration-form.js';
import { useRegistration } from './use-registration.js';

function bannerFor(error: unknown): string | null {
  if (error instanceof QuizAppProblemError) {
    // Field-level problems (invalid name/ID) render inline on the field, not
    // as a banner; quiz.session-closed replace-routes away entirely.
    if (error.problem.code === 'quiz.unavailable') return 'Quiz service unavailable. Try again.';
    return null;
  }
  if (error instanceof TransportError) return 'Something went wrong. Try again.';
  if (error) return 'Something went wrong. Try again.';
  return null;
}

/** S-38 Self-registration. Reached only after S-37 confirms an open, anonymous code — or by a direct link. */
export function RegistrationScreen({ joinCode }: { joinCode: string }) {
  const client = useQuizClient();
  const router = useRouter();
  const connectionState = useQuizConnectionState();

  const resolveQuery = useQuery({
    queryKey: ['join-code', joinCode],
    queryFn: () => client.resolveJoinCode(joinCode),
    retry: false,
  });
  const registration = useRegistration(joinCode);

  const sessionClosedRace =
    registration.error instanceof QuizAppProblemError && registration.error.problem.code === 'quiz.session-closed';

  useEffect(() => {
    if (resolveQuery.data?.state === 'closed') {
      router.replace(`/s/${resolveQuery.data.quizSessionId}`);
    }
  }, [resolveQuery.data, router]);

  useEffect(() => {
    if (sessionClosedRace && resolveQuery.data) {
      router.replace(`/s/${resolveQuery.data.quizSessionId}`);
    }
  }, [sessionClosedRace, resolveQuery.data, router]);

  if (resolveQuery.isPending) {
    return (
      <QuizMobileShell screenId="S-38" connectionState={connectionState}>
        <p role="status" aria-live="polite" className="pt-8 text-center text-base text-muted">
          Loading…
        </p>
      </QuizMobileShell>
    );
  }

  if (resolveQuery.isError) {
    return (
      <QuizMobileShell screenId="S-38" connectionState={connectionState}>
        <div role="alert" className="mt-6 rounded-2xl border border-danger/30 bg-danger-soft px-5 py-4">
          <p className="m-0 text-base font-medium text-danger">Something went wrong. Try again.</p>
          <Button type="button" variant="outline" className="mt-4" onClick={() => void resolveQuery.refetch()}>
            Try again
          </Button>
        </div>
      </QuizMobileShell>
    );
  }

  if (resolveQuery.data.state === 'closed' || sessionClosedRace) {
    // Redirecting — render nothing rather than a flash of the form.
    return <QuizMobileShell screenId="S-38" connectionState={connectionState}>{null}</QuizMobileShell>;
  }

  const fieldViolations =
    registration.error instanceof QuizAppProblemError ? registration.error.problem.fieldViolations : undefined;
  const banner = bannerFor(registration.error);

  return (
    <QuizMobileShell screenId="S-38" connectionState={connectionState}>
      <div className="pt-6">
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">You&rsquo;re in</p>
        <h1 className="mt-1.5 text-3xl font-extrabold tracking-tight text-text">Join the quiz</h1>
        <p className="mt-2 text-base text-muted">Add your details so your lecturer can see your score.</p>
      </div>

      {banner && (
        <div role="alert" className="mt-5 rounded-2xl border border-danger/30 bg-danger-soft px-5 py-4 text-base font-medium text-danger">
          {banner}
        </div>
      )}

      <Card className="mt-6">
        <CardContent className="p-5">
          <RegistrationForm
            policy={resolveQuery.data.registrationPolicy}
            onSubmit={(values) => registration.mutate(values)}
            submitting={registration.isPending}
            disabled={connectionState !== 'online'}
            fieldViolations={fieldViolations}
          />
        </CardContent>
      </Card>
    </QuizMobileShell>
  );
}
