import { useQuery } from '@tanstack/react-query';
import type { AnswerProjection } from '@eduscope/shared';
import { useClient } from '../client/client-provider.js';
import { useResponsesEvent } from '../store/selectors.js';
import { AI_KEYS } from './query-keys.js';

export interface UsePublicationResponses {
  readonly loading: boolean;
  readonly items: readonly AnswerProjection[];
  readonly syncedAt: string | null;
  readonly stale: boolean;
}

/**
 * S-18/S-19 model: `listPublicationResponses` snapshot merged with the live
 * `quiz.responses` batch for the same publication — a delta replaces (never
 * duplicates) the row for its student, since each student answers a
 * publication at most once (DM-14, minimal PII).
 */
export function usePublicationResponses(publicationId: string | undefined): UsePublicationResponses {
  const client = useClient();
  const responsesEvent = useResponsesEvent();

  const query = useQuery({
    queryKey: AI_KEYS.responses(publicationId),
    queryFn: () => client.listPublicationResponses(publicationId!),
    enabled: publicationId !== undefined,
  });

  const items = new Map<string, AnswerProjection>();
  for (const item of query.data?.items ?? []) items.set(item.studentIdNumber, item);

  const matchingEvent = responsesEvent?.publicationId === publicationId ? responsesEvent : null;
  if (matchingEvent) {
    for (const delta of matchingEvent.deltas) {
      items.set(delta.studentIdNumber, {
        id: delta.studentIdNumber,
        publicationId: matchingEvent.publicationId,
        studentIdNumber: delta.studentIdNumber,
        studentDisplayName: delta.displayName,
        selectedOptionId: delta.selectedOptionId,
        isCorrect: delta.isCorrect,
        responseTimeMs: delta.responseTimeMs,
        submittedAt: delta.submittedAt,
        syncedAt: matchingEvent.syncedAt,
      });
    }
  }

  return {
    loading: query.isPending && publicationId !== undefined,
    items: [...items.values()],
    syncedAt: matchingEvent?.syncedAt ?? query.data?.syncedAt ?? null,
    stale: matchingEvent?.stale ?? query.data?.stale ?? false,
  };
}
