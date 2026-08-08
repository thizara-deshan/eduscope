import { useCallback, useEffect, useRef, useState } from 'react';
import { ProblemError } from '@eduscope/api-client';
import { useClient } from '../../client/client-provider.js';
import { useConnectionPhase, useExpectedShutdown } from '../../store/selectors.js';
import { useWsStore } from '../../store/ws-store.js';

export const POWEROFF_BLOCKED_REASON = 'This device is recording — stop the lecture first.';

export type PowerOffState =
  | { readonly kind: 'confirm' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'refused-recording' }
  | { readonly kind: 'refused-other'; readonly title: string }
  | { readonly kind: 'accepted' }
  | { readonly kind: 'accepted-not-halted' };

export function usePowerOff(): {
  readonly state: PowerOffState;
  confirm(): void;
  retry(): void;
} {
  const client = useClient();
  const connectionPhase = useConnectionPhase();
  const expectedShutdown = useExpectedShutdown();
  const [state, setState] = useState<PowerOffState>({ kind: 'confirm' });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef(0);
  const mountedRef = useRef(true);

  const clearCeiling = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearCeiling();
    };
  }, [clearCeiling]);

  useEffect(() => {
    if (!expectedShutdown || connectionPhase !== 'closed') return;
    clearCeiling();
    setState({ kind: 'accepted' });
  }, [clearCeiling, connectionPhase, expectedShutdown]);

  const execute = useCallback(() => {
    clearCeiling();
    const request = requestRef.current + 1;
    requestRef.current = request;
    setState({ kind: 'pending' });

    void client.powerOffDevice().then((response) => {
      if (!mountedRef.current || requestRef.current !== request) return;
      useWsStore.getState().setExpectedShutdown(true);
      if (useWsStore.getState().connection?.phase === 'closed') {
        setState({ kind: 'accepted' });
        return;
      }
      timerRef.current = setTimeout(() => {
        if (!mountedRef.current || requestRef.current !== request) return;
        timerRef.current = null;
        setState({ kind: 'accepted-not-halted' });
      }, response.resolveBySec * 1_000);
    }).catch((error: unknown) => {
      if (!mountedRef.current || requestRef.current !== request) return;
      if (error instanceof ProblemError && error.problem.code === 'poweroff.refused') {
        setState({ kind: 'refused-recording' });
        return;
      }
      setState({
        kind: 'refused-other',
        title: error instanceof ProblemError
          ? error.problem.title
          : 'The device could not be powered off.',
      });
    });
  }, [clearCeiling, client]);

  return { state, confirm: execute, retry: execute };
}
