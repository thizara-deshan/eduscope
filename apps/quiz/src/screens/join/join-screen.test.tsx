import { useEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useRouter } from 'next/navigation';
import type { ScenarioName } from '@eduscope/api-client';
import { QuizClientProvider, useQuizClient, useQuizScenarioControls } from '../../client/quiz-client-provider.js';
import { useQuizStore } from '../../store/quiz-store.js';
import { JoinScreen } from './join-screen.js';

function Harness({
  initialCode,
  autoSubmit,
  scenario,
  offlineControl,
}: {
  initialCode: string;
  autoSubmit: boolean;
  scenario: ScenarioName;
  offlineControl?: boolean;
}) {
  const { scenario: target, switchScenario, forceStudentTransition } = useQuizScenarioControls();
  const client = useQuizClient();
  const switched = useRef(false);

  useEffect(() => {
    if (!switched.current && target !== scenario) {
      switched.current = true;
      switchScenario(scenario);
    }
  }, [target, scenario, switchScenario]);

  // Wait for the ACTUAL client instance to match, not just the target
  // scenario state — there is a render frame where `target` has updated but
  // the provider's effect hasn't yet swapped `instance.client` for it.
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
      <JoinScreen initialCode={initialCode} autoSubmit={autoSubmit} />
    </>
  );
}

function renderJoin(props: { initialCode: string; autoSubmit: boolean; scenario?: ScenarioName; offlineControl?: boolean }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <QuizClientProvider>
        <Harness scenario={props.scenario ?? 'student-quiz-happy'} {...props} />
      </QuizClientProvider>
    </QueryClientProvider>,
  );
}

const SESSION_ID = '01JBQ8ZK3T7WBM5N2Q4XPRVC9D';

beforeEach(() => useQuizStore.getState().reset());

describe('S-37 Join', () => {
  it('shows a shaped skeleton while resolving', async () => {
    renderJoin({ initialCode: 'ABC123', autoSubmit: true });
    expect(await screen.findByTestId('join-skeleton')).toHaveTextContent('Finding your quiz');
  });

  it('manual entry starts empty with the Join button disabled', () => {
    renderJoin({ initialCode: '', autoSubmit: false });
    expect(screen.getByRole('textbox', { name: /quiz code/i })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Join' })).toBeDisabled();
  });

  it('accepts a lowercase code and lets the client normalize case-insensitively', async () => {
    renderJoin({ initialCode: '', autoSubmit: false });
    fireEvent.change(screen.getByRole('textbox', { name: /quiz code/i }), { target: { value: 'abc123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    const router = useRouter();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/j/abc123/register'));
  });

  it('open + returning routes straight to the session with no registration call', async () => {
    renderJoin({ initialCode: 'ABC123', autoSubmit: true, scenario: 'student-quiz-returning' });
    const router = useRouter();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/s/${SESSION_ID}`));
  });

  it('closed sessions route to /s so the terminal screen can render', async () => {
    renderJoin({ initialCode: 'ABC123', autoSubmit: true, scenario: 'student-quiz-closed' });
    const router = useRouter();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/s/${SESSION_ID}`));
  });

  it('an invalid code stays on S-37, editable, with a named error', async () => {
    renderJoin({ initialCode: '', autoSubmit: false });
    const input = screen.getByRole('textbox', { name: /quiz code/i });
    fireEvent.change(input, { target: { value: 'INVALID' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    expect(await screen.findByText('That quiz code is not active.')).toBeInTheDocument();
    expect(input).toHaveValue('INVALID');
    expect(input).not.toBeDisabled();
  });

  it('an unavailable service shows the named refusal', async () => {
    renderJoin({ initialCode: 'UNAVAILABLE', autoSubmit: true });
    expect(await screen.findByText('Quiz service unavailable. Try again.')).toBeInTheDocument();
  });

  it('an unreachable resolve shows retry copy, and retrying succeeds', async () => {
    renderJoin({ initialCode: 'ABC123', autoSubmit: true, scenario: 'student-quiz-failures' });
    expect(await screen.findByText('Something went wrong. Try again.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    const router = useRouter();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/j/ABC123/register'));
  });

  it('offline retains the code, disables Join, and shows reconnecting; restore permits retry', async () => {
    renderJoin({ initialCode: '', autoSubmit: false, offlineControl: true });
    // Let the app-lifetime connect() (mounted regardless of route) settle
    // before forcing offline — otherwise it's still "snapshotting" and the
    // offline event would be silently swallowed.
    await waitFor(() => expect(useQuizStore.getState().snapshotReceived).toBe(true));
    fireEvent.change(screen.getByRole('textbox', { name: /quiz code/i }), { target: { value: 'ABC123' } });

    fireEvent.click(screen.getByTestId('go-offline'));
    expect(screen.getByRole('status')).toHaveTextContent(/offline|reconnecting/i);
    expect(screen.getByRole('textbox', { name: /quiz code/i })).toHaveValue('ABC123');
    expect(screen.getByRole('button', { name: 'Join' })).toBeDisabled();

    fireEvent.click(screen.getByTestId('restore'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Join' })).not.toBeDisabled(), { timeout: 3000 });

    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    const router = useRouter();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/j/ABC123/register'));
  }, 10_000);
});
