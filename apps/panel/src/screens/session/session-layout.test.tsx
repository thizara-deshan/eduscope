import { createElement, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import type { User } from '@eduscope/shared';
import { AuthProvider } from '../../auth/auth-context.js';
import { ClientContext } from '../../client/client-provider.js';
import { OverlayProvider } from '../../overlays/overlay-host.js';
import { useWsStore } from '../../store/ws-store.js';
import '../../styles/tokens.css';
import { SessionLayout } from './session-layout.js';

const user: User = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', username: 'a.perera', displayName: 'A. Perera',
  role: 'lecturer', source: 'institute', mustResetPassword: false, disabled: false,
  lastLoginAt: null, createdAt: '2026-01-01T00:00:00.000Z',
};

const recording = {
  state: 'recording', startReason: 'initial', sessionId: user.id, title: 'Lecture',
  ownerUserId: user.id, ownerDisplayName: user.displayName,
  startedAt: '2026-08-05T10:00:00Z', recordedDurationMs: 5_000,
  segmentIndex: 1, segmentCount: 1, pauseCount: 0, takeoverBy: null,
  takeoverAt: null, takeoverByDisplayName: null, errorCode: null, errorMessage: null,
};

function renderSession(aiEnabled: boolean | undefined) {
  useWsStore.getState().reset();
  useWsStore.setState({ recording: recording as never });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (aiEnabled !== undefined) {
    queryClient.setQueryData(['provisioning'], {
      featureFlags: { aiQuizEnabled: aiEnabled },
      llmEndpoint: 'http://127.0.0.1:11434',
    });
  }
  const client = {
    getProvisioning: vi.fn(() => new Promise<never>(() => undefined)),
    listChannels: vi.fn(() => new Promise<never>(() => undefined)),
    listLayoutPresets: vi.fn(() => new Promise<never>(() => undefined)),
    listSourceRoles: vi.fn(() => new Promise<never>(() => undefined)),
    getSourcesStatus: vi.fn(() => new Promise<never>(() => undefined)),
    getStorageOverview: vi.fn(() => new Promise<never>(() => undefined)),
    getAiCountdown: vi.fn(() => new Promise<never>(() => undefined)),
    listQuestions: vi.fn(() => Promise.resolve([])),
    getQuizSession: vi.fn(() => new Promise<never>(() => undefined)),
    listPublications: vi.fn(() => Promise.resolve([])),
    pauseRecording: vi.fn(), resumeRecording: vi.fn(), stopRecording: vi.fn(),
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(ClientContext.Provider, { value: client },
      createElement(AuthProvider, {
        initialUser: user,
        children: createElement(MemoryRouter, null,
          createElement(OverlayProvider, null, children)),
      })),
  );
  return render(<SessionLayout />, { wrapper });
}

describe('SessionLayout', () => {
  it('mounts Capture Assurance, not S-13, when AI is disabled', () => {
    renderSession(false);
    expect(screen.getByTestId('capture-assurance-card')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-studio-card')).toBeNull();
  });

  it('mounts the Wave 4 S-13 AI Studio card, not capture assurance, when AI is enabled', () => {
    renderSession(true);
    expect(screen.getByTestId('ai-studio-card')).toBeInTheDocument();
    expect(screen.queryByTestId('capture-assurance-card')).toBeNull();
  });

  it('mounts the insights wrapper only when AI is enabled (Wave 4)', () => {
    const off = renderSession(false);
    expect(off.container.querySelector('.us-insightswrap')).toBeNull();
    off.unmount();
    const on = renderSession(true);
    expect(on.container.querySelector('.us-insightswrap')).toBeInTheDocument();
  });

  it('keeps the sidebar exactly --sidebar-w wide', () => {
    renderSession(false);
    expect(getComputedStyle(screen.getByTestId('session-sidebar')).width).toBe('430px');
  });

  it('mounts TimerCard in both layout choices', () => {
    const off = renderSession(false);
    expect(screen.getByTestId('timer-card')).toBeInTheDocument();
    off.unmount();
    renderSession(true);
    expect(screen.getByTestId('timer-card')).toBeInTheDocument();
  });

  it('keeps the sidebar and a main-column skeleton, never a spinner, while pending', () => {
    renderSession(undefined);
    expect(screen.getByTestId('session-main-skeleton')).toBeInTheDocument();
    expect(screen.getByTestId('session-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('timer-card')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});
