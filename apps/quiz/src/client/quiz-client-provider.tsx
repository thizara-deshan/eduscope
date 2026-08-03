import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createMockQuizClient, type QuizAppClient } from '@eduscope/api-client/quiz';
import { createSelfRegistrationProvider } from '../identity/self-registration.js';
import type { QuizIdentityProvider } from '../identity/identity-provider.js';

interface QuizClientValue {
  readonly client: QuizAppClient;
  readonly identity: QuizIdentityProvider;
}

const QuizClientContext = createContext<QuizClientValue | null>(null);

/**
 * Mirrors apps/panel's ClientProvider (Task 15): one `createMockQuizClient()`
 * call, one `createSelfRegistrationProvider(client)` call, both behind
 * context. This is the ONLY file that changes when SSO lands (A-16) — swap
 * the provider call for `createSsoProvider(client)`, nothing else moves.
 *
 * Constructed inside the effect, not useMemo, for the same StrictMode reason
 * as the panel's provider: a client built in a discarded double-render would
 * never reach an effect to get disposed.
 */
export function QuizClientProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<QuizClientValue | null>(null);

  useEffect(() => {
    const client = createMockQuizClient();
    const identity = createSelfRegistrationProvider(client);
    setValue({ client, identity });
    return () => {
      client.dispose();
      setValue(null);
    };
  }, []);

  if (!value) return null;

  return <QuizClientContext.Provider value={value}>{children}</QuizClientContext.Provider>;
}

export function useQuizClient(): QuizAppClient {
  const ctx = useContext(QuizClientContext);
  if (!ctx) throw new Error('useQuizClient must be used inside <QuizClientProvider>');
  return ctx.client;
}

export function useQuizIdentity(): QuizIdentityProvider {
  const ctx = useContext(QuizClientContext);
  if (!ctx) throw new Error('useQuizIdentity must be used inside <QuizClientProvider>');
  return ctx.identity;
}
