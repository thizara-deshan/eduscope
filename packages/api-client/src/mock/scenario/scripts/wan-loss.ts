import type { ScenarioScript } from '../types.js';

/** S-35 CG-20: an in-flight upload loses the network. It becomes failed +
 *  connectivity, spending NO attempt — "Waiting for the network", not "failed N of 8". */
export const wanLoss: ScenarioScript = {
  name: 'wan-loss',
  description: 'The upload server becomes unreachable: an in-flight upload switches to "waiting for the network" and spends no retry attempts (§4.4).',
  forced: [],
  emits: [
    {
      event: 'upload.job',
      afterMs: 2_000,
      payload: (seed) => {
        const job = seed.uploadJobs.find((j) => j.state === 'uploading') ?? seed.uploadJobs[0]!;
        return {
          jobId: job.id, recordingId: job.recordingId, state: 'failed',
          failureClass: 'connectivity', attempt: 0, nextAttemptAt: null,
          progressPct: job.progressPct, lastError: 'connect timeout — no route to the upload server', blockedBy: null,
        };
      },
    },
  ],
};
