import { useCallback, useState } from 'react';
import type { ChannelConfig, ChannelStatus, LayoutPresetId, Problem } from '@eduscope/shared';
import { useChannelCatalog, type ChannelPresetOption } from '../../channels/channel-queries.js';
import { useChannelConfig, type ChannelConfigPhase } from '../../channels/use-channel-config.js';
import {
  useChannelRuntimeCommand, type ChannelCommandProblem,
} from '../../channels/use-channel-runtime-command.js';

export interface UseMeetingChannel {
  readonly loading: boolean;
  readonly config: ChannelConfig | undefined;
  readonly status: ChannelStatus | undefined;
  readonly options: readonly ChannelPresetOption[];
  readonly togglePending: boolean;
  readonly toggleProblem: ChannelCommandProblem | null;
  readonly presetPhase: ChannelConfigPhase;
  readonly presetProblem: Problem | null;
  readonly pendingPresetId: LayoutPresetId | null;
  toggle(): void;
  selectPreset(presetId: LayoutPresetId): void;
}

/**
 * S-08's live command/preset state, hard-bound to `meeting`. Contract C-4:
 * enable/disable is only valid during an active session, exactly when this
 * card is visible — no idle/default branch (unlike S-27's streaming toggle).
 */
export function useMeetingChannel(): UseMeetingChannel {
  const catalog = useChannelCatalog('meeting');
  const runtime = useChannelRuntimeCommand('meeting');
  const configMutation = useChannelConfig('meeting');
  const [pendingPresetId, setPendingPresetId] = useState<LayoutPresetId | null>(null);

  const toggle = useCallback(() => {
    // CH-04 is only legal from `off` — a `failed` consumer must be
    // acknowledged with disable (CH-10), not re-enabled directly, or the
    // command never reaches a legal transition and the switch sticks on
    // its failure reason forever.
    runtime.requestEnabled(catalog.status?.state === 'off');
  }, [catalog.status?.state, runtime]);

  const selectPreset = useCallback((presetId: LayoutPresetId) => {
    setPendingPresetId(presetId);
    configMutation.save({ presetId });
  }, [configMutation]);

  return {
    loading: catalog.loading,
    config: catalog.config,
    status: catalog.status,
    options: catalog.options,
    togglePending: runtime.pending,
    toggleProblem: runtime.problem,
    presetPhase: configMutation.phase,
    presetProblem: configMutation.problem,
    pendingPresetId,
    toggle,
    selectPreset,
  };
}
