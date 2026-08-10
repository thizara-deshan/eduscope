import { useEffect, useRef, useState } from 'react';
import { QuizAppProblemError } from '@eduscope/api-client/quiz';
import { useQuizClient } from '../../client/quiz-client-provider.js';

export type AnswerPhase = 'idle' | 'submitting' | 'locked' | 'rejected-closed' | 'retryable';

/**
 * One mutation per publication. The FIRST tap locks the UI optimistically;
 * the REST reply reconciles it — including `already-accepted` (duplicate
 * taps, or a reply-lost retry) and `question.closed` (S-39's one server-
 * authoritative refusal). Resets only when `publicationId` changes or the
 * store hands us an authoritative own-answer (e.g. a reconnect snapshot).
 */
export function useSubmitAnswer(publicationId: string | null, ownAnswerOptionId: string | null) {
  const client = useQuizClient();
  const [phase, setPhase] = useState<AnswerPhase>(ownAnswerOptionId ? 'locked' : 'idle');
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(ownAnswerOptionId);
  const seenPublicationId = useRef(publicationId);

  useEffect(() => {
    if (publicationId !== seenPublicationId.current) {
      seenPublicationId.current = publicationId;
      setPhase(ownAnswerOptionId ? 'locked' : 'idle');
      setSelectedOptionId(ownAnswerOptionId);
      return;
    }
    if (ownAnswerOptionId !== null && ownAnswerOptionId !== selectedOptionId) {
      setPhase('locked');
      setSelectedOptionId(ownAnswerOptionId);
    }
  }, [publicationId, ownAnswerOptionId, selectedOptionId]);

  const submit = async (optionId: string) => {
    if (!publicationId || phase === 'submitting' || phase === 'locked') return;
    setSelectedOptionId(optionId);
    setPhase('submitting');
    try {
      const response = await client.submitAnswer(publicationId, { selectedOptionId: optionId });
      setSelectedOptionId(response.selectedOptionId);
      setPhase('locked');
    } catch (error) {
      if (error instanceof QuizAppProblemError && error.problem.code === 'question.closed') {
        setPhase('rejected-closed');
        return;
      }
      setPhase('retryable');
    }
  };

  return { phase, selectedOptionId, submit };
}
