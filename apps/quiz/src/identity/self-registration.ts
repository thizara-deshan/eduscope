import type { QuizAppClient, QuizIdentity } from '@eduscope/api-client/quiz';
import type { QuizIdentityProvider, RegisterInput } from './identity-provider.js';

const STORAGE_KEY = 'eduscope.quiz.identity';

/** V1. Self-registration at first join ([D-21]); no roster, no password. */
export function createSelfRegistrationProvider(client: QuizAppClient): QuizIdentityProvider {
  const read = (): QuizIdentity | null => {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as QuizIdentity) : null;
  };

  return {
    kind: 'self-registration',

    async resolve() {
      return read();
    },

    async register(joinCode: string, input: RegisterInput) {
      const identity = await client.register(joinCode, input);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
      }
      return identity;
    },

    async signOut() {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
    },
  };
}
