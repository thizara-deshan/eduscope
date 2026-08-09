import { useCallback, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PublicationCloseReason, PublicationWithQuestion, QuizSyncState } from '@eduscope/shared';
import { useClient } from '../client/client-provider.js';
import { useRecordingSession, usePublicationsList, useWsShallow } from '../store/selectors.js';
import { AI_KEYS } from './query-keys.js';

export interface InsightsPublicationView {
  readonly publicationId: string;
  readonly questionId: string;
  readonly prompt: string;
  readonly correctOptionText: string | null;
  readonly state: PublicationWithQuestion['state'];
  readonly isShowing: boolean;
  readonly projectorState: PublicationWithQuestion['projectorState'];
  readonly closeReason: PublicationCloseReason | null;
  readonly responseCount: number;
  readonly correctCount: number;
  readonly incorrectCount: number;
  readonly syncState: QuizSyncState;
  /** Q-36 re-projecting a `closed` publication (reveal mode) — acceptance does NOT reopen. */
  readonly reveal: boolean;
}

export interface UseInsights {
  readonly loading: boolean;
  readonly publications: readonly InsightsPublicationView[];
  /** Any publication's own syncState going stale (Z-30 re-emits it with the count). */
  readonly responsesStale: boolean;
  /** Machine 4d hard-failed (Z-32) — recorded from the alert; nothing on quiz.publication itself flips (QZ-7 mock gap). */
  readonly syncFailed: boolean;
  closePublication(publicationId: string): void;
  reproject(publicationId: string): void;
  withdraw(): void;
}

/**
 * S-16 model: `listPublications` snapshot merged with live `quiz.publication`
 * deltas (state/isShowing/projectorState/syncState/closeReason — WS is
 * keyed by `publicationId`, REST by `id`). Newest-first; exactly one carries
 * `isShowing` (INV-QPUB-1).
 */
export function useInsights(): UseInsights {
  const client = useClient();
  const queryClient = useQueryClient();
  const session = useRecordingSession();
  const sessionId = session?.sessionId ?? undefined;
  const wsPublications = usePublicationsList();
  const alerts = useWsShallow((s) => Object.values(s.alerts));

  const query = useQuery({
    queryKey: AI_KEYS.publications(sessionId),
    queryFn: () => client.listPublications({ sessionId: sessionId! }),
    enabled: sessionId !== undefined,
  });

  // A publication Q-30 mints mid-session has no REST row until the next
  // snapshot — refetch once per newly-observed id rather than teaching this
  // hook to hand-assemble a PublicationWithQuestion from WS fields alone.
  const knownIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const row of query.data ?? []) knownIds.current.add(row.id);
  }, [query.data]);
  useEffect(() => {
    if (sessionId === undefined) return;
    const unseen = wsPublications.some((p) => !knownIds.current.has(p.publicationId));
    if (unseen) void queryClient.invalidateQueries({ queryKey: AI_KEYS.publications(sessionId) });
  }, [wsPublications, sessionId, queryClient]);

  const deltaById = new Map(wsPublications.map((p) => [p.publicationId, p]));
  const publications: InsightsPublicationView[] = (query.data ?? []).map((row) => {
    const delta = deltaById.get(row.id);
    const state = delta?.state ?? row.state;
    const projectorState = delta?.projectorState ?? row.projectorState;
    const isShowing = delta?.isShowing ?? row.isShowing;
    return {
      publicationId: row.id,
      questionId: row.questionId,
      prompt: row.question.prompt,
      correctOptionText: row.question.options.find((o) => o.id === row.question.correctOptionId)?.text ?? null,
      state,
      isShowing,
      projectorState,
      closeReason: delta?.closeReason ?? row.closeReason,
      responseCount: row.responseCount,
      correctCount: row.correctCount,
      incorrectCount: row.incorrectCount,
      syncState: delta?.syncState ?? row.syncState,
      reveal: state === 'closed' && projectorState === 'showing',
    };
  }).reverse(); // newest-first: live-created rows are always appended after the REST snapshot's own order

  const syncFailed = alerts.some((a) => a.code === 'quiz.sync-stale' && a.clearedAt === null);

  const closePublication = useCallback((publicationId: string) => {
    void client.closePublication(publicationId).catch(() => {});
  }, [client]);

  const reproject = useCallback((publicationId: string) => {
    void client.setProjector({ publicationId }).catch(() => {});
  }, [client]);

  const withdraw = useCallback(() => {
    void client.setProjector({ publicationId: null }).catch(() => {});
  }, [client]);

  return {
    loading: query.isPending && sessionId !== undefined,
    publications,
    responsesStale: publications.some((p) => p.syncState === 'stale'),
    syncFailed,
    closePublication,
    reproject,
    withdraw,
  };
}
