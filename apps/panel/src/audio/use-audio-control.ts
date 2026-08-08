import { useCallback } from 'react';
import type { AudioControlPayload, SourceRoleId } from '@eduscope/shared';
import { useAuth } from '../auth/auth-context.js';
import { useClient } from '../client/client-provider.js';
import { useRecorderLock } from '../screens/dashboard/use-recorder-lock.js';
import { useAudioControlRow, useIsStale, useSourceStatus } from '../store/selectors.js';

export type AudioApplyState = 'live' | 'muted' | 'pending' | 'apply-failed' | 'offline' | 'locked';

export const AUDIO_LOCKED_REASON =
  'Only the recording owner or an administrator can change audio controls right now.';
export const AUDIO_OFFLINE_REASON = 'No microphone signal.';
export const AUDIO_STALE_REASON = "Not connected — you can't change this right now.";

export interface UseAudioControl {
  readonly control: AudioControlPayload | undefined;
  readonly state: AudioApplyState;
  /** CG-15: non-null when a non-owner is looking at a live session. */
  readonly disabledReason: string | null;
  setMuted(muted: boolean): void;
  setGain(gain: number): void;
}

export function useAudioControl(roleId: SourceRoleId): UseAudioControl {
  const client = useClient();
  const auth = useAuth();
  const lock = useRecorderLock();
  const control = useAudioControlRow(roleId);
  const source = useSourceStatus(roleId);
  const stale = useIsStale();
  const sourceUnavailable = source?.state === 'offline'
    || source?.state === 'unknown'
    || source?.state === 'unbound';
  const authorityLocked = lock.kind === 'locked' && auth.role !== 'admin';
  const disabledReason = stale
    ? AUDIO_STALE_REASON
    : sourceUnavailable
      ? AUDIO_OFFLINE_REASON
      : authorityLocked ? AUDIO_LOCKED_REASON : null;
  const state: AudioApplyState = stale || sourceUnavailable
    ? 'offline'
    : authorityLocked
      ? 'locked'
      : !control || control.appliedState === 'pending'
        ? 'pending'
        : control.appliedState === 'failed'
          ? 'apply-failed'
          : control.muted ? 'muted' : 'live';
  const canIssue = disabledReason === null && control?.appliedState !== 'pending' && control !== undefined;

  const setMuted = useCallback((muted: boolean) => {
    if (!canIssue) return;
    void client.updateAudioControl(roleId, { muted }).catch(() => undefined);
  }, [canIssue, client, roleId]);

  const setGain = useCallback((gain: number) => {
    if (!canIssue) return;
    void client.updateAudioControl(roleId, { gain }).catch(() => undefined);
  }, [canIssue, client, roleId]);

  return { control, state, disabledReason, setMuted, setGain };
}
