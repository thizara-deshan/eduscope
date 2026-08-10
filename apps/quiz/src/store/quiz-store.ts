import { create } from 'zustand';
import type {
  QuizAppProblem,
  StudentQuizQuestionPayload,
  StudentQuizResultPayload,
  StudentQuizSessionPayload,
  StudentServerEvent,
} from '@eduscope/shared';

export type QuizConnectionState = 'online' | 'offline';

interface QuizStoreState {
  readonly session: StudentQuizSessionPayload | null;
  readonly connection: QuizConnectionState;
  readonly question: StudentQuizQuestionPayload | null;
  readonly result: StudentQuizResultPayload | null;
  readonly reconnecting: boolean;
  readonly connectProblem: QuizAppProblem | null;
  readonly snapshotReceived: boolean;

  /** Atomic reconnect/cold-connect replacement — never merges into stale state. */
  replaceSnapshot(events: readonly StudentServerEvent[]): void;
  /** A single live delta from `events$`. */
  ingest(event: StudentServerEvent): void;
  setReconnecting(): void;
  setConnectProblem(problem: QuizAppProblem): void;
  reset(): void;
}

const EMPTY = {
  session: null,
  connection: 'online' as QuizConnectionState,
  question: null,
  result: null,
  reconnecting: false,
  connectProblem: null,
  snapshotReceived: false,
};

interface Snapshot {
  readonly session: StudentQuizSessionPayload;
  readonly connection: QuizConnectionState;
  readonly question: StudentQuizQuestionPayload;
  readonly result: StudentQuizResultPayload | null;
}

/** Validates the events.md §5.1 snapshot shape: exactly one session/participant/question, zero-or-one result. */
function parseSnapshot(events: readonly StudentServerEvent[]): Snapshot {
  let session: StudentQuizSessionPayload | null = null;
  let connection: QuizConnectionState | null = null;
  let question: StudentQuizQuestionPayload | null = null;
  let result: StudentQuizResultPayload | null = null;

  for (const event of events) {
    switch (event.event) {
      case 'quiz.session':
        if (session !== null) throw new Error('quiz snapshot: more than one quiz.session event');
        session = event.payload;
        break;
      case 'quiz.participant':
        if (connection !== null) throw new Error('quiz snapshot: more than one quiz.participant event');
        connection = event.payload.connectionState;
        break;
      case 'quiz.question':
        if (question !== null) throw new Error('quiz snapshot: more than one quiz.question event');
        question = event.payload;
        break;
      case 'quiz.result':
        if (result !== null) throw new Error('quiz snapshot: more than one quiz.result event');
        result = event.payload;
        break;
    }
  }

  if (session === null) throw new Error('quiz snapshot: missing quiz.session event');
  if (connection === null) throw new Error('quiz snapshot: missing quiz.participant event');
  if (question === null) throw new Error('quiz snapshot: missing quiz.question event');

  return { session, connection, question, result };
}

export const useQuizStore = create<QuizStoreState>((set, get) => ({
  ...EMPTY,

  replaceSnapshot(events) {
    const snapshot = parseSnapshot(events);
    set({
      session: snapshot.session,
      connection: snapshot.connection,
      question: snapshot.question,
      result: snapshot.result,
      reconnecting: false,
      connectProblem: null,
      snapshotReceived: true,
    });
  },

  ingest(event) {
    switch (event.event) {
      case 'quiz.session':
        set({ session: event.payload });
        return;
      case 'quiz.participant':
        set({ connection: event.payload.connectionState });
        return;
      case 'quiz.question':
        // A newly OPENED publication supersedes any prior result — S-39
        // reveals in place rather than S-40 going stale (Task 6 precedence).
        set({
          question: event.payload,
          result: event.payload.state === 'open' ? null : get().result,
        });
        return;
      case 'quiz.result':
        set({ result: event.payload });
        return;
    }
  },

  setReconnecting() {
    if (get().reconnecting) return;
    set({ reconnecting: true });
  },

  setConnectProblem(problem) {
    set({ connectProblem: problem, reconnecting: false });
  },

  reset() {
    set({ ...EMPTY });
  },
}));
