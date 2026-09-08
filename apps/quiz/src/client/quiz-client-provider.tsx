'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_RUNTIME_CONFIG,
  resolveSelection,
  type RuntimeConfig,
  type ScenarioName,
  type StudentQuizTransitionId,
} from '@eduscope/api-client';
import {
  createMockQuizClient,
  type MockQuizAppClient,
  type QuizAppClient,
} from '@eduscope/api-client/quiz';
import { createRealQuizAppClient } from '@eduscope/api-client/quiz/real';
import { useOptionalRuntimeConfig } from '../config/runtime-config.js';
import { createSelfRegistrationProvider } from '../identity/self-registration.js';
import type { QuizIdentityProvider } from '../identity/identity-provider.js';
import { useStudentStream } from '../realtime/use-student-stream.js';
import { useQuizStore } from '../store/quiz-store.js';

const DEFAULT_SCENARIO: ScenarioName = 'student-quiz-happy';
const defaultRealFactory = (baseUrl: string): QuizAppClient =>
  createRealQuizAppClient({ baseUrl });

interface QuizClientValue {
  readonly client: QuizAppClient;
  readonly identity: QuizIdentityProvider;
  readonly mock: MockQuizAppClient | null;
  readonly scenario: ScenarioName;
  switchScenario(name: ScenarioName): void;
  forceStudentTransition(id: StudentQuizTransitionId): void;
}

const QuizClientContext = createContext<QuizClientValue | null>(null);

interface Instance {
  readonly client: QuizAppClient;
  readonly identity: QuizIdentityProvider;
  readonly mock: MockQuizAppClient | null;
}

export function QuizClientProvider({
  children,
  config: configProp,
  createReal = defaultRealFactory,
  createMock = createMockQuizClient,
}: {
  children: ReactNode;
  config?: RuntimeConfig;
  createReal?: (baseUrl: string) => QuizAppClient;
  createMock?: (scenario: ScenarioName) => MockQuizAppClient;
}) {
  const queryClient = useQueryClient();
  const contextConfig = useOptionalRuntimeConfig();
  const config = configProp ?? contextConfig ?? DEFAULT_RUNTIME_CONFIG;
  const selection = useMemo(() => resolveSelection(config), [config]);
  const [scenario, setScenario] = useState<ScenarioName>(DEFAULT_SCENARIO);
  const [instance, setInstance] = useState<Instance | null>(null);

  useEffect(() => {
    const client = selection.studentQuiz === 'mock'
      ? createMock(scenario)
      : createReal(config.quizBaseUrl);
    const built: Instance = {
      client,
      identity: createSelfRegistrationProvider(client),
      mock: selection.studentQuiz === 'mock' ? client as MockQuizAppClient : null,
    };
    setInstance(built);
    return () => {
      useQuizStore.getState().reset();
      built.client.dispose();
      setInstance(null);
    };
  }, [config.quizBaseUrl, createMock, createReal, scenario, selection.studentQuiz]);

  useStudentStream(instance?.client ?? null);
  if (!instance) return null;

  const value: QuizClientValue = {
    client: instance.client,
    identity: instance.identity,
    mock: instance.mock,
    scenario,
    switchScenario(name) {
      if (!instance.mock) throw new Error('scenario controls require the mock quiz client');
      useQuizStore.getState().reset();
      void queryClient.invalidateQueries();
      setScenario(name);
    },
    forceStudentTransition(id) {
      if (!instance.mock) throw new Error('scenario controls require the mock quiz client');
      instance.mock.forceStudentTransition(id);
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

export function useQuizScenarioControls(): Pick<
  QuizClientValue,
  'scenario' | 'switchScenario' | 'forceStudentTransition'
> {
  const value = useQuizClientValue();
  if (!value.mock) throw new Error('scenario controls require the mock quiz client');
  return {
    scenario: value.scenario,
    switchScenario: value.switchScenario,
    forceStudentTransition: value.forceStudentTransition,
  };
}
