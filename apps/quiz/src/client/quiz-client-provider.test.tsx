import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmitter, DEFAULT_RUNTIME_CONFIG } from '@eduscope/api-client';
import type { StudentServerEvent } from '@eduscope/shared';
import type { MockQuizAppClient, QuizAppClient } from '@eduscope/api-client/quiz';
import { QuizClientProvider, useQuizClient, useQuizScenarioControls } from './quiz-client-provider.js';
import { useQuizStore } from '../store/quiz-store.js';

function optionCount(): number {
  const question = useQuizStore.getState().question;
  return question && 'options' in question ? question.options.length : 0;
}

const captured: QuizAppClient[] = [];

function Probe() {
  const client = useQuizClient();
  const { scenario, switchScenario } = useQuizScenarioControls();

  useEffect(() => {
    captured.push(client);
  }, [client]);

  return (
    <div>
      <span data-testid="scenario">{scenario}</span>
      <span data-testid="client-scenario">{client.scenario}</span>
      <button type="button" onClick={() => switchScenario('student-quiz-returning')}>
        switch
      </button>
    </div>
  );
}

function RealProbe() {
  const client = useQuizClient();
  return <span data-testid="real-client">{client.scenario === null ? 'real' : 'mock'}</span>;
}

beforeEach(() => {
  captured.length = 0;
  useQuizStore.getState().reset();
});

describe('QuizClientProvider scenario switching', () => {
  it('constructs one client per scenario and reconnects the student store', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <QuizClientProvider>
          <Probe />
        </QuizClientProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('client-scenario')).toHaveTextContent('student-quiz-happy'));
    await waitFor(() => expect(optionCount()).toBe(4));
  });

  it('disposes the old client, resets the store, and invalidates queries on switch', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    render(
      <QueryClientProvider client={queryClient}>
        <QuizClientProvider>
          <Probe />
        </QuizClientProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('client-scenario')).toHaveTextContent('student-quiz-happy'));
    await waitFor(() => expect(optionCount()).toBe(4));

    const firstClient = captured[0]!;
    const disposeSpy = vi.spyOn(firstClient, 'dispose');

    screen.getByRole('button', { name: 'switch' }).click();

    await waitFor(() => expect(screen.getByTestId('client-scenario')).toHaveTextContent('student-quiz-returning'));
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalled();

    await waitFor(() => expect(optionCount()).toBe(3));
  });

  it('selects the whole real studentQuiz client without constructing a mock', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const events = createEmitter<StudentServerEvent>();
    const real: QuizAppClient = {
      scenario: null,
      resolveJoinCode: vi.fn(),
      registerParticipant: vi.fn(),
      submitAnswer: vi.fn(),
      connect: vi.fn(async () => [
        { event: 'quiz.session', payload: { state: 'open' } },
        { event: 'quiz.participant', payload: { connectionState: 'online' } },
        { event: 'quiz.question', payload: { state: 'none' } },
      ] as const),
      events$: events,
      dispose: vi.fn(),
    };
    const createReal = vi.fn(() => real);
    const createMock = vi.fn<(_: string) => MockQuizAppClient>();

    render(
      <QueryClientProvider client={queryClient}>
        <QuizClientProvider
          config={{
            ...DEFAULT_RUNTIME_CONFIG,
            environment: 'integration',
            adapters: { default: 'mock', overrides: { studentQuiz: 'real' } },
          }}
          createReal={createReal}
          createMock={createMock as never}
        >
          <RealProbe />
        </QuizClientProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(createReal).toHaveBeenCalledWith('https://quiz.example.edu'));
    expect(createMock).not.toHaveBeenCalled();
    await waitFor(() => expect(useQuizStore.getState().snapshotReceived).toBe(true));
  });
});
