import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ProblemError } from '@eduscope/api-client';
import { TIMERS, type Question, type QuestionUpdate } from '@eduscope/shared';
import { useClient } from '../client/client-provider.js';
import { useAiSet, useQuestionEvents, useRecordingSession } from '../store/selectors.js';
import { AI_KEYS } from './query-keys.js';
import { useQuizSession } from './use-quiz-session.js';

export type QuestionsPendingKind = 'editing' | 'discarding' | 'sending';

export interface UseQuestions {
  readonly loading: boolean;
  /** Opened while the countdown/Generate-Now cycle is in flight (Q-02/Q-03/Q-11). */
  readonly generating: boolean;
  readonly questions: readonly Question[];
  readonly pendingId: string | null;
  readonly pendingKind: QuestionsPendingKind | null;
  readonly problemByQuestionId: Readonly<Record<string, string>>;
  /** S20-D-5: the same 4a `open` state that gates the S-20 chip's tappability. */
  readonly canSend: boolean;
  readonly sendRefusalReason: string | null;
  editQuestion(id: string, patch: QuestionUpdate): void;
  discardQuestion(id: string): void;
  sendToProjector(id: string): void;
  regenerate(): void;
}

function refusalMessage(error: unknown, fallback: string): string {
  if (error instanceof ProblemError) return error.problem.detail ?? error.problem.title;
  return fallback;
}

const SEND_REFUSAL_REASON = 'Students cannot receive this question right now — the quiz server is unavailable.';

/**
 * S-14 list model: `listQuestions` snapshot merged with live `ai.question`
 * deltas (keyed by questionId; a `discarded` delta is already pruned by the
 * store). `edit`/`discard`/`send` are 202-async — pending clears only once
 * the WS delta the command promised actually lands (or the row disappears,
 * for discard), never on the resolved 202 itself (frontend-conventions §1).
 */
export function useQuestions(): UseQuestions {
  const client = useClient();
  const session = useRecordingSession();
  const sessionId = session?.sessionId ?? undefined;
  const wsSet = useAiSet();
  const questionDeltas = useQuestionEvents();
  const quiz = useQuizSession();

  const query = useQuery({
    queryKey: AI_KEYS.questions(sessionId),
    queryFn: () => client.listQuestions({ sessionId: sessionId! }),
    enabled: sessionId !== undefined,
  });

  const merged = new Map<string, Question>();
  for (const row of query.data ?? []) merged.set(row.id, row);
  for (const [id, delta] of Object.entries(questionDeltas)) {
    const existing = merged.get(id);
    merged.set(id, existing
      ? {
          ...existing, state: delta.state, provenance: delta.provenance,
          edited: delta.edited, questionSetId: delta.setId,
        }
      : {
          id,
          sessionId: sessionId ?? '',
          questionSetId: delta.setId,
          kind: 'mcq',
          prompt: '',
          options: [],
          correctOptionId: null,
          provenance: delta.provenance,
          edited: delta.edited,
          state: delta.state,
          createdAt: new Date().toISOString(),
          orderHint: null,
        });
  }
  const questions = [...merged.values()].filter((q) => q.state !== 'discarded');

  const generating = wsSet?.state === 'requested' || wsSet?.state === 'generating';

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pendingKind, setPendingKind] = useState<QuestionsPendingKind | null>(null);
  const [problemByQuestionId, setProblemByQuestionId] = useState<Record<string, string>>({});
  const ceiling = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCeiling = useCallback(() => {
    if (ceiling.current !== null) clearTimeout(ceiling.current);
    ceiling.current = null;
  }, []);
  useEffect(() => clearCeiling, [clearCeiling]);

  // Resolve the outstanding command from the live delta it promised. No
  // dependency array: this only reads current pending/delta state and is a
  // no-op once nothing is pending, so re-running it every render is cheap
  // and avoids a stale closure over `questions`/`questionDeltas`.
  useEffect(() => {
    if (!pendingId || !pendingKind) return;
    const delta = questionDeltas[pendingId];
    const resolved = pendingKind === 'editing'
      ? delta?.edited === true
      : pendingKind === 'sending'
        ? delta?.state === 'sent'
        : !questions.some((q) => q.id === pendingId); // discarding: the row is gone
    if (resolved) {
      clearCeiling();
      setPendingId(null);
      setPendingKind(null);
    }
  });

  const startPending = useCallback((id: string, kind: QuestionsPendingKind) => {
    setPendingId(id);
    setPendingKind(kind);
    setProblemByQuestionId((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    clearCeiling();
    ceiling.current = setTimeout(() => {
      ceiling.current = null;
      setPendingId(null);
      setPendingKind(null);
      setProblemByQuestionId((prev) => ({ ...prev, [id]: 'This did not resolve in time.' }));
    }, TIMERS['T-CMD-RESOLVE']);
  }, [clearCeiling]);

  const failPending = useCallback((id: string, error: unknown, fallback: string) => {
    clearCeiling();
    setPendingId(null);
    setPendingKind(null);
    setProblemByQuestionId((prev) => ({ ...prev, [id]: refusalMessage(error, fallback) }));
  }, [clearCeiling]);

  const editQuestion = useCallback((id: string, patch: QuestionUpdate) => {
    if (pendingId) return;
    startPending(id, 'editing');
    void client.editQuestion(id, patch).catch((error: unknown) => {
      failPending(id, error, 'Could not save the edit.');
    });
  }, [client, failPending, pendingId, startPending]);

  const discardQuestion = useCallback((id: string) => {
    if (pendingId) return;
    startPending(id, 'discarding');
    void client.discardQuestion(id).catch((error: unknown) => {
      failPending(id, error, 'Could not discard the question.');
    });
  }, [client, failPending, pendingId, startPending]);

  const sendToProjector = useCallback((id: string) => {
    if (pendingId || !quiz.loading && quiz.state !== 'open') return;
    startPending(id, 'sending');
    void client.sendToProjector(id).catch((error: unknown) => {
      failPending(id, error, 'Could not send to the projector.');
    });
  }, [client, failPending, pendingId, quiz.loading, quiz.state, startPending]);

  const regenerate = useCallback(() => {
    void client.generateNow().catch(() => {});
  }, [client]);

  return {
    loading: query.isPending && sessionId !== undefined,
    generating,
    questions,
    pendingId,
    pendingKind,
    problemByQuestionId,
    canSend: quiz.state === 'open',
    sendRefusalReason: quiz.state === 'open' ? null : SEND_REFUSAL_REASON,
    editQuestion,
    discardQuestion,
    sendToProjector,
    regenerate,
  };
}
