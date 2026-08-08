import { useCallback, useState } from 'react';
import type { ChannelConfig, LayoutPreset, LayoutPresetId, Problem } from '@eduscope/shared';
import { useChannelCatalog, type ChannelPresetOption } from '../../channels/channel-queries.js';
import { useChannelConfig, type ChannelConfigPhase } from '../../channels/use-channel-config.js';
import { useIsStale } from '../../store/selectors.js';

export const LOCAL_CAPTURE_STALE_REASON = "Not connected — you can't change this right now.";

export interface UseLocalCaptureLayout {
  readonly loading: boolean;
  readonly config: ChannelConfig | undefined;
  readonly options: readonly ChannelPresetOption[];
  readonly selectedPreset: LayoutPreset | undefined;
  readonly phase: ChannelConfigPhase;
  readonly problem: Problem | null;
  readonly pendingPresetId: LayoutPresetId | null;
  readonly stale: boolean;
  select(presetId: LayoutPresetId): void;
}

/** Selects `local`, exposes its five LP-7 presets, and delegates saves to the shared `useChannelConfig` mutation. */
export function useLocalCaptureLayout(): UseLocalCaptureLayout {
  const catalog = useChannelCatalog('local');
  const configMutation = useChannelConfig('local');
  const stale = useIsStale();
  const [pendingPresetId, setPendingPresetId] = useState<LayoutPresetId | null>(null);

  const select = useCallback((presetId: LayoutPresetId) => {
    if (stale || configMutation.phase === 'saving') return;
    setPendingPresetId(presetId);
    configMutation.save({ presetId });
  }, [configMutation, stale]);

  const options: ChannelPresetOption[] = stale
    ? catalog.options.map((option) => ({ ...option, disabled: true, reason: LOCAL_CAPTURE_STALE_REASON }))
    : catalog.options;

  const selectedPreset = catalog.options.find((o) => o.preset.id === catalog.config?.presetId)?.preset;

  return {
    loading: catalog.loading,
    config: catalog.config,
    options,
    selectedPreset,
    phase: configMutation.phase,
    problem: configMutation.problem,
    pendingPresetId,
    stale,
    select,
  };
}
