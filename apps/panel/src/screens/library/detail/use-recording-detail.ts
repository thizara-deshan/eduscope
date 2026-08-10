import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ProblemError } from '@eduscope/api-client';
import type { RecordingDetail } from '@eduscope/shared';
import { useClient } from '../../../client/client-provider.js';
import { useArtifactEvents, useUploadJobEvents } from '../../../store/selectors.js';
import { LIB_KEYS } from '../query-keys.js';

export type DetailStatus = 'loading' | 'not-found' | 'forbidden' | 'ready' | 'deleted';

export interface UseRecordingDetail {
  readonly status: DetailStatus;
  /** patched by live artifact/upload.job */
  readonly detail: RecordingDetail | null;
  /** used by retry-merge to reload after the merging event */
  refetch(): void;
}

/**
 * S-22: `getRecording(id)` merged live with `recording.artifact`
 * (merge/ready/failed/deleted) and `upload.job` (the header badge). Surfaces
 * `404`/`403` as typed states rather than letting them bubble as errors.
 */
export function useRecordingDetail(recordingId: string): UseRecordingDetail {
  const client = useClient();
  const queryClient = useQueryClient();
  const artifacts = useArtifactEvents();
  const uploadJobs = useUploadJobEvents();
  const artifact = artifacts[recordingId];
  const job = uploadJobs[recordingId];

  const query = useQuery({
    queryKey: LIB_KEYS.recording(recordingId),
    queryFn: () => client.getRecording(recordingId),
    retry: false,
  });

  // A live recording.artifact for this recording (e.g. an admin's retry
  // landing at `merging`) means the server's truth moved — reload the real
  // detail rather than trying to reconstruct segments/files from the delta
  // (mirrors use-questions.ts's invalidate-on-newly-seen-id idiom).
  const lastArtifactState = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (artifact && artifact.state !== lastArtifactState.current) {
      lastArtifactState.current = artifact.state;
      void queryClient.invalidateQueries({ queryKey: LIB_KEYS.recording(recordingId) });
    }
  }, [artifact, recordingId, queryClient]);

  const refetch = () => { void query.refetch(); };

  if (query.isPending) {
    return { status: 'loading', detail: null, refetch };
  }

  if (query.isError) {
    const error = query.error;
    if (error instanceof ProblemError && error.problem.status === 403) {
      return { status: 'forbidden', detail: null, refetch };
    }
    return { status: 'not-found', detail: null, refetch };
  }

  const merged: RecordingDetail = {
    ...query.data,
    state: artifact?.state ?? query.data.state,
    mergeState: artifact?.mergeState ?? query.data.mergeState,
    uploadState: job?.state ?? query.data.uploadState,
  };

  if (merged.state === 'deleted') {
    return { status: 'deleted', detail: merged, refetch };
  }
  return { status: 'ready', detail: merged, refetch };
}
