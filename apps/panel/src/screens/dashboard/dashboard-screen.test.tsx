import { createElement, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import type { User } from '@eduscope/shared';
import { AuthProvider } from '../../auth/auth-context.js';
import { ClientContext } from '../../client/client-provider.js';
import { useWsStore } from '../../store/ws-store.js';
import { DashboardScreen } from './dashboard-screen.js';

const user: User = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', username: 'a.perera', displayName: 'A. Perera',
  role: 'lecturer', source: 'institute', mustResetPassword: false, disabled: false,
  lastLoginAt: null, createdAt: '2026-01-01T00:00:00.000Z',
};

function renderDashboard(recordingState = 'idle') {
  useWsStore.getState().reset();
  useWsStore.setState({ recording: {
    state: recordingState,
    sessionId: user.id,
    ownerUserId: user.id,
    ownerDisplayName: user.displayName,
    startedAt: recordingState === 'recording' ? '2026-08-05T10:00:00Z' : null,
    recordedDurationMs: 0,
  } as never });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = {
    getProvisioning: vi.fn(() => Promise.resolve({
      hallDisplayName: 'Lecture Hall A',
      featureFlags: { aiQuizEnabled: false },
      llmEndpoint: null,
    })),
    startRecording: vi.fn(() => Promise.resolve({ resolveBySec: 10 })),
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(ClientContext.Provider, { value: client },
      createElement(AuthProvider, {
        initialUser: user,
        children: createElement(MemoryRouter, null, children),
      })),
  );
  return render(<DashboardScreen />, { wrapper });
}

describe('DashboardScreen', () => {
  it('renders the S-04 screen when recording is idle', () => {
    renderDashboard();
    expect(screen.getByTestId('screen')).toHaveAttribute('data-screen', 'S-04');
  });

  it('reserves both bottom-bar slots while they are empty', () => {
    renderDashboard();
    expect(screen.getByTestId('sources-bar-slot')).toBeInTheDocument();
    expect(screen.getByTestId('room-bar-slot')).toBeInTheDocument();
  });

  it('renders S-05 for an owner with a live recording', () => {
    renderDashboard('recording');
    expect(screen.getByTestId('screen')).toHaveAttribute('data-screen', 'S-05');
  });

  it('returns to S-04 when recording is completed', () => {
    renderDashboard('completed');
    expect(screen.getByTestId('screen')).toHaveAttribute('data-screen', 'S-04');
  });
});
