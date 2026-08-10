import { useEffect, useState } from 'react';
import { ProblemError } from '@eduscope/api-client';
import type { ExportJobPayload, UsbVolume } from '@eduscope/shared';
import { useClient } from '../../../client/client-provider.js';
import { useExportJobEvents, useUsbVolumes } from '../../../store/selectors.js';
import { computeEta, type EtaSample } from './use-eta.js';

export type ExportState = 'no-drive' | 'drives-listed' | 'insufficient-space'
  | 'queued' | 'copying' | 'completed' | 'drive-removed' | 'failed' | 'cancelled' | 'create-refused';

export interface UseExport {
  readonly state: ExportState;
  /** from listExportTargets + live usb.volumes */
  readonly volumes: readonly UsbVolume[];
  /** Σ totalBytes of the selection */
  readonly needBytes: number;
  readonly job: ExportJobPayload | null;
  readonly etaSeconds: number | null;
  /** CG-21 named reason for create-refused */
  readonly refusalReason: string | null;
  pick(devicePath: string): void;
  cancel(): void;
  retry(): void;
}

const SAMPLE_WINDOW = 6;

/**
 * S-23: opens the flow (`listExportTargets`, marking the session subscribed —
 * CG-3/C-3), merges live `usb.volumes`, issues `createExport`, tracks the job
 * via live `export.job`. Never reads `UsbVolume.freeBytes` for progress (C-2)
 * — progress is `bytesCopied`/`bytesTotal` only.
 */
export function useExport(recordingIds: readonly string[], needBytes: number): UseExport {
  const client = useClient();
  const liveVolumes = useUsbVolumes();
  const jobEvents = useExportJobEvents();

  const [volumes, setVolumes] = useState<readonly UsbVolume[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  // Seeded from createExport's own response — the mock (and a real backend)
  // emits no `queued` WS event, only the later copying/completed/failed
  // steps, so the initial state has to come from the 202's own body.
  const [seededJob, setSeededJob] = useState<ExportJobPayload | null>(null);
  const [lastDevicePath, setLastDevicePath] = useState<string | null>(null);
  const [refusalReason, setRefusalReason] = useState<string | null>(null);
  const [samples, setSamples] = useState<readonly EtaSample[]>([]);

  useEffect(() => {
    let cancelled = false;
    void client.listExportTargets().then((v) => {
      if (!cancelled) setVolumes(v);
    });
    return () => { cancelled = true; };
    // One-time open per mount (CG-3 subscribe), never re-issued on a client identity change.
  }, []);

  useEffect(() => {
    if (liveVolumes) setVolumes(liveVolumes.volumes);
  }, [liveVolumes]);

  const job = jobId ? (jobEvents[jobId] ?? seededJob) : null;

  useEffect(() => {
    if (!job) return;
    if (job.state === 'copying' || job.state === 'completed') {
      setSamples((prev) => [...prev, { bytesCopied: job.bytesCopied, at: Date.now() }].slice(-SAMPLE_WINDOW));
    }
  }, [job]);

  const start = (devicePath: string) => {
    setRefusalReason(null);
    setLastDevicePath(devicePath);
    setSamples([]);
    void client.createExport({ recordingIds: [...recordingIds], targetDevicePath: devicePath })
      .then((created) => {
        setJobId(created.id);
        setSeededJob({
          jobId: created.id, state: created.state, bytesCopied: created.bytesCopied,
          bytesTotal: created.bytesTotal, error: created.error,
        });
      })
      .catch((error: unknown) => {
        const code = error instanceof ProblemError ? error.problem.code : null;
        const title = error instanceof ProblemError ? (error.problem.detail ?? error.problem.title) : 'Could not start the copy.';
        setRefusalReason(code === 'export.insufficient-space' ? title : title);
      });
  };

  const cancel = () => {
    if (!jobId) return;
    void client.cancelExport(jobId);
  };

  const retry = () => {
    if (lastDevicePath) start(lastDevicePath);
  };

  const etaSeconds = job ? computeEta(job.bytesTotal, samples) : null;

  let state: ExportState;
  if (refusalReason) {
    state = 'create-refused';
  } else if (!job) {
    if (volumes.length === 0) state = 'no-drive';
    else if (volumes.every((v) => v.freeBytes < needBytes)) state = 'insufficient-space';
    else state = 'drives-listed';
  } else if (job.state === 'queued') {
    state = 'queued';
  } else if (job.state === 'copying') {
    state = 'copying';
  } else if (job.state === 'completed') {
    state = 'completed';
  } else if (job.state === 'cancelled') {
    state = 'cancelled';
  } else {
    // job.state === 'failed'
    state = job.error && /removed/i.test(job.error) ? 'drive-removed' : 'failed';
  }

  return { state, volumes, needBytes, job, etaSeconds, refusalReason, pick: start, cancel, retry };
}
