import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useQuizIdentity } from '../../client/quiz-client-provider.js';

export interface RegistrationInput {
  readonly fullName: string;
  readonly studentIdNumber: string;
}

/** Both `created` and `rejoined` land on the same session route (W7-D-3) — there is no separate success interstitial. */
export function useRegistration(joinCode: string) {
  const identity = useQuizIdentity();
  const router = useRouter();

  return useMutation({
    mutationFn: (input: RegistrationInput) =>
      identity.register(joinCode, { displayName: input.fullName, studentIdNumber: input.studentIdNumber }),
    onSuccess: (registered) => {
      router.replace(`/s/${registered.quizSessionId}`);
    },
  });
}
