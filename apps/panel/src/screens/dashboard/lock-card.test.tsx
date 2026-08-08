import { createElement, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import type { User } from '@eduscope/shared';
import { AuthProvider } from '../../auth/auth-context.js';
import { ClientContext } from '../../client/client-provider.js';
import { useWsStore } from '../../store/ws-store.js';
import '../../styles/tokens.css';
import { TimerCard } from '../transport/timer-card.js';
import { LockCard } from './lock-card.js';

const me: User = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', username: 'a.perera', displayName: 'A. Perera',
  role: 'lecturer', source: 'institute', mustResetPassword: false, disabled: false,
  lastLoginAt: null, createdAt: '2026-01-01T00:00:00.000Z',
};
const lockedSession = (overrides: Record<string, unknown> = {}) => ({
  state: 'recording', startReason: 'initial', sessionId: me.id, title: 'Data Structures',
  ownerUserId: me.id, ownerDisplayName: me.displayName, startedAt: '2026-08-05T10:00:00Z',
  recordedDurationMs: 5_000, segmentIndex: 1, segmentCount: 1, pauseCount: 0,
  takeoverBy: null, takeoverAt: null, takeoverByDisplayName: null,
  errorCode: null, errorMessage: null, ...overrides,
});

const baseProps = {
  ownerDisplayName: 'A. Perera', title: 'Data Structures',
  startedAt: '2026-08-05T10:00:00Z', recordedDurationMs: 5_000,
  recordingState: 'recording' as const, phase: 'live' as const,
  note: 'Only A. Perera or an administrator can stop this recording.',
  stale: false,
};

describe('LockCard', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('uses the approved 560px geometry and lecturer copy without an action', () => {
    render(<LockCard {...baseProps} />);
    expect(getComputedStyle(screen.getByTestId('lock-card')).width).toBe('560px');
    expect(screen.getByText('A. Perera')).toBeInTheDocument();
    expect(screen.getByText('Data Structures')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders Starting… before the first segment and Saving… while ending', () => {
    const first = render(<LockCard {...baseProps} phase="starting" recordingState="starting" startedAt={null} />);
    expect(screen.getByTestId('lock-elapsed')).toHaveTextContent('Starting…');
    first.unmount();
    render(<LockCard {...baseProps} phase="ending" recordingState="finalizing" />);
    expect(screen.getByText('SAVING')).toBeInTheDocument();
    expect(screen.getByTestId('lock-caption')).toHaveTextContent('Saving…');
  });

  it('shares the exact elapsed computation with TimerCard', () => {
    vi.setSystemTime(new Date('2026-08-05T10:00:05Z'));
    useWsStore.getState().reset();
    useWsStore.setState({ recording: lockedSession() as never });
    const client = {
      pauseRecording: vi.fn(), resumeRecording: vi.fn(), stopRecording: vi.fn(),
    } as unknown as EduscopeClient;
    const wrapper = ({ children }: { children: ReactNode }) => createElement(
      ClientContext.Provider,
      { value: client },
      createElement(AuthProvider, { initialUser: me, children }),
    );
    render(<><LockCard {...baseProps} /><TimerCard /></>, { wrapper });
    expect(screen.getByTestId('lock-elapsed').textContent)
      .toBe(screen.getByLabelText('Recording duration').textContent);
  });
});
