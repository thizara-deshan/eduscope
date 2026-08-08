import { useCallback, useEffect, useRef, useState } from 'react';
import { TIMERS } from '@eduscope/shared';
import { useAuth } from '../../auth/auth-context.js';
import { useClient } from '../../client/client-provider.js';
import { useIsStale, useRecordingSession } from '../../store/selectors.js';

export type TransportCommand = 'pause' | 'resume' | 'stop';
export interface UseTransport {
  readonly pending: TransportCommand | null;
  readonly failure: string | null;
  readonly canCommand: boolean;
  run(command: TransportCommand): void;
}

const RESOLVED_BY: Record<TransportCommand, readonly string[]> = {
  pause: ['paused'],
  resume: ['recording'],
  stop: ['stopping', 'finalizing', 'completed'],
};

export function useTransport(): UseTransport {
  const client = useClient();
  const auth = useAuth();
  const session = useRecordingSession();
  const stale = useIsStale();
  const [pending, setPending] = useState<TransportCommand | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const issuedFrom = useRef<string | null>(null);
  const ceiling = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCeiling = useCallback(() => {
    if (ceiling.current !== null) clearTimeout(ceiling.current);
    ceiling.current = null;
  }, []);

  useEffect(() => clearCeiling, [clearCeiling]);

  useEffect(() => {
    if (!pending || !session || session.state === issuedFrom.current) return;
    if (RESOLVED_BY[pending].includes(session.state)) {
      clearCeiling();
      setPending(null);
      setFailure(null);
    }
  }, [clearCeiling, pending, session]);

  const canCommand = Boolean(
    auth.user?.id
      && (auth.user.id === session?.ownerUserId || auth.user.id === session?.takeoverBy)
      && !stale,
  );

  const run = useCallback((command: TransportCommand) => {
    if (!canCommand || pending) return;
    issuedFrom.current = session?.state ?? null;
    setPending(command);
    setFailure(null);
    clearCeiling();
    ceiling.current = setTimeout(() => {
      ceiling.current = null;
      setPending(null);
      setFailure(`${command[0]!.toUpperCase()}${command.slice(1)} did not resolve in time.`);
    }, TIMERS['T-CMD-RESOLVE']);

    const request = command === 'pause'
      ? client.pauseRecording()
      : command === 'resume'
        ? client.resumeRecording()
        : client.stopRecording();
    void request.catch((error: unknown) => {
      clearCeiling();
      setPending(null);
      setFailure(error instanceof Error ? error.message : String(error));
    });
  }, [canCommand, clearCeiling, client, pending, session?.state]);

  return { pending, failure, canCommand, run };
}
