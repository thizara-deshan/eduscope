import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { TransportError } from '@eduscope/api-client';
import { QuizAppProblemError } from '@eduscope/api-client/quiz';
import { useQuizClient } from '../../client/quiz-client-provider.js';

export type JoinStatus = 'idle' | 'resolving' | 'not-found' | 'unavailable' | 'unreachable';

function normalize(code: string): string {
  return code.trim();
}

function statusFor(error: unknown): 'not-found' | 'unavailable' | 'unreachable' {
  if (error instanceof QuizAppProblemError) {
    if (error.problem.code === 'quiz.session-not-found') return 'not-found';
    if (error.problem.code === 'quiz.unavailable') return 'unavailable';
  }
  if (error instanceof TransportError) return 'unreachable';
  // Unknown errors get the same bounded, non-leaking unreachable copy.
  return 'unreachable';
}

export function useJoinResolution(initialCode: string, autoSubmit: boolean) {
  const client = useQuizClient();
  const router = useRouter();
  const [code, setCode] = useState(initialCode);
  const [submittedCode, setSubmittedCode] = useState<string | null>(
    autoSubmit && initialCode.length > 0 ? normalize(initialCode) : null,
  );

  const query = useQuery({
    queryKey: ['join-code', submittedCode],
    queryFn: () => client.resolveJoinCode(submittedCode as string),
    enabled: submittedCode !== null,
    retry: false,
  });

  useEffect(() => {
    if (!query.data || submittedCode === null) return;
    const { state, participantState, quizSessionId } = query.data;
    if (state === 'closed' || participantState === 'returning') {
      router.replace(`/s/${quizSessionId}`);
      return;
    }
    router.replace(`/j/${submittedCode}/register`);
  }, [query.data, router, submittedCode]);

  const submit = (nextCode: string) => {
    const normalized = normalize(nextCode);
    setCode(normalized);
    setSubmittedCode(normalized);
  };

  const status: JoinStatus =
    submittedCode === null ? 'idle' : query.isPending || query.isFetching ? 'resolving' : query.isError ? statusFor(query.error) : 'idle';

  return {
    code,
    setCode,
    submit,
    status,
    // A retry re-submits the SAME code, so the query key is unchanged —
    // `refetch()` is what actually re-runs it (setState with an identical
    // value would bail out of the re-render with no query key change).
    retry: () => { void query.refetch(); },
  };
}
