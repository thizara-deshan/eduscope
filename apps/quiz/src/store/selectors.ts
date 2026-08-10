import { useShallow } from 'zustand/react/shallow';
import { useQuizStore } from './quiz-store.js';

/** Multi-field reads need shallow equality — zustand v5 has none by default. */
export const useQuizShallow = <T>(selector: (s: ReturnType<typeof useQuizStore.getState>) => T): T =>
  useQuizStore(useShallow(selector));

export const useQuizSession = () => useQuizStore((s) => s.session);
export const useQuizQuestion = () => useQuizStore((s) => s.question);
export const useQuizResult = () => useQuizStore((s) => s.result);

/** 'reconnecting' takes precedence over the raw participant connection state. */
export const useQuizConnectionState = () =>
  useQuizStore((s) => (s.reconnecting ? 'reconnecting' : s.connection));

export const useSnapshotStatus = () =>
  useQuizShallow((s) => ({ received: s.snapshotReceived, connectProblem: s.connectProblem }));
