import { act, createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ClientContext } from '../../client/client-provider.js';
import { useWsStore } from '../../store/ws-store.js';
import { useMeetingChannel } from './use-meeting-channel.js';

const meetingConfig = {
  channelId: 'meeting', alwaysOn: false, enabledByDefault: false, presetId: 'cams-fifty-fifty',
  ratioA: 50, ratioB: 50, streamTargetIds: null, updatedAt: '2026-01-01T00:00:00.000Z',
};
const snapshots = [
  { config: meetingConfig, status: { channelId: 'meeting', state: 'off', presetId: 'cams-fifty-fifty', ratioA: 50, ratioB: 50, reason: null } },
];
const presets = [
  {
    id: 'cams-fifty-fifty', displayName: 'Both cameras', description: 'desc', allowedChannels: ['meeting'],
    kind: 'composite', canvas: { width: 1920, height: 1080 }, tiles: [], parametric: true,
    outputs: [], passthroughEligible: false, requiredRoles: ['lecturer-cam', 'students-cam'],
  },
];
const roles = [
  { id: 'lecturer-cam', medium: 'video', displayLabel: 'Lecturer Camera', requiredForStart: true, provisionable: true },
  { id: 'students-cam', medium: 'video', displayLabel: 'Students Camera', requiredForStart: false, provisionable: true },
];
const sourceStatus = [
  { roleId: 'lecturer-cam', state: 'online', detail: null, since: '2026-01-01T00:00:00.000Z', inputId: null },
  { roleId: 'students-cam', state: 'online', detail: null, since: '2026-01-01T00:00:00.000Z', inputId: null },
];

function build(client: Partial<EduscopeClient> = {}) {
  useWsStore.getState().reset();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const stub = {
    listChannels: vi.fn(() => Promise.resolve(snapshots)),
    listLayoutPresets: vi.fn(() => Promise.resolve(presets)),
    listSourceRoles: vi.fn(() => Promise.resolve(roles)),
    getSourcesStatus: vi.fn(() => Promise.resolve(sourceStatus)),
    ...client,
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(ClientContext.Provider, { value: stub }, children),
  );
  return renderHook(() => useMeetingChannel(), { wrapper });
}

describe('useMeetingChannel', () => {
  it('toggle requests enable when off', async () => {
    const enableChannel = vi.fn(() => Promise.resolve({ resolveBySec: 10 }));
    const { result } = build({ enableChannel: enableChannel as never });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.toggle());
    await waitFor(() => expect(enableChannel).toHaveBeenCalledWith('meeting'));
  });

  it('toggle requests disable when on', async () => {
    const disableChannel = vi.fn(() => Promise.resolve({ resolveBySec: 10 }));
    const { result } = build({ disableChannel: disableChannel as never });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => useWsStore.setState({
      channels: { meeting: { channelId: 'meeting', state: 'on', presetId: 'cams-fifty-fifty', ratioA: 50, ratioB: 50, reason: null } },
    } as never));
    act(() => result.current.toggle());
    await waitFor(() => expect(disableChannel).toHaveBeenCalledWith('meeting'));
  });

  it('selectPreset delegates to the shared config mutation and tracks the tapped id', async () => {
    const update = vi.fn(() => Promise.resolve({ ...meetingConfig, presetId: 'cams-fifty-fifty' }));
    const { result } = build({ updateChannelConfig: update as never });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.selectPreset('cams-fifty-fifty'));
    expect(result.current.pendingPresetId).toBe('cams-fifty-fifty');
    await waitFor(() => expect(update).toHaveBeenCalledWith('meeting', { presetId: 'cams-fifty-fifty' }));
  });
});
