import { useEffect } from 'react';
import { QuizAppProblemError, type QuizAppClient } from '@eduscope/api-client/quiz';
import { useQuizStore } from '../store/quiz-store.js';

/** events.md §1 student reconnect ladder — capped, unlimited retries. */
export const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 10000] as const;

/**
 * Bridges one `QuizAppClient` into the student zustand store. Subscribes to
 * `events$` BEFORE the first `connect()` so no live frame is missed, but
 * ignores frames emitted while a snapshot call is in flight — `connect()`
 * itself replays them, and we commit its RETURNED array exactly once via
 * `replaceSnapshot`, never the duplicate frames threaded through `events$`.
 */
export function useStudentStream(client: QuizAppClient | null): void {
  useEffect(() => {
    if (!client) return undefined;

    let cancelled = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let snapshotting = false;

    const off = client.events$.subscribe((event) => {
      if (snapshotting) return;
      useQuizStore.getState().ingest(event);
      // The in-band offline signal is the ONLY thing that tells us the live
      // connection dropped — there is no separate `connection$` on
      // `QuizAppClient`. Treat it as the cue to start the reconnect ladder
      // immediately, the same way a real dropped socket would.
      if (event.event === 'quiz.participant' && event.payload.connectionState === 'offline') {
        if (retryTimer !== null) {
          clearTimeout(retryTimer);
          retryTimer = null;
        }
        void connectAtomic();
      }
    });

    const scheduleRetry = () => {
      const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)];
      attempt += 1;
      retryTimer = setTimeout(() => {
        void connectAtomic();
      }, delay);
    };

    const connectAtomic = async () => {
      snapshotting = true;
      try {
        const snapshot = await client.connect();
        if (cancelled) return;
        useQuizStore.getState().replaceSnapshot(snapshot);
        attempt = 0;
      } catch (error) {
        if (cancelled) return;
        if (error instanceof QuizAppProblemError && error.problem.code === 'quiz.session-not-found') {
          useQuizStore.getState().setConnectProblem(error.problem);
          return;
        }
        useQuizStore.getState().setReconnecting();
        scheduleRetry();
      } finally {
        snapshotting = false;
      }
    };

    void connectAtomic();

    return () => {
      cancelled = true;
      off();
      if (retryTimer !== null) clearTimeout(retryTimer);
    };
  }, [client]);
}
