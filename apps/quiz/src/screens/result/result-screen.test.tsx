import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { StudentQuizResultPayload } from '@eduscope/shared';
import { ResultScreen } from './result-screen.js';

const OPTIONS = [
  { id: '01JBQ8ZK3T7WBM5N2Q4XPRVCA0', label: 'A', text: 'Mercury' },
  { id: '01JBQ8ZK3T7WBM5N2Q4XPRVCA1', label: 'B', text: 'Venus' },
  { id: '01JBQ8ZK3T7WBM5N2Q4XPRVCA2', label: 'C', text: 'Earth' },
  { id: '01JBQ8ZK3T7WBM5N2Q4XPRVCA3', label: 'D', text: 'Mars' },
];

function result(overrides: Partial<StudentQuizResultPayload>): StudentQuizResultPayload {
  return {
    publicationId: '01JBQ8ZK3T7WBM5N2Q4XPRVC9F',
    question: { prompt: 'Which planet is known as the Red Planet?', options: OPTIONS },
    selectedOptionId: OPTIONS[3]!.id,
    isCorrect: true,
    correctOptionId: OPTIONS[3]!.id,
    pointsAwarded: 10,
    runningScore: 30,
    ownRank: 3,
    rankState: 'current',
    ...overrides,
  };
}

describe('S-40 Result', () => {
  it('correct: renders +points, the correct option, score, and current own rank', () => {
    render(<ResultScreen result={result({})} connectionState="online" />);
    expect(screen.getByText('Correct!')).toBeInTheDocument();
    expect(screen.getByText('+10')).toBeInTheDocument();
    expect(screen.getAllByText('Mars')).toHaveLength(2); // own answer and correct answer both Mars
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('#3')).toBeInTheDocument();
  });

  it('incorrect: renders own and correct answers with +0', () => {
    render(
      <ResultScreen
        result={result({ selectedOptionId: OPTIONS[1]!.id, isCorrect: false, pointsAwarded: 0, rankState: 'pending', ownRank: null })}
        connectionState="online"
      />,
    );
    expect(screen.getByText('Not quite')).toBeInTheDocument();
    expect(screen.getByText('+0')).toBeInTheDocument();
    expect(screen.getByText('Venus')).toBeInTheDocument(); // own
    expect(screen.getByText('Mars')).toBeInTheDocument(); // correct
  });

  it('missed: renders "No answer received", not incorrect, with neutral styling', () => {
    render(
      <ResultScreen
        result={result({ selectedOptionId: null, isCorrect: null, pointsAwarded: 0 })}
        connectionState="online"
      />,
    );
    expect(screen.getByText('No answer received')).toBeInTheDocument();
    expect(screen.queryByText('Your answer')).not.toBeInTheDocument();
    expect(screen.queryByText('+0')).not.toBeInTheDocument();
  });

  it('rank pending: shows "Updating…" while the score still renders', () => {
    render(<ResultScreen result={result({ rankState: 'pending', ownRank: null })} connectionState="online" />);
    expect(screen.getByText('Updating…')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
  });

  it('rank current: shows the numeric own rank', () => {
    render(<ResultScreen result={result({ rankState: 'current', ownRank: 1 })} connectionState="online" />);
    expect(screen.getByText('#1')).toBeInTheDocument();
  });

  it('always shows the dominant "waiting for next question" instruction', () => {
    render(<ResultScreen result={result({})} connectionState="online" />);
    expect(screen.getByText('Waiting for the next question')).toBeInTheDocument();
  });

  it('offline retains the complete result and shows the reconnecting strip', () => {
    render(<ResultScreen result={result({})} connectionState="offline" />);
    expect(screen.getByRole('status')).toHaveTextContent(/offline/i);
    expect(screen.getByText('Correct!')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
  });

  it('shows no other-student identity or class list', () => {
    render(<ResultScreen result={result({})} connectionState="online" />);
    expect(screen.queryByText(/class|leaderboard|other/i)).not.toBeInTheDocument();
  });
});
