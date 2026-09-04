import type { SourceRoleId } from '@eduscope/shared';
import type { PreviewChannel, PreviewErrorCode, PreviewUpdate } from '../../client.js';
import { createEmitter } from '../../stream.js';
import type { MockWorld } from '../world.js';
import { generateFrame } from './telemetry.js';

const POLL_MS = 1_000;
const STALE_MS = 3_000;

/** Mock implementation of the same receive-only JPEG channel as the real adapter. */
export function createPreviewChannel(
  world: MockWorld,
  roleId: SourceRoleId,
  onClose?: () => void,
): PreviewChannel {
  const updates = createEmitter<PreviewUpdate>();
  let closed = false;
  let frameTimer: number | null = null;
  let staleTimer: number | null = null;
  let sequence = 0;
  let hasFrame = false;

  const sourceError = (): { code: PreviewErrorCode; message: string } | null => {
    let state: string;
    try {
      state = world.state(`source:${roleId}`);
    } catch {
      return { code: 'source-unbound', message: `source ${roleId} has no physical input bound` };
    }
    if (state === 'unbound') {
      return { code: 'source-unbound', message: `source ${roleId} has no physical input bound` };
    }
    if (state === 'online' || state === 'degraded') return null;
    return { code: 'source-offline', message: `source ${roleId} is not online` };
  };

  const clearStale = () => {
    if (staleTimer !== null) world.clock.clearTimeout(staleTimer);
    staleTimer = null;
  };

  const armStale = (since: number) => {
    clearStale();
    staleTimer = world.clock.setTimeout(() => {
      staleTimer = null;
      if (!closed) updates.emit({ kind: 'stale', since });
    }, STALE_MS);
  };

  const scheduleFrame = (delay = POLL_MS) => {
    frameTimer = world.clock.setTimeout(() => {
      frameTimer = null;
      if (closed) return;
      const error = sourceError();
      if (error) {
        if (!hasFrame) updates.emit({ kind: 'error', ...error });
      } else {
        const blob = dataUriToJpeg(generateFrame(roleId, sequence));
        sequence += 1;
        hasFrame = true;
        const receivedAt = world.clock.now();
        updates.emit({ kind: 'frame', blob, receivedAt, stale: false });
        armStale(receivedAt);
      }
      scheduleFrame();
    }, delay);
  };

  const unsubscribe = world.subscribeEvents((envelope) => {
    if (closed || envelope.event !== 'sources.status') return;
    const payload = envelope.payload as { roleId: string; state: string };
    if (payload.roleId !== roleId) return;
    if (payload.state !== 'online' && payload.state !== 'degraded' && !hasFrame) {
      const error = sourceError();
      if (error) updates.emit({ kind: 'error', ...error });
    }
  });

  armStale(world.clock.now());
  scheduleFrame(0);

  return {
    updates$: updates,
    close() {
      if (closed) return;
      closed = true;
      if (frameTimer !== null) world.clock.clearTimeout(frameTimer);
      clearStale();
      unsubscribe();
      onClose?.();
    },
  };
}

function dataUriToJpeg(uri: string): Blob {
  const encoded = uri.slice(uri.indexOf(',') + 1).split('#', 1)[0]!;
  const binary = globalThis.atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: 'image/jpeg' });
}
