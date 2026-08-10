import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudentServerEvent } from '@eduscope/shared';
import { createEmitter, TransportError } from '@eduscope/api-client';
import { QuizAppProblemError, type QuizAppClient } from '@eduscope/api-client/quiz';
import { useQuizStore } from '../store/quiz-store.js';
import { RECONNECT_DELAYS_MS, useStudentStream } from './use-student-stream.js';

const SNAPSHOT: readonly StudentServerEvent[] = [
  { event: 'quiz.session', payload: { state: 'open' } },
  { event: 'quiz.participant', payload: { connectionState: 'online' } },
  { event: 'quiz.question', payload: { state: 'none' } },
];

function makeClient(connect: QuizAppClient['connect']) {
  const emitter = createEmitter<StudentServerEvent>();
  const client: QuizAppClient = {
    scenario: 'student-quiz-happy',
    resolveJoinCode: vi.fn(),
    registerParticipant: vi.fn(),
    submitAnswer: vi.fn(),
    connect,
    events$: emitter,
    dispose: vi.fn(),
  };
  return { client, emitter };
}

beforeEach(() => useQuizStore.getState().reset());
afterEach(() => vi.useRealTimers());

describe('useStudentStream', () => {
  it('commits the returned snapshot once and ignores frames replayed during connect()', async () => {
    const { client, emitter } = makeClient(async () => {
      // simulate the mock client replaying each snapshot frame on events$ while connecting
      emitter.emit(SNAPSHOT[0]!);
      emitter.emit(SNAPSHOT[1]!);
      return SNAPSHOT;
    });

    const { unmount } = renderHook(() => useStudentStream(client));
    await vi.waitFor(() => expect(useQuizStore.getState().snapshotReceived).toBe(true));

    expect(useQuizStore.getState().session).toEqual({ state: 'open' });
    unmount();
  });

  it('ingests live frames once no snapshot call is in flight', async () => {
    const { client, emitter } = makeClient(async () => SNAPSHOT);
    const { unmount } = renderHook(() => useStudentStream(client));
    await vi.waitFor(() => expect(useQuizStore.getState().snapshotReceived).toBe(true));

    emitter.emit({ event: 'quiz.participant', payload: { connectionState: 'offline' } });
    expect(useQuizStore.getState().connection).toBe('offline');
    unmount();
  });

  it('retries on transport failure with the capped reconnect ladder', async () => {
    vi.useFakeTimers();
    const connect = vi.fn(async () => { throw new TransportError('connect'); });
    const { client } = makeClient(connect);
    const { unmount } = renderHook(() => useStudentStream(client));

    await vi.advanceTimersByTimeAsync(0);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(useQuizStore.getState().reconnecting).toBe(true);

    for (let i = 0; i < RECONNECT_DELAYS_MS.length; i += 1) {
      await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[i]!);
    }
    expect(connect).toHaveBeenCalledTimes(1 + RECONNECT_DELAYS_MS.length);

    // capped: further waits keep using the last (largest) delay, not growing unbounded.
    const before = connect.mock.calls.length;
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS.at(-1)!);
    expect(connect).toHaveBeenCalledTimes(before + 1);

    unmount();
  });

  it('stops retrying and stores the problem on quiz.session-not-found', async () => {
    vi.useFakeTimers();
    const connect = vi.fn(async () => {
      throw new QuizAppProblemError({ status: 404, code: 'quiz.session-not-found', title: 'Quiz session not found' });
    });
    const { client } = makeClient(connect);
    const { unmount } = renderHook(() => useStudentStream(client));

    await vi.advanceTimersByTimeAsync(0);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(useQuizStore.getState().connectProblem?.code).toBe('quiz.session-not-found');

    await vi.advanceTimersByTimeAsync(20_000);
    expect(connect).toHaveBeenCalledTimes(1); // no retry scheduled

    unmount();
  });

  it('cleans up the subscription and pending retry timer on unmount', async () => {
    vi.useFakeTimers();
    const connect = vi.fn(async () => { throw new TransportError('connect'); });
    const { client } = makeClient(connect);
    const { unmount } = renderHook(() => useStudentStream(client));

    await vi.advanceTimersByTimeAsync(0);
    expect(connect).toHaveBeenCalledTimes(1);
    unmount();

    await vi.advanceTimersByTimeAsync(20_000);
    expect(connect).toHaveBeenCalledTimes(1); // the pending retry never fires post-unmount
  });
});
