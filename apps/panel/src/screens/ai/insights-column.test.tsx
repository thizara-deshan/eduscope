import { createElement, type ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ClientContext } from '../../client/client-provider.js';
import { useWsStore } from '../../store/ws-store.js';
import '../../styles/tokens.css';
import { InsightsColumn } from './insights-column.js';

const recording = () => ({
  state: 'recording', startReason: 'initial', sessionId: '01J00000000000000000000001',
  title: 'Lecture', ownerUserId: 'u1', ownerDisplayName: 'A. Perera',
  startedAt: '2026-08-05T10:00:00Z', recordedDurationMs: 0, segmentIndex: 1,
  segmentCount: 1, pauseCount: 0, takeoverBy: null, takeoverAt: null,
  takeoverByDisplayName: null, errorCode: null, errorMessage: null,
});

function renderColumn(collapsed = false) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = {
    listPublications: vi.fn(() => Promise.resolve([])),
    getLeaderboard: vi.fn(() => Promise.resolve({
      sessionId: '01J00000000000000000000001', entries: [], computedAt: '2026-08-05T10:00:00Z', stale: false,
    })),
    getQuizSession: vi.fn(() => Promise.resolve({
      state: 'open', quizSessionId: '01J00000000000000000000009', lectureSessionId: '01J00000000000000000000001',
      joinUrl: 'https://q/1', joinCode: '111111', joinedCount: 1, syncState: 'synced',
    })),
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider, { client: queryClient }, createElement(ClientContext.Provider, { value: client, children }),
  );
  return render(<InsightsColumn collapsed={collapsed} />, { wrapper });
}

describe('InsightsColumn', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
    useWsStore.setState({ recording: recording() as never });
  });

  it('shows two tabs with Previous Questions selected by default', () => {
    renderColumn();
    expect(screen.getByRole('tab', { name: 'Previous Questions' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Leaderboard' })).toHaveAttribute('aria-selected', 'false');
  });

  it('switches tabs on tap', () => {
    renderColumn();
    fireEvent.click(screen.getByRole('tab', { name: 'Leaderboard' }));
    expect(screen.getByRole('tab', { name: 'Leaderboard' })).toHaveAttribute('aria-selected', 'true');
  });

  it('collapsed: tabs stay visible even though the body is hidden', () => {
    renderColumn(true);
    expect(screen.getByRole('tab', { name: 'Previous Questions' })).toBeInTheDocument();
    expect(screen.getByTestId('insights-column')).toHaveClass('us-insightswrap--collapsed');
    expect(screen.queryByTestId('previous-questions-tab')).toBeNull();
  });
});
