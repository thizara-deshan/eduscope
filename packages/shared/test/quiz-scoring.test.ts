import { describe, expect, it } from 'vitest';
import { scoreQuizParticipants, type QuizScoreInput } from '../src/quiz-scoring.js';

function input(overrides: Partial<QuizScoreInput> & Pick<QuizScoreInput, 'studentIdNumber'>): QuizScoreInput {
  return { displayName: overrides.studentIdNumber, answered: 0, correct: 0, responseMsTotal: 0, ...overrides };
}

describe('scoreQuizParticipants (DM-10, shared by B leaderboard and D student stream)', () => {
  it('scores points as correct×10', () => {
    const [alice] = scoreQuizParticipants([input({ studentIdNumber: 'S001', answered: 4, correct: 3, responseMsTotal: 4000 })]);
    expect(alice!.points).toBe(30);
  });

  it('reports accuracy 0 (never NaN) for a participant with zero answers', () => {
    const [alice] = scoreQuizParticipants([input({ studentIdNumber: 'S001', answered: 0, correct: 0, responseMsTotal: 0 })]);
    expect(alice!.accuracy).toBe(0);
    expect(Number.isNaN(alice!.accuracy)).toBe(false);
    expect(alice!.avgResponseMs).toBe(0);
  });

  it('rounds the average response time', () => {
    const [alice] = scoreQuizParticipants([input({ studentIdNumber: 'S001', answered: 3, correct: 1, responseMsTotal: 1000 })]);
    expect(alice!.avgResponseMs).toBe(333);
  });

  it('orders a point tie deterministically by studentIdNumber', () => {
    const scored = scoreQuizParticipants([
      input({ studentIdNumber: 'S002', answered: 1, correct: 1, responseMsTotal: 500 }),
      input({ studentIdNumber: 'S001', answered: 1, correct: 1, responseMsTotal: 500 }),
    ]);
    expect(scored.map((row) => row.studentIdNumber)).toEqual(['S001', 'S002']);
  });

  it('assigns dense ranks so a tie shares a rank and the next distinct score is rank+1 (1,1,2)', () => {
    const scored = scoreQuizParticipants([
      input({ studentIdNumber: 'S001', answered: 1, correct: 1, responseMsTotal: 1000 }),
      input({ studentIdNumber: 'S002', answered: 1, correct: 1, responseMsTotal: 2000 }),
      input({ studentIdNumber: 'S003', answered: 1, correct: 0, responseMsTotal: 1500 }),
    ]);
    const byId = Object.fromEntries(scored.map((row) => [row.studentIdNumber, row.rank]));
    expect(byId).toEqual({ S001: 1, S002: 1, S003: 2 });
  });
});
