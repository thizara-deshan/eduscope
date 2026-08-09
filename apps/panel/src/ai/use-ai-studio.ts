import {
  useCallback, useEffect, useRef, useState,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { ProblemError } from '@eduscope/api-client';
import { TIMERS, type AiCountdownState, type IntervalMinutes } from '@eduscope/shared';
import { useClient } from '../client/client-provider.js';
import {
  useAiCountdown, useAiSet, useIsStale, useRecordingSession, useRecordingState,
} from '../store/selectors.js';
import { AI_KEYS } from './query-keys.js';

/** A-14/INT-11 default; the prototype's 15 is drift. */
export const DEFAULT_INTERVAL_MINUTES: IntervalMinutes = 20;

export interface UseAiStudio {
  /** U-1: no snapshot yet from either REST or WS. */
  readonly loading: boolean;
  /** U-2. */
  readonly stale: boolean;
  /** W4-D-3: `held` is derived from `recordingState === 'paused'`, not a machine state. */
  readonly state: AiCountdownState;
  readonly remainingMs: number | null;
  readonly nextAt: string | null;
  readonly intervalMinutes: IntervalMinutes;
  readonly draftCount: number;
  readonly setReady: boolean;
  readonly setFailed: boolean;
  readonly setErrorReason: string | null;
  readonly generatePending: boolean;
  readonly intervalPending: boolean;
  /** U-5: the reason a command was refused (or timed out). */
  readonly refusal: string | null;
  generateNow(): void;
  setInterval(minutes: IntervalMinutes): void;
}

function refusalMessage(error: unknown, fallback: string): string {
  if (error instanceof ProblemError) return error.problem.detail ?? error.problem.title;
  return fallback;
}

/**
 * S-13 model: merges the `getAiCountdown` REST snapshot with the live
 * `ai.countdown`/`ai.set` WS slices (WS wins once it has ingested anything —
 * `bootstrapFromSeed` always emits a snapshot on connect, so in practice the
 * two agree). `generateNow`/`setInterval` are 202-async: pending clears when
 * the WS state the command promised actually arrives, with a T-CMD-RESOLVE
 * ceiling as a last resort (frontend-conventions §1).
 */
export function useAiStudio(): UseAiStudio {
  const client = useClient();
  const session = useRecordingSession();
  const recordingState = useRecordingState();
  const stale = useIsStale();
  const wsCountdown = useAiCountdown();
  const wsSet = useAiSet();
  const sessionId = session?.sessionId ?? undefined;

  const countdownQuery = useQuery({
    queryKey: AI_KEYS.countdown,
    queryFn: () => client.getAiCountdown(),
  });
  const draftsQuery = useQuery({
    queryKey: AI_KEYS.questions(sessionId),
    queryFn: () => client.listQuestions({ sessionId: sessionId!, state: 'draft' }),
    enabled: sessionId !== undefined,
  });

  const [generatePending, setGeneratePending] = useState(false);
  const [intervalPending, setIntervalPending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const generateCeiling = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalCeiling = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastObservedSetState = useRef<string | null>(null);

  useEffect(() => () => {
    if (generateCeiling.current !== null) clearTimeout(generateCeiling.current);
    if (intervalCeiling.current !== null) clearTimeout(intervalCeiling.current);
  }, []);

  // generateNow resolves when a NEW ai.set reaches ready/failed (not merely
  // 'requested'/'generating', which is the command's own optimistic echo).
  useEffect(() => {
    if (!wsSet || lastObservedSetState.current === `${wsSet.setId}:${wsSet.state}`) return;
    lastObservedSetState.current = `${wsSet.setId}:${wsSet.state}`;
    if (generatePending && (wsSet.state === 'ready' || wsSet.state === 'failed')) {
      if (generateCeiling.current !== null) clearTimeout(generateCeiling.current);
      generateCeiling.current = null;
      setGeneratePending(false);
    }
  }, [generatePending, wsSet]);

  // setAiInterval (Q-10) resolves on the next ai.countdown ingest.
  useEffect(() => {
    if (!intervalPending || !wsCountdown) return;
    if (intervalCeiling.current !== null) clearTimeout(intervalCeiling.current);
    intervalCeiling.current = null;
    setIntervalPending(false);
    // Only the arrival matters here, not which fields changed.
  }, [wsCountdown]);

  const countdown = wsCountdown ?? countdownQuery.data ?? null;
  const loading = countdown === null;
  const machineState: AiCountdownState = countdown?.state ?? 'unavailable';
  const state: AiCountdownState = recordingState === 'paused' && machineState !== 'unavailable'
    ? 'held'
    : machineState;

  const draftCount = wsSet?.state === 'ready'
    ? wsSet.count ?? draftsQuery.data?.length ?? 0
    : draftsQuery.data?.length ?? 0;

  const generateNow = useCallback(() => {
    if (generatePending) return;
    setRefusal(null);
    setGeneratePending(true);
    if (generateCeiling.current !== null) clearTimeout(generateCeiling.current);
    generateCeiling.current = setTimeout(() => {
      generateCeiling.current = null;
      setGeneratePending(false);
      setRefusal('Question generation did not resolve in time.');
    }, TIMERS['T-CMD-RESOLVE']);

    void client.generateNow().catch((error: unknown) => {
      if (generateCeiling.current !== null) clearTimeout(generateCeiling.current);
      generateCeiling.current = null;
      setGeneratePending(false);
      setRefusal(refusalMessage(error, 'Could not generate questions.'));
    });
  }, [client, generatePending]);

  const setIntervalMinutes = useCallback((minutes: IntervalMinutes) => {
    if (intervalPending) return;
    setRefusal(null);
    setIntervalPending(true);
    if (intervalCeiling.current !== null) clearTimeout(intervalCeiling.current);
    intervalCeiling.current = setTimeout(() => {
      intervalCeiling.current = null;
      setIntervalPending(false);
      setRefusal('The interval change did not resolve in time.');
    }, TIMERS['T-CMD-RESOLVE']);

    void client.setAiInterval({ intervalMinutes: minutes }).catch((error: unknown) => {
      if (intervalCeiling.current !== null) clearTimeout(intervalCeiling.current);
      intervalCeiling.current = null;
      setIntervalPending(false);
      setRefusal(refusalMessage(error, 'Could not change the interval.'));
    });
  }, [client, intervalPending]);

  return {
    loading,
    stale,
    state,
    remainingMs: countdown?.remainingMs ?? null,
    nextAt: countdown?.nextAt ?? null,
    intervalMinutes: countdown?.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES,
    draftCount,
    setReady: wsSet?.state === 'ready',
    setFailed: wsSet?.state === 'failed',
    setErrorReason: wsSet?.state === 'failed' ? wsSet.error : null,
    generatePending,
    intervalPending,
    refusal,
    generateNow,
    setInterval: setIntervalMinutes,
  };
}
