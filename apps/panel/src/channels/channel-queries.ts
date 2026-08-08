import { useQuery } from '@tanstack/react-query';
import type { ChannelConfig, ChannelId, ChannelStatus, LayoutPreset } from '@eduscope/shared';
import { useClient } from '../client/client-provider.js';
import { useChannelStatus } from '../store/selectors.js';

/** Reused everywhere a channel/preset REST row is read — S-05's rows already use these keys. */
export const CHANNEL_QUERY_KEYS = {
  snapshots: ['channels'] as const,
  presets: ['layout-presets'] as const,
  sourceRoles: ['source-roles'] as const,
  sourceBindings: ['source-bindings'] as const,
};

export interface ChannelPresetOption {
  readonly preset: LayoutPreset;
  /** true when a `requiredRoles` entry has no enabled binding (G-CHANNEL-VALID, INV-LP-1). */
  readonly disabled: boolean;
  readonly reason: string | null;
}

export interface UseChannelCatalog {
  readonly config: ChannelConfig | undefined;
  readonly status: ChannelStatus | undefined;
  /** Pre-filtered to this channel's `allowedChannels` (LP-7) — never the full `/layouts` response. */
  readonly options: ChannelPresetOption[];
  readonly loading: boolean;
}

/**
 * Binding presence only (INV-SB-3) — an offline-but-bound role is not
 * "unbound"; live source health is a separate concern this reason ignores.
 */
function unboundReason(
  preset: LayoutPreset,
  roles: readonly { readonly id: string; readonly displayLabel: string }[],
  bindings: readonly { readonly roleId: string; readonly enabled: boolean; readonly physicalInputId: string | null }[],
): string | null {
  for (const roleId of preset.requiredRoles) {
    const binding = bindings.find((b) => b.roleId === roleId);
    if (!binding || !binding.enabled || !binding.physicalInputId) {
      const label = roles.find((r) => r.id === roleId)?.displayLabel ?? roleId;
      return `Needs ${label}, which is not connected.`;
    }
  }
  return null;
}

/** Shared REST/WS read for S-08/S-26/S-27 — snapshot config is REST truth, live status is WS truth over the cold snapshot fallback. */
export function useChannelCatalog(channelId: ChannelId): UseChannelCatalog {
  const client = useClient();
  const snapshotsQuery = useQuery({ queryKey: CHANNEL_QUERY_KEYS.snapshots, queryFn: () => client.listChannels() });
  const presetsQuery = useQuery({ queryKey: CHANNEL_QUERY_KEYS.presets, queryFn: () => client.listLayoutPresets() });
  const rolesQuery = useQuery({ queryKey: CHANNEL_QUERY_KEYS.sourceRoles, queryFn: () => client.listSourceRoles() });
  const bindingsQuery = useQuery({
    queryKey: CHANNEL_QUERY_KEYS.sourceBindings,
    queryFn: () => client.listSourceBindings(),
  });
  const liveStatus = useChannelStatus(channelId);

  const snapshot = snapshotsQuery.data?.find((row) => row.config.channelId === channelId);
  const config = snapshot?.config;
  const status = liveStatus ?? snapshot?.status;

  const options: ChannelPresetOption[] = (presetsQuery.data ?? [])
    .filter((preset) => preset.allowedChannels.includes(channelId))
    .map((preset) => {
      const reason = unboundReason(preset, rolesQuery.data ?? [], bindingsQuery.data ?? []);
      return { preset, disabled: reason !== null, reason };
    });

  const loading = !snapshotsQuery.data || !presetsQuery.data || !rolesQuery.data || !bindingsQuery.data;

  return { config, status, options, loading };
}
