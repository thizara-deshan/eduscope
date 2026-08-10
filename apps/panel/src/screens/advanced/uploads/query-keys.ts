import type { UploadJobState } from '@eduscope/shared';

export const UPLOAD_KEYS = {
  jobs: (filter: { state?: UploadJobState | undefined }) => ['uploads', 'jobs', filter] as const,
  job: (jobId: string | undefined) => ['uploads', 'job', jobId] as const,
};
