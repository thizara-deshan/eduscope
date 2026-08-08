import { act, createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ClientContext } from '../../client/client-provider.js';
import { useWsStore } from '../../store/ws-store.js';
import { useStreamingChannel } from './use-streaming-channel.js';

const streamingConfig = {
  channelId: 'streaming', alwaysOn: false, enabledByDefault: false, presetId: 'fifty-fifty',
  ratioA: 50, ratioB: 50, streamTargetIds: ['TARGET1'], updatedAt: '2026-01-01T00:00:00.000Z',
};
const snapshots = [
  { config: streamingConfig, status: { channelId: 'streaming', state: 'off', presetId: 'fifty-fifty', ratioA: 50, ratioB: 50, reason: null } },
];
const presets = [
  {
    id: 'fifty-fifty', displayName: 'Slides + camera', description: 'desc', allowedChannels: ['streaming'],
    kind: 'composite', canvas: { width: 1920, height: 1080 }, tiles: [], parametric: true,
    outputs: [], passthroughEligible: false, requiredRoles: ['presentation', 'lecturer-cam'],
  },
];
const roles = [
  { id: 'presentation', medium: 'video', displayLabel: 'Presentation', requiredForStart: true, provisionable: true },
  { id: 'lecturer-cam', medium: 'video', displayLabel: 'Lecturer Camera', requiredForStart: true, provisionable: true },
];
const sourceStatus = [
  { roleId: 'presentation', state: 'online', detail: null, since: '2026-01-01T00:00:00.000Z', inputId: null },
  { roleId: 'lecturer-cam', state: 'online', detail: null, since: '2026-01-01T00:00:00.000Z', inputId: null },
];

function build(client: Partial<EduscopeClient> = {}, recordingState: 'idle' | 'recording' | 'paused' = 'idle') {
  useWsStore.getState().reset();
  useWsStore.setState({ recording: { state: recordingState } as never });
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
  return renderHook(() => useStreamingChannel(), { wrapper });
}

describe('useStreamingChannel — idle vs live toggle semantics (contract C-4)', () => {
  it('idle: label reads "Stream on next recording", checked follows enabledByDefault, click writes only updateChannelConfig', async () => {
    const update = vi.fn(() => Promise.resolve({ ...streamingConfig, enabledByDefault: true }));
    const enableChannel = vi.fn();
    const { result } = build({ updateChannelConfig: update as never, enableChannel: enableChannel as never }, 'idle');
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.mode).toBe('idle');
    expect(result.current.toggleLabel).toBe('Stream on next recording');
    expect(result.current.checked).toBe(false);
    act(() => result.current.toggle());
    await waitFor(() => expect(update).toHaveBeenCalledWith('streaming', { enabledByDefault: true }));
    expect(enableChannel).not.toHaveBeenCalled();
  });

  it('live: label reads "Start streaming now"/"Stop streaming now", checked follows WS, click writes only enable/disableChannel', async () => {
    const enableChannel = vi.fn(() => Promise.resolve({ resolveBySec: 10 }));
    const update = vi.fn();
    const { result } = build({ enableChannel: enableChannel as never, updateChannelConfig: update as never }, 'recording');
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.mode).toBe('live');
    expect(result.current.toggleLabel).toBe('Start streaming now');
    act(() => result.current.toggle());
    await waitFor(() => expect(enableChannel).toHaveBeenCalledWith('streaming'));
    expect(update).not.toHaveBeenCalled();
  });

  it('live on: label reads Stop streaming now', async () => {
    const { result } = build({}, 'recording');
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => useWsStore.setState({
      channels: { streaming: { channelId: 'streaming', state: 'on', presetId: 'fifty-fifty', ratioA: 50, ratioB: 50, reason: null } },
    } as never));
    expect(result.current.toggleLabel).toBe('Stop streaming now');
    expect(result.current.checked).toBe(true);
  });

  it('disables the toggle while a live channel is in a transient state', async () => {
    const { result } = build({}, 'recording');
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => useWsStore.setState({
      channels: { streaming: { channelId: 'streaming', state: 'preflight', presetId: 'fifty-fifty', ratioA: 50, ratioB: 50, reason: null } },
    } as never));
    expect(result.current.toggleDisabled).toBe(true);
  });
});
