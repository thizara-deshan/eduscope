import { useCallback, useEffect, useRef, useState } from 'react';
import type { PreviewChannel } from '@eduscope/api-client';
import type { SourceRoleId } from '@eduscope/shared';
import { useClient } from '../../client/client-provider.js';
import { useWsStore } from '../../store/ws-store.js';
import type { PreviewFrame } from './preview-frame.js';

export type PreviewErrorCode = 'source-offline' | 'source-unbound' | 'internal';

export type PreviewState =
  | { readonly kind: 'negotiating' }
  | { readonly kind: 'live'; readonly frame: PreviewFrame }
  | { readonly kind: 'stale'; readonly frame: PreviewFrame }
  | { readonly kind: 'failed'; readonly code: PreviewErrorCode; readonly message: string }
  | { readonly kind: 'closed'; readonly reason: 'user' };

interface ActivePreview {
  readonly channel: PreviewChannel;
  unsubscribe: () => void;
  bitmap: ImageBitmap | null;
  decodeGeneration: number;
  closed: boolean;
}

export function usePreview(roleId: SourceRoleId): { readonly state: PreviewState; close(): void } {
  const client = useClient();
  const sourceState = useWsStore((store) => store.sources[roleId]?.state);
  const activeRef = useRef<ActivePreview | null>(null);
  const [state, setState] = useState<PreviewState>({ kind: 'negotiating' });

  const finish = useCallback((updateState: boolean) => {
    const active = activeRef.current;
    if (!active || active.closed) return;
    active.closed = true;
    active.unsubscribe();
    active.channel.close();
    active.decodeGeneration += 1;
    active.bitmap?.close();
    active.bitmap = null;
    activeRef.current = null;
    if (updateState) setState({ kind: 'closed', reason: 'user' });
  }, []);

  useEffect(() => {
    setState({ kind: 'negotiating' });
    const channel = client.openPreview(roleId);
    const active: ActivePreview = {
      channel,
      unsubscribe: () => undefined,
      bitmap: null,
      decodeGeneration: 0,
      closed: false,
    };
    activeRef.current = active;
    active.unsubscribe = channel.updates$.subscribe((update) => {
      if (active.closed) return;
      if (update.kind === 'frame') {
        const generation = ++active.decodeGeneration;
        void createImageBitmap(update.blob).then((bitmap) => {
          if (active.closed || generation !== active.decodeGeneration) {
            bitmap.close();
            return;
          }
          active.bitmap?.close();
          active.bitmap = bitmap;
          setState({ kind: 'live', frame: bitmap });
        }).catch(() => {
          if (!active.closed && active.bitmap === null) {
            setState({ kind: 'failed', code: 'internal', message: 'The preview could not be loaded.' });
          }
        });
        return;
      }
      if (update.kind === 'stale') {
        if (active.bitmap) setState({ kind: 'stale', frame: active.bitmap });
        return;
      }
      if (!active.bitmap) {
        setState({ kind: 'failed', code: update.code, message: update.message });
      }
    });

    return () => {
      if (activeRef.current === active) finish(false);
    };
  }, [client, finish, roleId]);

  useEffect(() => {
    if (sourceState === 'online' || sourceState === 'degraded' || sourceState === undefined) return;
    setState((current) => current.kind === 'live'
      ? { kind: 'stale', frame: current.frame }
      : current);
  }, [sourceState]);

  const close = useCallback(() => finish(true), [finish]);
  return { state, close };
}
