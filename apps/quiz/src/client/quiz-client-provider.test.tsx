import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuizAppClient } from '@eduscope/api-client/quiz';
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
});
