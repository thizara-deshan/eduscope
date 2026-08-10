import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createMockQuizClient, type MockQuizAppClient, type QuizAppClient } from '@eduscope/api-client/quiz';
import type { ScenarioName, StudentQuizTransitionId } from '@eduscope/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { createSelfRegistrationProvider } from '../identity/self-registration.js';
import type { QuizIdentityProvider } from '../identity/identity-provider.js';
import { useQuizStore } from '../store/quiz-store.js';
import { useStudentStream } from '../realtime/use-student-stream.js';

const DEFAULT_SCENARIO: ScenarioName = 'student-quiz-happy';

interface QuizClientValue {
  readonly client: QuizAppClient;
  readonly identity: QuizIdentityProvider;
  readonly scenario: ScenarioName;
  switchScenario(name: ScenarioName): void;
  forceStudentTransition(id: StudentQuizTransitionId): void;
}

const QuizClientContext = createContext<QuizClientValue | null>(null);

interface Instance {
  readonly client: MockQuizAppClient;
  readonly identity: QuizIdentityProvider;
}

/**
 * Mirrors apps/panel's ClientProvider (Task 15): one client per selected
 * scenario, constructed inside the effect (not useMemo, for the same
 * StrictMode reason — a client built in a discarded double-render would
 * never reach an effect to get disposed). This is the ONLY file that
 * changes when SSO lands (A-16) — swap the provider call for
 * `createSsoProvider(client)`, nothing else moves.
 */
export function QuizClientProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [scenario, setScenario] = useState<ScenarioName>(DEFAULT_SCENARIO);
  const [instance, setInstance] = useState<Instance | null>(null);

  useEffect(() => {
    const client = createMockQuizClient(scenario);
    const identity = createSelfRegistrationProvider(client);
    setInstance({ client, identity });
    return () => {
      client.dispose();
      setInstance(null);
    };
  }, [scenario]);

  useStudentStream(instance?.client ?? null);

  if (!instance) return null;

  const value: QuizClientValue = {
    client: instance.client,
    identity: instance.identity,
    scenario,
    switchScenario(name) {
      // Reset BEFORE switching: the store must not render the outgoing
      // scenario's stale question/result while the new client's first
      // connect() is still in flight.
      useQuizStore.getState().reset();
      void queryClient.invalidateQueries();
      setScenario(name);
    },
    forceStudentTransition(id) {
      instance.client.forceStudentTransition(id);
    },
  };

  return <QuizClientContext.Provider value={value}>{children}</QuizClientContext.Provider>;
}

function useQuizClientValue(): QuizClientValue {
  const ctx = useContext(QuizClientContext);
  if (!ctx) throw new Error('must be used inside <QuizClientProvider>');
  return ctx;
}

export function useQuizClient(): QuizAppClient {
  return useQuizClientValue().client;
}

export function useQuizIdentity(): QuizIdentityProvider {
  return useQuizClientValue().identity;
}

export function useQuizScenarioControls(): Pick<QuizClientValue, 'scenario' | 'switchScenario' | 'forceStudentTransition'> {
  const { scenario, switchScenario, forceStudentTransition } = useQuizClientValue();
  return { scenario, switchScenario, forceStudentTransition };
}
