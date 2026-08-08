import { useCallback, useState } from 'react';
import type { ChannelConfig, ChannelStatus, LayoutPresetId, Problem } from '@eduscope/shared';
import { useChannelCatalog, type ChannelPresetOption } from '../../channels/channel-queries.js';
import { useChannelConfig, type ChannelConfigPhase } from '../../channels/use-channel-config.js';
import {
  useChannelRuntimeCommand, type ChannelCommandProblem,
} from '../../channels/use-channel-runtime-command.js';
import { useIsStale, useRecordingState } from '../../store/selectors.js';

const TRANSIENT_LIVE_STATES = new Set(['preflight', 'starting', 'stopping']);

export interface UseStreamingChannel {
  readonly loading: boolean;
  readonly config: ChannelConfig | undefined;
  readonly status: ChannelStatus | undefined;
  readonly options: readonly ChannelPresetOption[];
  /** contract C-4: idle writes `enabledByDefault`; a live session uses real channel commands. */
  readonly mode: 'idle' | 'live';
  readonly checked: boolean;
  readonly toggleLabel: string;
  readonly toggleDisabled: boolean;
  readonly togglePending: boolean;
  readonly toggleProblem: ChannelCommandProblem | Problem | null;
  readonly presetPhase: ChannelConfigPhase;
  readonly presetProblem: Problem | null;
  readonly pendingPresetId: LayoutPresetId | null;
  toggle(): void;
  selectPreset(presetId: LayoutPresetId): void;
}

/**
 * Idle uses `enabledByDefault` + `updateChannelConfig`; a live session uses
 * 202 channel commands and WS status. Two labels, two actions behind one
 * control (contract C-4) — the idle-toggle and preset writes each get their
 * own `useChannelConfig` instance so one save's phase/problem never leaks
 * into the other's UI.
 */
export function useStreamingChannel(): UseStreamingChannel {
  const catalog = useChannelCatalog('streaming');
  const recordingState = useRecordingState();
  const stale = useIsStale();
  const runtime = useChannelRuntimeCommand('streaming');
  const idleToggleMutation = useChannelConfig('streaming');
  const presetMutation = useChannelConfig('streaming');
  const [pendingPresetId, setPendingPresetId] = useState<LayoutPresetId | null>(null);

  const live = recordingState === 'recording' || recordingState === 'paused';
  const checked = live ? catalog.status?.state === 'on' : Boolean(catalog.config?.enabledByDefault);
  const transientLive = live && TRANSIENT_LIVE_STATES.has(catalog.status?.state ?? '');

  const toggle = useCallback(() => {
    if (live) {
      runtime.requestEnabled(catalog.status?.state !== 'on');
    } else {
      idleToggleMutation.save({ enabledByDefault: !catalog.config?.enabledByDefault });
    }
  }, [catalog.config?.enabledByDefault, catalog.status?.state, idleToggleMutation, live, runtime]);

  const selectPreset = useCallback((presetId: LayoutPresetId) => {
    setPendingPresetId(presetId);
    presetMutation.save({ presetId });
  }, [presetMutation]);

  return {
    loading: catalog.loading,
    config: catalog.config,
    status: catalog.status,
    options: catalog.options,
    mode: live ? 'live' : 'idle',
    checked,
    toggleLabel: live
      ? (checked ? 'Stop streaming now' : 'Start streaming now')
      : 'Stream on next recording',
    toggleDisabled: stale || (live ? (runtime.pending || transientLive) : idleToggleMutation.phase === 'saving'),
    togglePending: live ? runtime.pending : idleToggleMutation.phase === 'saving',
    toggleProblem: live ? runtime.problem : idleToggleMutation.problem,
    presetPhase: presetMutation.phase,
    presetProblem: presetMutation.problem,
    pendingPresetId,
    toggle,
    selectPreset,
  };
}
