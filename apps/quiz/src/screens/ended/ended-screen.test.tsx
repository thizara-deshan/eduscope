import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EndedScreen } from './ended-screen.js';

const PARTICIPATED = {
  state: 'closed' as const,
  participationState: 'participated' as const,
  finalScore: 30,
  finalRank: 3,
  answeredCount: 3,
};

const NONE = {
  state: 'closed' as const,
  participationState: 'none' as const,
  finalScore: 0 as const,
  finalRank: null,
  answeredCount: 0 as const,
};

describe('S-41 Session ended', () => {
  it('participated: renders the final score/rank/answered count and a close-tab instruction', () => {
    render(<EndedScreen session={PARTICIPATED} connectProblem={null} connectionState="online" />);
    expect(screen.getByRole('heading', { name: 'Quiz ended' })).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('#3')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('You can close this tab now.')).toBeInTheDocument();
  });

  it('never answered: gentle copy with no zero score or rank dash', () => {
    render(<EndedScreen session={NONE} connectProblem={null} connectionState="online" />);
    expect(screen.getByText(/didn.t answer any questions/i)).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText('Final score')).not.toBeInTheDocument();
  });

  it('offline close reconnect: announces "Reconnected" once the participated summary lands', () => {
    render(<EndedScreen session={PARTICIPATED} connectProblem={null} connectionState="online" justReconnected />);
    expect(screen.getByText('Reconnected.')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
  });

  it('does not announce "Reconnected" on an ordinary (non-disrupted) load', () => {
    render(<EndedScreen session={PARTICIPATED} connectProblem={null} connectionState="online" />);
    expect(screen.queryByText(/reconnected/i)).not.toBeInTheDocument();
  });

  it('direct session-not-found: renders stale-link copy only, no fabricated summary', () => {
    render(
      <EndedScreen
        session={null}
        connectProblem={{ status: 404, code: 'quiz.session-not-found', title: 'Quiz session not found' }}
        connectionState="online"
      />,
    );
    expect(screen.getByRole('heading', { name: 'This quiz link is no longer valid' })).toBeInTheDocument();
    expect(screen.queryByText('Final score')).not.toBeInTheDocument();
    expect(screen.queryByText(/didn.t answer/i)).not.toBeInTheDocument();
  });

  it('all four terminal states expose no button, link, share, retry, or navigation control', () => {
    for (const props of [
      { session: PARTICIPATED, connectProblem: null },
      { session: NONE, connectProblem: null },
      { session: null, connectProblem: { status: 404 as const, code: 'quiz.session-not-found' as const, title: 'x' } },
    ]) {
      const { unmount } = render(<EndedScreen {...props} connectionState="online" />);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      unmount();
    }
  });

  it('shows own values only — no other participant identity', () => {
    render(<EndedScreen session={PARTICIPATED} connectProblem={null} connectionState="online" />);
    expect(screen.queryByText(/class|leaderboard|other student/i)).not.toBeInTheDocument();
  });
});
