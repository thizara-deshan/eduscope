import { useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useQuizIdentity } from '../../client/quiz-client-provider.js';
import { useQuizStore } from '../../store/quiz-store.js';

export interface RegistrationInput {
  readonly fullName: string;
  readonly studentIdNumber: string;
}

/** Both `created` and `rejoined` land on the same session route (W7-D-3) — there is no separate success interstitial. */
export function useRegistration(joinCode: string) {
  const identity = useQuizIdentity();
  const router = useRouter();

  // The real student WS requires a participant cookie that doesn't exist
  // until this very screen's submit succeeds — attempting it here would only
  // ever fail and would permanently disable this screen's own submit button
  // (see quiz-store.ts).
  useEffect(() => {
    useQuizStore.getState().disableConnect();
    return () => useQuizStore.getState().enableConnect();
  }, []);

  return useMutation({
    mutationFn: (input: RegistrationInput) =>
      identity.register(joinCode, { displayName: input.fullName, studentIdNumber: input.studentIdNumber }),
    onSuccess: (registered) => {
      router.replace(`/s/${registered.quizSessionId}`);
    },
  });
}
