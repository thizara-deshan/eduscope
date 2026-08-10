import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import type { Recording, RecordingState, Ulid } from '@eduscope/shared';
import { useClient } from '../../client/client-provider.js';
import { useArtifactEvents, useUploadJobEvents } from '../../store/selectors.js';
import { LIB_KEYS } from './query-keys.js';

export interface LibraryFilters {
  q?: string | undefined;
  ownerUserId?: string | undefined;
  state?: RecordingState | undefined;
  includeDeleted?: boolean | undefined;
}

export interface RemovedRow {
  recordingId: string;
  deleteReason: string | null;
}

export interface UseRecordings {
  loading: boolean;
  /** REST rows patched by live artifact/upload.job — the same "no client owner-filter" page the server returned (C-1). */
  rows: readonly Recording[];
  /** Rows an artifact{deleted} pulled out from under the user (state 9/10) — dropped from `rows`. */
  removed: readonly RemovedRow[];
  hasMore: boolean;
  loadMore(): void;
  loadingMore: boolean;
}

/**
 * S-21 list model: the paged `listRecordings` snapshot merged live with
 * `recording.artifact` (state/mergeState) and `upload.job` (uploadState) —
 * the same REST-snapshot + live-delta shape `use-questions.ts` uses. Cursor
 * pagination only (C-7): a filter change is a new query key (new cursor),
 * never a client-side filter over what happens to be loaded.
 */
export function useRecordings(filters: LibraryFilters): UseRecordings {
  const client = useClient();
  const artifacts = useArtifactEvents();
  const uploadJobs = useUploadJobEvents();

  const query = useInfiniteQuery({
    queryKey: LIB_KEYS.recordings(filters),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => client.listRecordings({
      ...(pageParam !== undefined && { cursor: pageParam }),
      ...(filters.q !== undefined && { q: filters.q }),
      ...(filters.ownerUserId !== undefined && { ownerUserId: filters.ownerUserId as Ulid }),
      ...(filters.state !== undefined && { state: filters.state }),
      ...(filters.includeDeleted !== undefined && { includeDeleted: filters.includeDeleted }),
    }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    // A filter change is a new query key (new cursor, C-7). Without this the
    // key swap flips the query back to `pending`, LibraryScreen renders its
    // skeleton branch, and LibraryFilters UNMOUNTS mid-keystroke — which
    // stranded the on-screen keyboard on a stale empty target, so every OSK
    // press replaced the field instead of appending. Keeping the previous
    // page mounted while the next loads holds the search field steady.
    placeholderData: keepPreviousData,
  });

  const baseRows = (query.data?.pages ?? []).flatMap((page) => page.items);

  const rows: Recording[] = [];
  const removed: RemovedRow[] = [];
  for (const row of baseRows) {
    const artifact = artifacts[row.id];
    // A row already fetched as a tombstone (includeDeleted) stays a tombstone —
    // only a LIVE transition into `deleted` for a row that was NOT already
    // deleted counts as "removed under the user" (state 9/10).
    if (row.state !== 'deleted' && artifact?.state === 'deleted') {
      removed.push({ recordingId: row.id, deleteReason: artifact.deleteReason });
      continue;
    }
    const job = uploadJobs[row.id];
    rows.push({
      ...row,
      state: artifact?.state ?? row.state,
      mergeState: artifact?.mergeState ?? row.mergeState,
      uploadState: job?.state ?? row.uploadState,
    });
  }

  return {
    loading: query.isPending,
    rows,
    removed,
    hasMore: query.hasNextPage ?? false,
    loadMore: () => { void query.fetchNextPage(); },
    loadingMore: query.isFetchingNextPage,
  };
}
