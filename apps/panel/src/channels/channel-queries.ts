import { useQuery } from '@tanstack/react-query';
import type { ChannelConfig, ChannelId, ChannelStatus, LayoutPreset, SourceRoleId } from '@eduscope/shared';
import { useClient } from '../client/client-provider.js';
import { useChannelStatus, useWsShallow } from '../store/selectors.js';

/** Reused everywhere a channel/preset REST row is read — S-05's rows already use these keys. */
export const CHANNEL_QUERY_KEYS = {
  snapshots: ['channels'] as const,
  presets: ['layout-presets'] as const,
  sourceRoles: ['source-roles'] as const,
  sourceStatus: ['source-status'] as const,
};

export interface ChannelPresetOption {
  readonly preset: LayoutPreset;
  /** true when a `requiredRoles` entry reports `unbound` (G-CHANNEL-VALID, INV-LP-1). */
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
 * `sources.status`'s `unbound` health state carries exactly INV-SB-3's
 * binding-validity fact and, unlike `/sources/bindings` (x-required-role
 * admin), is reachable by both roles — S-26/S-08 are lecturer screens too.
 * An offline-but-bound role reports `offline`/`degraded`/`unknown`, never
 * `unbound`, so this does not conflate live health with binding validity.
 */
function unboundReason(
  preset: LayoutPreset,
  roles: readonly { readonly id: string; readonly displayLabel: string }[],
  statusByRole: ReadonlyMap<string, { readonly state: string }>,
): string | null {
  for (const roleId of preset.requiredRoles) {
    if (statusByRole.get(roleId)?.state === 'unbound') {
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
  const sourceStatusQuery = useQuery({
    queryKey: CHANNEL_QUERY_KEYS.sourceStatus,
    queryFn: () => client.getSourcesStatus(),
  });
  const liveStatus = useChannelStatus(channelId);
  const liveSources = useWsShallow((s) => s.sources);

  const snapshot = snapshotsQuery.data?.find((row) => row.config.channelId === channelId);
  const config = snapshot?.config;
  const status = liveStatus ?? snapshot?.status;

  const statusByRole = new Map<string, { readonly state: string }>();
  for (const row of sourceStatusQuery.data ?? []) statusByRole.set(row.roleId, row);
  for (const [roleId, row] of Object.entries(liveSources)) {
    if (row) statusByRole.set(roleId as SourceRoleId, row);
  }

  const options: ChannelPresetOption[] = (presetsQuery.data ?? [])
    .filter((preset) => preset.allowedChannels.includes(channelId))
    .map((preset) => {
      const reason = unboundReason(preset, rolesQuery.data ?? [], statusByRole);
      return { preset, disabled: reason !== null, reason };
    });

  const loading = !snapshotsQuery.data || !presetsQuery.data || !rolesQuery.data || !sourceStatusQuery.data;

  return { config, status, options, loading };
}
