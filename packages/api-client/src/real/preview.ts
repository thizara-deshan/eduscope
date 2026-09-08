import type { SourceRoleId } from '@eduscope/shared';
import type { PreviewChannel, PreviewErrorCode, PreviewUpdate } from '../client.js';
import { createEmitter } from '../stream.js';

const POLL_MS = 1_000;
const STALE_MS = 3_000;

export interface PreviewClock {
  now(): number;
  setTimeout(handler: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

export interface PreviewRequest {
  readonly roleId: SourceRoleId;
  readonly cacheBust: string;
  readonly signal: AbortSignal;
}

export function createPreviewPoller(options: {
  roleId: SourceRoleId;
  request(input: PreviewRequest): Promise<Blob>;
  clock: PreviewClock;
  onClose?: () => void;
}): PreviewChannel {
  const { roleId, request, clock, onClose } = options;
  const updates = createEmitter<PreviewUpdate>();
  const startedAt = clock.now();
  let lastSuccessfulAt: number | null = null;
  let nextTickAt = startedAt + POLL_MS;
  let tickTimer: number | null = null;
  let staleTimer: number | null = null;
  let controller: AbortController | null = null;
  let inFlight = false;
  let closed = false;
  let cacheSequence = 0;
  let hasFrame = false;

  const clearTimer = (id: number | null) => {
    if (id !== null) clock.clearTimeout(id);
  };

  const scheduleStale = () => {
    clearTimer(staleTimer);
    const baseline = lastSuccessfulAt ?? startedAt;
    staleTimer = clock.setTimeout(() => {
      staleTimer = null;
      if (!closed) updates.emit({ kind: 'stale', since: baseline });
    }, Math.max(0, baseline + STALE_MS - clock.now()));
  };

  const reportError = (error: unknown) => {
    if (hasFrame || closed) return;
    const details = previewError(error);
    updates.emit({ kind: 'error', ...details });
  };

  const poll = async () => {
    if (closed || inFlight) return;
    inFlight = true;
    const ownController = new AbortController();
    controller = ownController;
    cacheSequence += 1;
    try {
      const blob = await request({
        roleId,
        cacheBust: `${clock.now().toString(36)}-${cacheSequence.toString(36)}`,
        signal: ownController.signal,
      });
      if (closed || ownController.signal.aborted) return;
      if (!(await isCompleteJpeg(blob))) {
        reportError(new Error('Preview response was not a complete JPEG.'));
        return;
      }
      hasFrame = true;
      lastSuccessfulAt = clock.now();
      updates.emit({ kind: 'frame', blob, receivedAt: lastSuccessfulAt, stale: false });
      scheduleStale();
    } catch (error) {
      if (!closed && !ownController.signal.aborted) reportError(error);
    } finally {
      if (controller === ownController) controller = null;
      inFlight = false;
    }
  };

  const scheduleTick = () => {
    tickTimer = clock.setTimeout(() => {
      tickTimer = null;
      if (closed) return;
      if (!inFlight) void poll();
      do nextTickAt += POLL_MS;
      while (nextTickAt <= clock.now());
      scheduleTick();
    }, Math.max(0, nextTickAt - clock.now()));
  };

  scheduleStale();
  scheduleTick();
  void poll();

  return {
    updates$: updates,
    close() {
      if (closed) return;
      closed = true;
      clearTimer(tickTimer);
      clearTimer(staleTimer);
      tickTimer = null;
      staleTimer = null;
      controller?.abort();
      controller = null;
      onClose?.();
    },
  };
}

async function isCompleteJpeg(blob: Blob): Promise<boolean> {
  if (blob.type.toLowerCase() !== 'image/jpeg' || blob.size < 4) return false;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[bytes.length - 2] === 0xff
    && bytes[bytes.length - 1] === 0xd9;
}

function previewError(error: unknown): { code: PreviewErrorCode; message: string } {
  if (typeof error === 'object' && error !== null && 'problem' in error) {
    const problem = (error as { problem?: { code?: string; title?: string } }).problem;
    if (problem?.code === 'source-offline' || problem?.code === 'source-unbound') {
      return { code: problem.code, message: problem.title ?? 'Preview unavailable.' };
    }
  }
  return { code: 'internal', message: 'The preview could not be loaded.' };
}
