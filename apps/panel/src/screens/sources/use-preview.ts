import { useCallback, useEffect, useRef, useState } from 'react';
import type { PreviewChannel } from '@eduscope/api-client';
import { isMockPreviewFrame } from '@eduscope/api-client/mock';
import type { PreviewServerMessage, SourceRoleId } from '@eduscope/shared';
import { useClient } from '../../client/client-provider.js';
import { useIsStale } from '../../store/selectors.js';

export type PreviewErrorCode = 'source-offline' | 'source-unbound' | 'busy' | 'internal';

export type PreviewState =
  | { readonly kind: 'negotiating' }
  | { readonly kind: 'live'; readonly frame: string }
  | { readonly kind: 'failed'; readonly code: PreviewErrorCode; readonly message: string }
  | { readonly kind: 'closed'; readonly reason: 'user' | 'disconnected' };

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let previewCounter = 0;

function base32(value: number, length: number): string {
  let remaining = value;
  let encoded = '';
  for (let index = 0; index < length; index += 1) {
    encoded = CROCKFORD[remaining % 32] + encoded;
    remaining = Math.floor(remaining / 32);
  }
  return encoded;
}

function mintNegotiationId(): string {
  previewCounter += 1;
  return `${base32(Date.now(), 10)}${base32(previewCounter, 16)}`;
}

/** Mock-only signaling frames become a plain string; real ICE remains signaling data. */
function mockFrame(message: PreviewServerMessage): string | null {
  return isMockPreviewFrame(message) ? message.candidate : null;
}

interface ActivePreview {
  readonly channel: PreviewChannel;
  readonly negotiationId: string;
  unsubscribe: () => void;
  closed: boolean;
}

export function usePreview(roleId: SourceRoleId): { readonly state: PreviewState; close(): void } {
  const client = useClient();
  const stale = useIsStale();
  const activeRef = useRef<ActivePreview | null>(null);
  const [state, setState] = useState<PreviewState>({ kind: 'negotiating' });

  const finish = useCallback((reason: 'user' | 'disconnected', updateState: boolean) => {
    const active = activeRef.current;
    if (!active || active.closed) return;
    active.closed = true;
    active.channel.send({ type: 'close', negotiationId: active.negotiationId });
    active.unsubscribe();
    active.channel.close();
    activeRef.current = null;
    if (updateState) setState({ kind: 'closed', reason });
  }, []);

  useEffect(() => {
    setState({ kind: 'negotiating' });
    const channel = client.openPreview();
    const negotiationId = mintNegotiationId();
    const active: ActivePreview = {
      channel,
      negotiationId,
      unsubscribe: () => undefined,
      closed: false,
    };
    activeRef.current = active;
    active.unsubscribe = channel.messages$.subscribe((message) => {
      if (active.closed || message.negotiationId !== negotiationId) return;
      if (message.type === 'answer') {
        setState({ kind: 'live', frame: '' });
        return;
      }
      if (message.type === 'error') {
        setState({ kind: 'failed', code: message.code, message: message.message });
        return;
      }
      const frame = mockFrame(message);
      if (frame !== null) setState({ kind: 'live', frame });
    });
    channel.send({
      type: 'offer',
      negotiationId,
      roleId,
      sdp: 'v=0\r\ns=eduscope-panel-preview\r\nt=0 0\r\n',
    });

    return () => {
      if (activeRef.current === active) finish('user', false);
    };
  }, [client, finish, roleId]);

  useEffect(() => {
    if (stale) finish('disconnected', true);
  }, [finish, stale]);

  const close = useCallback(() => finish('user', true), [finish]);
  return { state, close };
}
