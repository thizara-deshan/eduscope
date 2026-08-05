import { createElement, Fragment, type ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import type { RecordingStatePayload, StorageStatusPayload, User } from '@eduscope/shared';
import { AuthProvider } from '../../auth/auth-context.js';
import { ClientContext } from '../../client/client-provider.js';
import { OverlayHost, OverlayProvider } from '../../overlays/overlay-host.js';
import { useWsStore } from '../../store/ws-store.js';
import { DashboardScreen } from './dashboard-screen.js';

const OWNER_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const ADMIN_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const OTHER_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAX';

const owner: User = {
  id: OWNER_ID, username: 'a.perera', displayName: 'A. Perera',
  role: 'lecturer', source: 'institute', mustResetPassword: false, disabled: false,
  lastLoginAt: null, createdAt: '2026-01-01T00:00:00.000Z',
};
const lecturer: User = {
  ...owner, id: OTHER_ID, username: 'n.silva', displayName: 'N. Silva',
};
const admin: User = {
  ...owner, id: ADMIN_ID, username: 'admin', displayName: 'Administrator', role: 'admin',
};

const idleRecording: RecordingStatePayload = {
  state: 'idle', startReason: null, sessionId: null, title: null,
  ownerUserId: null, ownerDisplayName: null, startedAt: null,
  recordedDurationMs: null, segmentIndex: null, segmentCount: null,
  pauseCount: null, takeoverBy: null, takeoverAt: null,
  takeoverByDisplayName: null, errorCode: null, errorMessage: null,
};

const liveRecording: RecordingStatePayload = {
  ...idleRecording,
  state: 'recording', startReason: 'initial', sessionId: OWNER_ID,
  title: 'CS2043 — Lecture 7', ownerUserId: OWNER_ID,
  ownerDisplayName: 'A. Perera', startedAt: '2026-08-05T12:45:00Z',
  recordedDurationMs: 5_000, segmentIndex: 1, segmentCount: 1, pauseCount: 0,
};

interface RenderOptions {
  readonly viewer?: User;
  readonly recording?: RecordingStatePayload;
  readonly storage?: StorageStatusPayload | null;
  readonly stale?: boolean;
}

function renderDashboard({
  viewer = owner,
  recording = idleRecording,
  storage = null,
  stale = false,
}: RenderOptions = {}) {
  useWsStore.getState().reset();
  useWsStore.setState({ recording, storage, stale });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(['provisioning'], {
    hallDisplayName: 'Lecture Hall A', featureFlags: { aiQuizEnabled: false }, llmEndpoint: null,
  });
  const never = () => new Promise<never>(() => undefined);
  const client = {
    getProvisioning: vi.fn(never), listChannels: vi.fn(never),
    listLayoutPresets: vi.fn(never), getStorageOverview: vi.fn(never),
    listSourceRoles: vi.fn(never), getSourcesStatus: vi.fn(never),
    startRecording: vi.fn(() => Promise.resolve({ resolveBySec: 10 })),
    takeoverRecording: vi.fn(never), pauseRecording: vi.fn(never),
    resumeRecording: vi.fn(never), stopRecording: vi.fn(never),
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(ClientContext.Provider, { value: client },
      createElement(AuthProvider, {
        initialUser: viewer,
        children: createElement(MemoryRouter, null,
          createElement(OverlayProvider, null,
            createElement(Fragment, null, children, createElement(OverlayHost)))),
      })),
  );
  return { ...render(<DashboardScreen />, { wrapper }), client };
}

describe('DashboardScreen', () => {
  it('renders S-04 when recording is idle', () => {
    renderDashboard();
    expect(screen.getByTestId('screen')).toHaveAttribute('data-screen', 'S-04');
  });

  it('mounts both bottom bars on the dashboard', () => {
    renderDashboard();
    expect(screen.getByTestId('sources-bar-slot')).toBeInTheDocument();
    expect(screen.getByTestId('room-bar-slot')).toBeInTheDocument();
    expect(screen.getByTestId('room-controls-bar')).toBeInTheDocument();
  });

  it('renders storage critical as a disabled Start with payload policy text', () => {
    renderDashboard({
      storage: {
        pressure: 'critical',
        freeBytes: 50_000_000_000,
        totalBytes: 500_000_000_000,
        policy: {
          maxAgeDays: 90,
          warningThresholdPct: 70,
          criticalThresholdPct: 90,
          earlyDeleteOrder: 'uploaded-oldest-first',
          neverDeleteUnuploaded: true,
          refuseStartWhenCritical: true,
        },
      },
    });
    expect(screen.getByRole('button', { name: 'Start Recording' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('90% critical threshold');
  });

  it('keeps Start enabled at storage warning pressure', () => {
    renderDashboard({
      storage: {
        pressure: 'warning',
        freeBytes: 140_000_000_000,
        totalBytes: 500_000_000_000,
        policy: {
          maxAgeDays: 90,
          warningThresholdPct: 70,
          criticalThresholdPct: 90,
          earlyDeleteOrder: 'uploaded-oldest-first',
          neverDeleteUnuploaded: true,
          refuseStartWhenCritical: true,
        },
      },
    });
    expect(screen.getByRole('button', { name: 'Start Recording' })).toBeEnabled();
  });

  it('renders the locked lecturer remedy without an action', () => {
    renderDashboard({ viewer: lecturer, recording: liveRecording });
    expect(screen.getByTestId('screen')).toHaveAttribute('data-screen', 'S-06');
    expect(screen.getByText('Only A. Perera or an administrator can stop this recording.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take over' })).toBeNull();
  });

  it('renders Take over, but never Stop, for a locked administrator', () => {
    renderDashboard({ viewer: admin, recording: liveRecording });
    expect(screen.getByText('You can take over this recording. It keeps recording either way.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Take over' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('withdraws the action and says Saving… while the locked session ends', () => {
    renderDashboard({ viewer: admin, recording: { ...liveRecording, state: 'finalizing' } });
    expect(screen.getByText('This lecture is being saved.')).toBeInTheDocument();
    expect(screen.getByTestId('lock-caption')).toHaveTextContent('Saving…');
    expect(screen.queryByRole('button', { name: 'Take over' })).toBeNull();
  });

  it('renders Starting… when the locked session has no first segment', () => {
    renderDashboard({
      viewer: lecturer,
      recording: { ...liveRecording, state: 'starting', startedAt: null, recordedDurationMs: null },
    });
    expect(screen.getByTestId('lock-elapsed')).toHaveTextContent('Starting…');
  });

  it('opens the non-dismissible takeover confirmation from the admin action', () => {
    renderDashboard({ viewer: admin, recording: liveRecording });
    fireEvent.click(screen.getByRole('button', { name: 'Take over' }));
    expect(screen.getByRole('alertdialog', { name: 'Take over this recording?' })).toBeInTheDocument();
    expect(screen.getByTestId('overlay-host')).toHaveAttribute('data-depth', '1');
  });

  it('renders S-05 with prior-owner attribution for the new takeover user', () => {
    renderDashboard({
      viewer: admin,
      recording: {
        ...liveRecording, takeoverBy: ADMIN_ID, takeoverAt: '2026-08-05T14:12:00Z',
        takeoverByDisplayName: 'Administrator',
      },
    });
    expect(screen.getByTestId('screen')).toHaveAttribute('data-screen', 'S-05');
    expect(screen.getByTestId('takeover-notice')).toHaveTextContent(
      'You took over this recording from A. Perera at 14:12. It is still saved as their lecture.',
    );
  });

  it('collapses the displaced owner to S-06 with a non-dismissible notice', () => {
    renderDashboard({
      recording: {
        ...liveRecording, takeoverBy: ADMIN_ID, takeoverAt: '2026-08-05T14:12:00Z',
        takeoverByDisplayName: 'R. Fernando',
      },
    });
    expect(screen.getByTestId('screen')).toHaveAttribute('data-screen', 'S-06');
    expect(screen.getByTestId('takeover-notice')).toHaveTextContent(
      'An administrator took over this recording. R. Fernando took over at 14:12.',
    );
    expect(within(screen.getByTestId('lock-card')).queryByRole('button')).toBeNull();
  });

  it('shows third-party takeover attribution without an action', () => {
    renderDashboard({
      viewer: lecturer,
      recording: {
        ...liveRecording, takeoverBy: ADMIN_ID, takeoverAt: '2026-08-05T14:12:00Z',
        takeoverByDisplayName: 'R. Fernando',
      },
    });
    expect(screen.getByText('Taken over by R. Fernando.')).toBeInTheDocument();
    expect(within(screen.getByTestId('lock-card')).queryByRole('button')).toBeNull();
  });

  it('renders S-05 for the original owner before takeover', () => {
    renderDashboard({ recording: liveRecording });
    expect(screen.getByTestId('screen')).toHaveAttribute('data-screen', 'S-05');
  });

  it('keeps an owner initial start on S-04 until recording is confirmed', () => {
    renderDashboard({
      recording: {
        ...liveRecording,
        state: 'starting',
        startedAt: null,
        recordedDurationMs: null,
      },
    });
    expect(screen.getByTestId('screen')).toHaveAttribute('data-screen', 'S-04');
    expect(screen.getByRole('button', { name: /Starting/ })).toBeDisabled();
  });

  it('keeps boot recovery on S-04 while the prior session is checked', () => {
    renderDashboard({
      recording: {
        ...liveRecording,
        state: 'starting',
        startReason: 'recovery',
        startedAt: null,
        recordedDurationMs: null,
      },
    });
    expect(screen.getByTestId('screen')).toHaveAttribute('data-screen', 'S-04');
    expect(screen.getByText('Checking the previous session')).toBeInTheDocument();
  });

  it('keeps an owner resume transition on S-05', () => {
    renderDashboard({
      recording: {
        ...liveRecording,
        state: 'starting',
        startReason: 'resume',
      },
    });
    expect(screen.getByTestId('screen')).toHaveAttribute('data-screen', 'S-05');
  });

  it('returns to S-04 when a locked session completes', () => {
    renderDashboard({ viewer: lecturer, recording: { ...liveRecording, state: 'completed' } });
    expect(screen.getByTestId('screen')).toHaveAttribute('data-screen', 'S-04');
  });

  it('marks stale digits and disables takeover without hiding the reason', () => {
    renderDashboard({ viewer: admin, recording: liveRecording, stale: true });
    expect(screen.getByText('Not connected — this may be out of date.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Take over' })).toBeDisabled();
    expect(screen.getByTestId('lock-elapsed')).toBeInTheDocument();
  });
});
