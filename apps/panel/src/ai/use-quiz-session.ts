import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useClient } from '../client/client-provider.js';
import { useQuizSession as useQuizSessionSlice } from '../store/selectors.js';
import { AI_KEYS } from './query-keys.js';

export interface QuizSessionView {
  readonly loading: boolean;
  readonly state: 'absent' | 'requesting' | 'open' | 'failed' | 'closed';
  readonly joinUrl: string | null;
  readonly joinCode: string | null;
  readonly joinedCount: number;
  readonly syncState: 'synced' | 'stale' | 'failed' | null;
  /** Local receipt time of the current snapshot — neither payload carries a timestamp. */
  readonly updatedAt: string | null;
}

/**
 * S-20/S-14 model: one read of `QuizSessionProjection`, merging the
 * `getQuizSession` REST snapshot with the live `quiz.session` WS slice — the
 * same selector the chip, the modal, and S-14's Send gate all read, so they
 * cannot disagree (S20-D-4/D-5, "one control, one truth").
 */
export function useQuizSession(): QuizSessionView {
  const client = useClient();
  const wsSession = useQuizSessionSlice();
  const query = useQuery({
    queryKey: AI_KEYS.quizSession,
    queryFn: () => client.getQuizSession(),
  });

  const session = wsSession ?? query.data ?? null;

  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  useEffect(() => {
    if (session) setUpdatedAt(new Date().toISOString());
  }, [session]);

  return {
    loading: session === null,
    state: session?.state ?? 'absent',
    joinUrl: session?.joinUrl ?? null,
    joinCode: session?.joinCode ?? null,
    joinedCount: session?.joinedCount ?? 0,
    syncState: session?.syncState ?? null,
    updatedAt,
  };
}
