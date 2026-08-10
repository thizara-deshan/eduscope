import { beforeEach, describe, expect, it } from 'vitest';
import type { StudentServerEvent } from '@eduscope/shared';
import { useQuizStore } from './quiz-store.js';

const session = (): StudentServerEvent => ({ event: 'quiz.session', payload: { state: 'open' } });
const participant = (connectionState: 'online' | 'offline' = 'online'): StudentServerEvent => ({
  event: 'quiz.participant', payload: { connectionState },
});
const question = (): StudentServerEvent => ({
  event: 'quiz.question',
  payload: {
    state: 'open', publicationId: '01JBQ8ZK3T7WBM5N2Q4XPRVC9F',
    prompt: 'Which planet is known as the Red Planet?',
    options: [
      { id: '01JBQ8ZK3T7WBM5N2Q4XPRVCA0', label: 'A', text: 'Mercury' },
      { id: '01JBQ8ZK3T7WBM5N2Q4XPRVCA1', label: 'B', text: 'Venus' },
    ],
    ownAnswerOptionId: null,
  },
});
const result = (): StudentServerEvent => ({
  event: 'quiz.result',
  payload: {
    publicationId: '01JBQ8ZK3T7WBM5N2Q4XPRVC9F',
    question: {
      prompt: 'Which planet is known as the Red Planet?',
      options: [
        { id: '01JBQ8ZK3T7WBM5N2Q4XPRVCA0', label: 'A', text: 'Mercury' },
        { id: '01JBQ8ZK3T7WBM5N2Q4XPRVCA1', label: 'B', text: 'Venus' },
      ],
    },
    selectedOptionId: '01JBQ8ZK3T7WBM5N2Q4XPRVCA1',
    isCorrect: true,
    correctOptionId: '01JBQ8ZK3T7WBM5N2Q4XPRVCA1',
    pointsAwarded: 10,
    runningScore: 10,
    ownRank: 1,
    rankState: 'current',
  },
});

beforeEach(() => useQuizStore.getState().reset());

describe('quiz-store', () => {
  it('replaceSnapshot commits exactly one session/participant/question/result in one set', () => {
    useQuizStore.getState().replaceSnapshot([session(), participant(), question(), result()]);
    const state = useQuizStore.getState();
    expect(state.session).toEqual({ state: 'open' });
    expect(state.connection).toBe('online');
    expect(state.question?.state).toBe('open');
    expect(state.result?.isCorrect).toBe(true);
    expect(state.snapshotReceived).toBe(true);
  });

  it('replaceSnapshot removes the prior question/result when the new snapshot omits them', () => {
    useQuizStore.getState().replaceSnapshot([session(), participant(), question(), result()]);
    useQuizStore.getState().replaceSnapshot([session(), participant(), question()]);
    expect(useQuizStore.getState().result).toBeNull();
  });

  it('replaceSnapshot rejects a malformed snapshot (missing session)', () => {
    expect(() => useQuizStore.getState().replaceSnapshot([participant(), question()])).toThrow(/quiz\.session/);
  });

  it('replaceSnapshot rejects a snapshot with two of the same event', () => {
    expect(() => useQuizStore.getState().replaceSnapshot([session(), session(), participant(), question()])).toThrow();
  });

  it('ingest applies one delta by event kind without touching other fields', () => {
    useQuizStore.getState().replaceSnapshot([session(), participant(), question(), result()]);
    useQuizStore.getState().ingest(participant('offline'));
    const state = useQuizStore.getState();
    expect(state.connection).toBe('offline');
    expect(state.result?.isCorrect).toBe(true); // untouched
  });

  it('setReconnecting retains the last authoritative state', () => {
    useQuizStore.getState().replaceSnapshot([session(), participant(), question(), result()]);
    useQuizStore.getState().setReconnecting();
    const state = useQuizStore.getState();
    expect(state.reconnecting).toBe(true);
    expect(state.question?.state).toBe('open');
    expect(state.result?.isCorrect).toBe(true);
  });

  it('setConnectProblem stores the named problem and clears reconnecting', () => {
    useQuizStore.getState().setReconnecting();
    useQuizStore.getState().setConnectProblem({ status: 404, code: 'quiz.session-not-found', title: 'Quiz session not found' });
    const state = useQuizStore.getState();
    expect(state.connectProblem?.code).toBe('quiz.session-not-found');
    expect(state.reconnecting).toBe(false);
  });

  it('reset returns to the empty state', () => {
    useQuizStore.getState().replaceSnapshot([session(), participant(), question(), result()]);
    useQuizStore.getState().reset();
    const state = useQuizStore.getState();
    expect(state.session).toBeNull();
    expect(state.question).toBeNull();
    expect(state.result).toBeNull();
    expect(state.snapshotReceived).toBe(false);
  });
});
