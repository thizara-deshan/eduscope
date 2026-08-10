import { useEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ScenarioName } from '@eduscope/api-client';
import { QuizClientProvider, useQuizClient, useQuizScenarioControls } from '../../client/quiz-client-provider.js';
import { useQuizStore } from '../../store/quiz-store.js';
import { QuizSessionScreen } from './quiz-session-screen.js';

function Harness({ scenario, offlineControl }: { scenario: ScenarioName; offlineControl?: boolean | undefined }) {
  const { scenario: target, switchScenario, forceStudentTransition } = useQuizScenarioControls();
  const client = useQuizClient();
  const switched = useRef(false);

  useEffect(() => {
    if (!switched.current && target !== scenario) {
      switched.current = true;
      switchScenario(scenario);
    }
  }, [target, scenario, switchScenario]);

  if (client.scenario !== scenario) return null;

  return (
    <>
      {offlineControl && (
        <>
          <button type="button" data-testid="go-offline" onClick={() => forceStudentTransition('student.connection.offline')}>
            offline
          </button>
          <button type="button" data-testid="restore" onClick={() => forceStudentTransition('student.connection.restore')}>
            restore
          </button>
        </>
      )}
      <QuizSessionScreen />
    </>
  );
}

function renderSession(scenario: ScenarioName = 'student-quiz-happy', offlineControl?: boolean) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <QuizClientProvider>
        <Harness scenario={scenario} offlineControl={offlineControl} />
      </QuizClientProvider>
    </QueryClientProvider>,
  );
}

async function waitForSnapshot() {
  await waitFor(() => expect(useQuizStore.getState().snapshotReceived).toBe(true));
}

beforeEach(() => useQuizStore.getState().reset());

describe('S-39 Play', () => {
  it('waiting: shows the calm wait card when there is no question', async () => {
    renderSession('student-quiz-failures'); // question: 'none' by default before overlay forcing
    await waitForSnapshot();
    // student-quiz-failures starts with an open question in this wave, so
    // force it back to none to reach the waiting state deliberately.
    useQuizStore.getState().ingest({ event: 'quiz.question', payload: { state: 'none' } });
    expect(await screen.findByText(/Waiting for your lecturer/)).toBeInTheDocument();
  });

  it('answerable: renders a full-width tappable card per option, no timer, no confirm dialog', async () => {
    renderSession('student-quiz-happy');
    await waitForSnapshot();
    const options = await screen.findAllByRole('button', { pressed: false });
    const answerButtons = options.filter((el) => el.className.includes('quiz-answer'));
    expect(answerButtons).toHaveLength(4);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText(/[0-9]+:[0-9]{2}/)).not.toBeInTheDocument();
  });

  it('renders 3 and 2 option questions from the catalog', async () => {
    renderSession('student-quiz-returning');
    await waitForSnapshot();
    await waitFor(() => expect(screen.getAllByRole('button').filter((b) => b.className.includes('quiz-answer'))).toHaveLength(3));
  });

  it('tapping an option optimistically locks it, then the accepted reply keeps it locked', async () => {
    renderSession('student-quiz-happy');
    await waitForSnapshot();
    const first = (await screen.findAllByRole('button')).find((b) => b.className.includes('quiz-answer'))!;
    fireEvent.click(first);
    expect(first).toHaveAttribute('data-state', 'submitting');
    await waitFor(() => expect(first).toHaveAttribute('data-state', 'locked'));
    expect(first).toBeDisabled();
  });

  it('already-accepted reconciles to the server-stored option, not the second tap', async () => {
    renderSession('student-quiz-returning'); // starts with a stored answer at option index 1
    await waitForSnapshot();
    const buttons = (await screen.findAllByRole('button')).filter((b) => b.className.includes('quiz-answer'));
    // storedOptionId is option B (index 1) per the mock; option A is a duplicate tap.
    fireEvent.click(buttons[0]!);
    await waitFor(() => expect(buttons[1]).toHaveAttribute('data-state', 'locked'));
    expect(buttons[0]).toHaveAttribute('data-state', 'idle');
  });

  it('a late answer renders the explicit refusal, not accepted copy', async () => {
    renderSession('student-quiz-late-answer');
    await waitForSnapshot();
    const first = (await screen.findAllByRole('button')).find((b) => b.className.includes('quiz-answer'))!;
    fireEvent.click(first);
    expect(await screen.findByText('Question closed before your answer arrived.')).toBeInTheDocument();
    expect(screen.queryByText(/accepted/i)).not.toBeInTheDocument();
  });

  it('a lost reply returns to answerable with retry copy; retrying locks the stored answer', async () => {
    renderSession('student-quiz-failures');
    await waitForSnapshot();
    const first = (await screen.findAllByRole('button')).find((b) => b.className.includes('quiz-answer'))!;
    fireEvent.click(first);
    expect(await screen.findByText(/try again/i)).toBeInTheDocument();
    expect(first).not.toBeDisabled();

    fireEvent.click(first);
    await waitFor(() => expect(first).toHaveAttribute('data-state', 'locked'));
  });

  it('a missed question delegates to S-40 rather than S-39', async () => {
    renderSession('student-quiz-happy');
    await waitForSnapshot();
    useQuizStore.getState().ingest({ event: 'quiz.question', payload: { state: 'closed', publicationId: '01JBQ8ZK3T7WBM5N2Q4XPRVC9F', prompt: 'x', options: [{ id: '01JBQ8ZK3T7WBM5N2Q4XPRVCA0', label: 'A', text: 'x' }, { id: '01JBQ8ZK3T7WBM5N2Q4XPRVCA1', label: 'B', text: 'y' }], ownAnswerOptionId: null } });
    useQuizStore.getState().ingest({
      event: 'quiz.result',
      payload: {
        publicationId: '01JBQ8ZK3T7WBM5N2Q4XPRVC9F',
        question: { prompt: 'x', options: [{ id: '01JBQ8ZK3T7WBM5N2Q4XPRVCA0', label: 'A', text: 'x' }, { id: '01JBQ8ZK3T7WBM5N2Q4XPRVCA1', label: 'B', text: 'y' }] },
        selectedOptionId: null, isCorrect: null, correctOptionId: '01JBQ8ZK3T7WBM5N2Q4XPRVCA1',
        pointsAwarded: 0, runningScore: 20, ownRank: 3, rankState: 'current',
      },
    });
    await waitFor(() => expect(screen.getByTestId('screen').dataset.screen).toBe('S-40'));
  });

  it('offline retains and dims the current question; restore repairs it', async () => {
    renderSession('student-quiz-happy', true);
    await waitForSnapshot();

    fireEvent.click(screen.getByTestId('go-offline'));
    const options = screen.getAllByRole('button').filter((b) => b.className.includes('quiz-answer'));
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) expect(option).toBeDisabled();

    fireEvent.click(screen.getByTestId('restore'));
    await waitFor(
      () => expect(screen.getAllByRole('button').filter((b) => b.className.includes('quiz-answer')).every((b) => !b.hasAttribute('disabled'))).toBe(true),
      { timeout: 3000 },
    );
  }, 10_000);

  it('a closed session supersedes the live screen with S-41', async () => {
    renderSession('student-quiz-closed');
    await waitForSnapshot();
    expect(screen.getByTestId('screen').dataset.screen).toBe('S-41');
  });
});
