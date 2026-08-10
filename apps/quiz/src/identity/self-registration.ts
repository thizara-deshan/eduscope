import type { QuizAppClient } from '@eduscope/api-client/quiz';
import type { QuizIdentity, QuizIdentityProvider, RegisterInput } from './identity-provider.js';

/** V1. Self-registration at first join ([D-21]); no roster, no password. */
export function createSelfRegistrationProvider(client: QuizAppClient): QuizIdentityProvider {
  let current: QuizIdentity | null = null;

  return {
    kind: 'self-registration',

    async resolve(joinCode) {
      const resolved = await client.resolveJoinCode(joinCode);
      return resolved.participantState === 'returning' ? current : null;
    },

    async register(joinCode: string, input: RegisterInput) {
      const resolved = await client.resolveJoinCode(joinCode);
      const registered = await client.registerParticipant(resolved.quizSessionId, {
        fullName: input.displayName,
        studentIdNumber: input.studentIdNumber,
      });
      current = {
        participantId: registered.participantId,
        quizSessionId: registered.quizSessionId,
        displayName: input.displayName.trim(),
        studentIdNumber: input.studentIdNumber,
      };
      return current;
    },

    async signOut() {
      current = null;
    },
  };
}
