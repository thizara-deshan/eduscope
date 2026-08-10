import { useEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useRouter } from 'next/navigation';
import type { ScenarioName } from '@eduscope/api-client';
import { QuizClientProvider, useQuizClient, useQuizScenarioControls } from '../../client/quiz-client-provider.js';
import { useQuizStore } from '../../store/quiz-store.js';
import { RegistrationScreen } from './registration-screen.js';

const SESSION_ID = '01JBQ8ZK3T7WBM5N2Q4XPRVC9D';

function Harness({
  joinCode,
  scenario,
  offlineControl,
}: {
  joinCode: string;
  scenario: ScenarioName;
  offlineControl?: boolean | undefined;
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
      <RegistrationScreen joinCode={joinCode} />
    </>
  );
}

function renderRegistration(props: { joinCode?: string; scenario?: ScenarioName; offlineControl?: boolean }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <QuizClientProvider>
        <Harness joinCode={props.joinCode ?? 'ABC123'} scenario={props.scenario ?? 'student-quiz-happy'} offlineControl={props.offlineControl} />
      </QuizClientProvider>
    </QueryClientProvider>,
  );
}

function nameField() {
  return screen.getByLabelText('Full name');
}
function idField() {
  return screen.getByLabelText('Student ID');
}

beforeEach(() => useQuizStore.getState().reset());

describe('S-38 Self-registration', () => {
  it('starts empty with exactly two textboxes and one primary action', async () => {
    renderRegistration({});
    await screen.findByLabelText('Full name');
    expect(nameField()).toHaveValue('');
    expect(idField()).toHaveValue('');
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('fills both fields', async () => {
    renderRegistration({});
    await screen.findByLabelText('Full name');
    fireEvent.change(nameField(), { target: { value: 'K. Fernando' } });
    fireEvent.change(idField(), { target: { value: 'IT12345678' } });
    expect(nameField()).toHaveValue('K. Fernando');
    expect(idField()).toHaveValue('IT12345678');
  });

  it('a blank name is refused and points at /fullName', async () => {
    renderRegistration({});
    await screen.findByLabelText('Full name');
    fireEvent.change(nameField(), { target: { value: '   ' } });
    fireEvent.change(idField(), { target: { value: 'IT12345678' } });
    fireEvent.click(screen.getByRole('button', { name: /join/i }));

    expect(await screen.findByText('Enter your real name')).toBeInTheDocument();
    expect(nameField()).toHaveValue('   ');
  });

  it('a malformed student ID is refused, points at /studentIdNumber, and keeps the policy hint', async () => {
    renderRegistration({});
    await screen.findByLabelText('Full name');
    fireEvent.change(nameField(), { target: { value: 'K. Fernando' } });
    fireEvent.change(idField(), { target: { value: 'it12' } });
    fireEvent.click(screen.getByRole('button', { name: /join/i }));

    expect(await screen.findByText('Student ID: Two uppercase letters followed by 7 or 8 digits')).toBeInTheDocument();
    expect(screen.getByText('Two uppercase letters followed by 7 or 8 digits')).toBeInTheDocument();
  });

  it('shows a submitting state that retains and disables the fields', async () => {
    renderRegistration({});
    await screen.findByLabelText('Full name');
    fireEvent.change(nameField(), { target: { value: 'K. Fernando' } });
    fireEvent.change(idField(), { target: { value: 'IT12345678' } });
    fireEvent.click(screen.getByRole('button', { name: /join/i }));

    expect(await screen.findByRole('button', { name: 'Joining…' })).toBeDisabled();
    expect(nameField()).toBeDisabled();
    expect(nameField()).toHaveValue('K. Fernando');
  });

  it('a created registration routes to the session', async () => {
    renderRegistration({});
    await screen.findByLabelText('Full name');
    fireEvent.change(nameField(), { target: { value: 'K. Fernando' } });
    fireEvent.change(idField(), { target: { value: 'IT12345678' } });
    fireEvent.click(screen.getByRole('button', { name: /join/i }));

    const router = useRouter();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/s/${SESSION_ID}`));
  });

  it('a duplicate rejoin routes to the same session with no separate interstitial', async () => {
    renderRegistration({ scenario: 'student-quiz-returning' });
    await screen.findByLabelText('Full name');
    fireEvent.change(nameField(), { target: { value: 'K. Fernando' } });
    fireEvent.change(idField(), { target: { value: 'IT12345678' } });
    fireEvent.click(screen.getByRole('button', { name: /join/i }));

    const router = useRouter();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/s/${SESSION_ID}`));
  });

  it('a session that closes mid-registration routes to the terminal session', async () => {
    renderRegistration({ scenario: 'student-quiz-registration-closed' });
    await screen.findByLabelText('Full name');
    fireEvent.change(nameField(), { target: { value: 'K. Fernando' } });
    fireEvent.change(idField(), { target: { value: 'IT12345678' } });
    fireEvent.click(screen.getByRole('button', { name: /join/i }));

    const router = useRouter();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/s/${SESSION_ID}`));
  });

  it('a service error preserves both values and shows a retry banner', async () => {
    renderRegistration({ scenario: 'student-quiz-failures' });
    // the initial join-code resolve fails once (unreachable); retry it first.
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await screen.findByLabelText('Full name');

    fireEvent.change(nameField(), { target: { value: 'K. Fernando' } });
    fireEvent.change(idField(), { target: { value: 'IT12345678' } });
    fireEvent.click(screen.getByRole('button', { name: /join/i }));

    expect(await screen.findByText('Quiz service unavailable. Try again.')).toBeInTheDocument();
    expect(nameField()).toHaveValue('K. Fernando');
    expect(idField()).toHaveValue('IT12345678');
  });

  it('offline retains values and blocks submit; restore permits an explicit resubmit', async () => {
    renderRegistration({ offlineControl: true });
    await screen.findByLabelText('Full name');
    fireEvent.change(nameField(), { target: { value: 'K. Fernando' } });
    fireEvent.change(idField(), { target: { value: 'IT12345678' } });

    fireEvent.click(screen.getByTestId('go-offline'));
    expect(screen.getByRole('button', { name: /join/i })).toBeDisabled();
    expect(nameField()).toHaveValue('K. Fernando');

    fireEvent.click(screen.getByTestId('restore'));
    await waitFor(() => expect(screen.getByRole('button', { name: /join/i })).not.toBeDisabled(), { timeout: 3000 });

    fireEvent.click(screen.getByRole('button', { name: /join/i }));
    const router = useRouter();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/s/${SESSION_ID}`));
  }, 10_000);
});
