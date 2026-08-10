import { useInfiniteQuery } from '@tanstack/react-query';
import type { UploadJob, UploadJobState } from '@eduscope/shared';
import { useClient } from '../../../client/client-provider.js';
import { useUploadJobEvents } from '../../../store/selectors.js';
import { UPLOAD_KEYS } from './query-keys.js';

export interface UseUploadJobs {
  readonly loading: boolean;
  /** listUploadJobs patched by live upload.job */
  readonly jobs: readonly UploadJob[];
  readonly hasMore: boolean;
  loadMore(): void;
}

/** S-35: the paged `listUploadJobs` snapshot merged live with `upload.job` (keyed by recordingId, INV-UJ-1). */
export function useUploadJobs(filter: { state?: UploadJobState | undefined }): UseUploadJobs {
  const client = useClient();
  const jobEvents = useUploadJobEvents();

  const query = useInfiniteQuery({
    queryKey: UPLOAD_KEYS.jobs(filter),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => client.listUploadJobs({
      ...(pageParam !== undefined && { cursor: pageParam }),
      ...(filter.state !== undefined && { state: filter.state }),
    }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const baseJobs = (query.data?.pages ?? []).flatMap((page) => page.items);
  const jobs = baseJobs.map((job) => {
    const delta = jobEvents[job.recordingId];
    if (!delta || delta.jobId !== job.id) return job;
    return {
      ...job,
      state: delta.state,
      attempt: delta.attempt,
      failureClass: delta.failureClass,
      nextAttemptAt: delta.nextAttemptAt,
      progressPct: delta.progressPct,
      lastError: delta.lastError ?? job.lastError,
      blockedBy: delta.blockedBy as UploadJob['blockedBy'],
    };
  });

  return {
    loading: query.isPending,
    jobs,
    hasMore: query.hasNextPage ?? false,
    loadMore: () => { void query.fetchNextPage(); },
  };
}
