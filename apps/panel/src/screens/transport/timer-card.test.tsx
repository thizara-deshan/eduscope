import { act, createElement, type ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import type { User } from '@eduscope/shared';
import { AuthProvider } from '../../auth/auth-context.js';
import { ClientContext } from '../../client/client-provider.js';
import { useWsStore } from '../../store/ws-store.js';
import '../../styles/tokens.css';
import { elapsedMs, TimerCard } from './timer-card.js';

const me: User = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', username: 'a.perera', displayName: 'A. Perera',
  role: 'lecturer', source: 'institute', mustResetPassword: false, disabled: false,
  lastLoginAt: null, createdAt: '2026-01-01T00:00:00.000Z',
};
const session = (overrides: Record<string, unknown> = {}) => ({
  state: 'recording', startReason: 'initial', sessionId: me.id, title: 'Lecture',
  ownerUserId: me.id, ownerDisplayName: me.displayName, startedAt: '2026-08-05T10:00:00Z',
  recordedDurationMs: 5_000, segmentIndex: 1, segmentCount: 1, pauseCount: 0,
  takeoverBy: null, takeoverAt: null, takeoverByDisplayName: null,
  errorCode: null, errorMessage: null, ...overrides,
});

function renderTimer(
  overrides: Record<string, unknown> = {},
  defaultCollapsed = false,
  methods: Partial<EduscopeClient> = {},
) {
  useWsStore.getState().reset();
  useWsStore.setState({ recording: session(overrides) as never });
  const client = {
    pauseRecording: vi.fn(() => Promise.resolve({ resolveBySec: 10 })),
    resumeRecording: vi.fn(() => Promise.resolve({ resolveBySec: 10 })),
    stopRecording: vi.fn(() => Promise.resolve({ resolveBySec: 10 })),
    ...methods,
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    ClientContext.Provider, { value: client },
    createElement(AuthProvider, { initialUser: me, children }),
  );
  return { ...render(<TimerCard defaultCollapsed={defaultCollapsed} />, { wrapper }), client };
}

describe('TimerCard', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('recording shows ticking digits with Pause and Stop', () => {
    vi.setSystemTime(new Date('2026-08-05T10:00:05Z'));
    renderTimer();
    expect(screen.getByLabelText('Recording duration')).toHaveTextContent('00:00:10');
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled();
  });

  it('provides the stable programmatic focus target used by power-off remedies', () => {
    renderTimer();
    const card = screen.getByTestId('timer-card');
    expect(card).toHaveAttribute('id', 'recording-transport');
    expect(card).toHaveAttribute('tabindex', '-1');
  });

  it('paused freezes the digits and swaps Pause for Resume', () => {
    renderTimer({ state: 'paused', recordedDurationMs: 12_000 });
    expect(screen.getByLabelText('Recording duration')).toHaveTextContent('00:00:12');
    expect(screen.getByText('Recording paused')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeEnabled();
  });

  it('marks only the pressed command pending', () => {
    renderTimer();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(screen.getByRole('button', { name: 'Pausing…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled();
  });

  it('renders resume pending on only the pressed button', () => {
    renderTimer({ state: 'paused' });
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(screen.getByRole('button', { name: 'Resuming…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled();
  });

  it('renders stop pending and locks the other transport', () => {
    renderTimer();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(screen.getByRole('button', { name: 'Stopping…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();
  });

  it('starting a resume renders Starting…', () => {
    renderTimer({ state: 'starting', startReason: 'resume', startedAt: null });
    expect(screen.getByLabelText('Recording duration')).toHaveTextContent('Starting…');
  });

  it('stopping and finalizing render Saving… with disabled transport', () => {
    const first = renderTimer({ state: 'stopping' });
    expect(screen.getByText('Saving…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled();
    first.unmount();
    renderTimer({ state: 'finalizing' });
    expect(screen.getByText('Saving…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled();
  });

  it('hides transport buttons from a non-owner', () => {
    renderTimer({ ownerUserId: '01ARZ3NDEKTSV4RRFFQ69G5FAA' });
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('shows transport buttons to the administrator named by takeoverBy', () => {
    renderTimer({ ownerUserId: '01ARZ3NDEKTSV4RRFFQ69G5FAA', takeoverBy: me.id });
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled();
  });

  it('collapses to small digits and hides actions behind a 44px chevron', () => {
    renderTimer({}, true);
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    const expand = screen.getByRole('button', { name: 'Expand timer' });
    expect(getComputedStyle(expand).minHeight).toBe('44px');
    expect(screen.getByLabelText('Recording duration')).toHaveClass('us-timercard__digits--small');
  });

  it('shows a continuity marker after a crash-ended segment', () => {
    renderTimer();
    act(() => useWsStore.setState({ lastSegment: { endReason: 'crash' } as never }));
    expect(screen.getByText(/continued after a brief interruption/i)).toBeInTheDocument();
  });

  it('marks stale data and disables both transport commands (U-2)', () => {
    renderTimer();
    act(() => useWsStore.setState({ stale: true }));
    expect(screen.getByTestId('timer-card')).toHaveAttribute('data-stale', 'true');
    expect(screen.getByText('Connection is stale')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled();
  });

  it('renders a named command failure inline (U-5)', async () => {
    renderTimer({}, false, {
      pauseRecording: vi.fn(() => Promise.reject(new Error('Pause was refused by the recorder.'))),
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
      await Promise.resolve();
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Pause was refused by the recorder.');
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled();
  });

  it('implements the one elapsed-time table without NaN', () => {
    expect(elapsedMs(session({ state: 'paused', recordedDurationMs: 7_000 }) as never, Date.parse('2026-08-05T11:00:00Z'))).toBe(7_000);
    expect(elapsedMs(session({ recordedDurationMs: 5_000 }) as never, Date.parse('2026-08-05T10:00:03Z'))).toBe(8_000);
    expect(elapsedMs(session({ state: 'starting', startedAt: null }) as never, Date.now())).toBe(5_000);
    expect(elapsedMs(session({ recordedDurationMs: null }) as never, Date.parse('2026-08-05T10:00:00Z'))).toBe(0);
  });
});
