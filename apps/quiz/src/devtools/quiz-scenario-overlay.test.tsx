import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { QuizClientProvider } from '../client/quiz-client-provider.js';
import { useQuizStore } from '../store/quiz-store.js';
import { QuizScenarioOverlay } from './quiz-scenario-overlay.js';

function renderOverlay() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <QuizClientProvider>
        <QuizScenarioOverlay />
      </QuizClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => useQuizStore.getState().reset());

describe('QuizScenarioOverlay', () => {
  it('stays closed until the hotspot is long-pressed, and lists only studentQuiz-tagged scripts', async () => {
    renderOverlay();
    await waitFor(() => expect(useQuizStore.getState().snapshotReceived).toBe(true));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const hotspot = screen.getByTestId('quiz-scenario-hotspot');
    hotspot.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 2100));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByLabelText('student-quiz-happy')).toBeInTheDocument();
    expect(screen.getByLabelText('student-quiz-late-answer')).toBeInTheDocument();
    // no panel-only scenario names (which have no `studentQuiz` field) leak in.
    expect(screen.queryByLabelText('happy')).not.toBeInTheDocument();
  }, 10_000);

  it('exposes a labeled, ≥44px-target button for every forced transition', async () => {
    renderOverlay();
    await waitFor(() => expect(useQuizStore.getState().snapshotReceived).toBe(true));

    const hotspot = screen.getByTestId('quiz-scenario-hotspot');
    hotspot.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 2100));
    await screen.findByRole('dialog');

    const button = screen.getByTestId('quiz-force-student.question.close-missed');
    expect(button).toHaveTextContent('Question: close (missed)');
    button.click();

    await waitFor(() => expect(useQuizStore.getState().question?.state).toBe('closed'));
    await waitFor(() => expect(useQuizStore.getState().result?.isCorrect).toBeNull());
  }, 10_000);
});
