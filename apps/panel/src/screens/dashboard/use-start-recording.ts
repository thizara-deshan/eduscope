import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ProblemError, TransportError } from '@eduscope/api-client';
import { TIMERS, type Problem, type StorageStatusPayload } from '@eduscope/shared';
import { useClient } from '../../client/client-provider.js';
import { useIsStale, useRecordingSession, useStorageStatus } from '../../store/selectors.js';

/** screen-inventory §2 S-04's States list, as a discriminated union. */
export type StartState =
  | { readonly kind: 'ready' }
  | { readonly kind: 'holding'; readonly reason: 'cold' | 'recovery' }
  | { readonly kind: 'starting' }
  | { readonly kind: 'refused'; readonly problem: Problem }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'offline' };

export interface UseStartRecording {
  readonly state: StartState;
  start(): void;
  dismiss(): void;
}

function checkedProblem(problem: Problem): Problem {
  switch (problem.code) {
    case 'auth.invalid-credentials':
    case 'auth.account-disabled':
    case 'auth.session-revoked':
    case 'auth.password-reset-required':
    case 'not-authorized':
    case 'not-found':
    case 'validation.invalid':
    case 'conflict':
    case 'recorder.busy':
    case 'storage.critical':
    case 'provisioning.incomplete':
    case 'volume.unavailable':
    case 'config.invalid':
    case 'session.not-active':
    case 'question.immutable':
    case 'quiz.unavailable':
    case 'ai.unavailable':
    case 'poweroff.refused':
    case 'format.refused':
    case 'export.invalid-target':
    case 'export.insufficient-space':
    case 'upload.not-requeueable':
    case 'import.rejected':
      return problem;
    default: {
      const exhaustive: never = problem.code;
      return exhaustive;
    }
  }
}

function criticalStorageProblem(storage: StorageStatusPayload): Problem {
  const threshold = storage.policy.criticalThresholdPct;
  return {
    status: 409,
    code: 'storage.critical',
    title: 'Not enough free space to start a recording',
    detail: `Storage has reached the policy's ${threshold}% critical threshold. Free space must be restored before a new recording can start.`,
  };
}

export function useStartRecording(): UseStartRecording {
  const client = useClient();
  const session = useRecordingSession();
  const liveStorage = useStorageStatus();
  const stale = useIsStale();
  const [local, setLocal] = useState<StartState>({ kind: 'ready' });
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storageQuery = useQuery({
    queryKey: ['storage-overview'],
    queryFn: () => client.getStorageOverview(),
  });
  const storage = liveStorage ?? storageQuery.data;
  const storageBlocksStart = storage?.pressure === 'critical'
    && storage.policy.refuseStartWhenCritical;

  const clearCeiling = useCallback(() => {
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }, []);

  useEffect(() => clearCeiling, [clearCeiling]);

  useEffect(() => {
    if (local.kind !== 'starting' || !session) return;
    if (session.state === 'recording') {
      clearCeiling();
      setLocal({ kind: 'ready' });
    } else if (session.state === 'error') {
      clearCeiling();
      setLocal({
        kind: 'failed',
        message: session.errorMessage ?? 'The recording did not start.',
      });
    }
  }, [clearCeiling, local.kind, session]);

  const recoveryPending = session?.state === 'starting' && session.startReason === 'recovery';
  const initialStartPending = session?.state === 'starting' && session.startReason === 'initial';
  const state: StartState = stale
    ? { kind: 'offline' }
    : session === null
      ? { kind: 'holding', reason: 'cold' }
      : recoveryPending
        ? { kind: 'holding', reason: 'recovery' }
        : initialStartPending
          ? { kind: 'starting' }
          : storageBlocksStart && storage
            ? { kind: 'refused', problem: criticalStorageProblem(storage) }
            : local;

  const start = useCallback(() => {
    if (stale || session === null || recoveryPending || initialStartPending
      || storageBlocksStart || local.kind === 'starting') return;
    clearCeiling();
    setLocal({ kind: 'starting' });
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      setLocal({ kind: 'failed', message: 'The recording did not start in time.' });
    }, TIMERS['T-START-CONFIRM']);

    void client.startRecording().catch((error: unknown) => {
      clearCeiling();
      if (error instanceof ProblemError) {
        const problem = checkedProblem(error.problem);
        setLocal(problem.code === 'recorder.busy'
          ? { kind: 'ready' }
          : { kind: 'refused', problem });
      } else if (error instanceof TransportError) {
        setLocal({ kind: 'failed', message: error.message });
      } else {
        setLocal({
          kind: 'failed',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }, [clearCeiling, client, initialStartPending, local.kind, recoveryPending, session, stale, storageBlocksStart]);

  const dismiss = useCallback(() => {
    clearCeiling();
    setLocal({ kind: 'ready' });
  }, [clearCeiling]);

  return { state, start, dismiss };
}
