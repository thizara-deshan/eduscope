import { useCallback, useEffect, useRef, useState } from 'react';
import type { PreviewChannel } from '@eduscope/api-client';
import type { SourceRoleId } from '@eduscope/shared';
import { useClient } from '../../client/client-provider.js';

export type PreviewErrorCode = 'source-offline' | 'source-unbound' | 'internal';

export type PreviewState =
  | { readonly kind: 'negotiating' }
  | { readonly kind: 'live'; readonly frame: string }
  | { readonly kind: 'stale'; readonly frame: string }
  | { readonly kind: 'failed'; readonly code: PreviewErrorCode; readonly message: string }
  | { readonly kind: 'closed'; readonly reason: 'user' };

interface ActivePreview {
  readonly channel: PreviewChannel;
  unsubscribe: () => void;
  objectUrl: string | null;
  closed: boolean;
}

export function usePreview(roleId: SourceRoleId): { readonly state: PreviewState; close(): void } {
  const client = useClient();
  const activeRef = useRef<ActivePreview | null>(null);
  const [state, setState] = useState<PreviewState>({ kind: 'negotiating' });

  const finish = useCallback((updateState: boolean) => {
    const active = activeRef.current;
    if (!active || active.closed) return;
    active.closed = true;
    active.unsubscribe();
    active.channel.close();
    if (active.objectUrl) URL.revokeObjectURL(active.objectUrl);
    active.objectUrl = null;
    activeRef.current = null;
    if (updateState) setState({ kind: 'closed', reason: 'user' });
  }, []);

  useEffect(() => {
    setState({ kind: 'negotiating' });
    const channel = client.openPreview(roleId);
    const active: ActivePreview = {
      channel,
      unsubscribe: () => undefined,
      objectUrl: null,
      closed: false,
    };
    activeRef.current = active;
    active.unsubscribe = channel.updates$.subscribe((update) => {
      if (active.closed) return;
      if (update.kind === 'frame') {
        const nextUrl = URL.createObjectURL(update.blob);
        if (active.objectUrl) URL.revokeObjectURL(active.objectUrl);
        active.objectUrl = nextUrl;
        setState({ kind: 'live', frame: nextUrl });
        return;
      }
      if (update.kind === 'stale') {
        if (active.objectUrl) setState({ kind: 'stale', frame: active.objectUrl });
        return;
      }
      if (!active.objectUrl) {
        setState({ kind: 'failed', code: update.code, message: update.message });
      }
    });

    return () => {
      if (activeRef.current === active) finish(false);
    };
  }, [client, finish, roleId]);

  const close = useCallback(() => finish(true), [finish]);
  return { state, close };
}
