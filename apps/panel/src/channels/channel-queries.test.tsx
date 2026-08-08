import { createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ClientContext } from '../client/client-provider.js';
import { useWsStore } from '../store/ws-store.js';
import { useChannelCatalog } from './channel-queries.js';

const snapshots = [
  {
    config: {
      channelId: 'meeting', alwaysOn: false, enabledByDefault: false, presetId: 'cams-fifty-fifty',
      ratioA: 50, ratioB: 50, streamTargetIds: null, updatedAt: '2026-01-01T00:00:00.000Z',
    },
    status: { channelId: 'meeting', state: 'off', presetId: 'cams-fifty-fifty', ratioA: 50, ratioB: 50, reason: null },
  },
];

const presets = [
  {
    id: 'cams-fifty-fifty', displayName: 'Both cameras', description: 'desc', allowedChannels: ['meeting'],
    kind: 'composite', canvas: { width: 1920, height: 1080 }, tiles: [], parametric: true,
    outputs: [], passthroughEligible: false, requiredRoles: ['lecturer-cam', 'students-cam'],
  },
  {
    id: 'cam-1', displayName: 'Lecturer only', description: 'desc', allowedChannels: ['local', 'meeting', 'streaming'],
    kind: 'single', canvas: { width: 1920, height: 1080 }, tiles: [], parametric: false,
    outputs: [], passthroughEligible: true, requiredRoles: ['lecturer-cam'],
  },
  {
    id: 'pc-only', displayName: 'Slides only', description: 'desc', allowedChannels: ['streaming'],
    kind: 'single', canvas: { width: 1920, height: 1080 }, tiles: [], parametric: false,
    outputs: [], passthroughEligible: true, requiredRoles: ['presentation'],
  },
];

const roles = [
  { id: 'lecturer-cam', medium: 'video', displayLabel: 'Lecturer Camera', requiredForStart: true, provisionable: true },
  { id: 'students-cam', medium: 'video', displayLabel: 'Students Camera', requiredForStart: false, provisionable: true },
];

function bindings(studentsCamBound: boolean) {
  return [
    { roleId: 'lecturer-cam', physicalInputId: 'INPUT1', enabled: true, updatedAt: '2026-01-01T00:00:00.000Z' },
    { roleId: 'students-cam', physicalInputId: studentsCamBound ? 'INPUT2' : null, enabled: studentsCamBound, updatedAt: '2026-01-01T00:00:00.000Z' },
  ];
}

function renderCatalog(studentsCamBound: boolean, sourceStatus: 'online' | 'offline' = 'online') {
  useWsStore.getState().reset();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = {
    listChannels: vi.fn(() => Promise.resolve(snapshots)),
    listLayoutPresets: vi.fn(() => Promise.resolve(presets)),
    listSourceRoles: vi.fn(() => Promise.resolve(roles)),
    listSourceBindings: vi.fn(() => Promise.resolve(bindings(studentsCamBound))),
  } as unknown as EduscopeClient;
  useWsStore.setState({
    sources: {
      'students-cam': { roleId: 'students-cam', state: sourceStatus, detail: null, since: '2026-01-01T00:00:00.000Z', inputId: null },
    } as never,
  });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(ClientContext.Provider, { value: client }, children),
  );
  return renderHook(() => useChannelCatalog('meeting'), { wrapper });
}

describe('useChannelCatalog', () => {
  it('filters the full /layouts response down to allowedChannels for this channel', async () => {
    const { result } = renderCatalog(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.options.map((o) => o.preset.id).sort()).toEqual(['cam-1', 'cams-fifty-fifty']);
    expect(result.current.options.some((o) => o.preset.id === 'pc-only')).toBe(false);
  });

  it('keeps an unbound-required-role preset visible but disabled with a named reason', async () => {
    const { result } = renderCatalog(false);
    await waitFor(() => expect(result.current.loading).toBe(false));
    const option = result.current.options.find((o) => o.preset.id === 'cams-fifty-fifty')!;
    expect(option.disabled).toBe(true);
    expect(option.reason).toBe('Needs Students Camera, which is not connected.');
  });

  it('does not treat an offline-but-bound role as unbound', async () => {
    const { result } = renderCatalog(true, 'offline');
    await waitFor(() => expect(result.current.loading).toBe(false));
    const option = result.current.options.find((o) => o.preset.id === 'cams-fifty-fifty')!;
    expect(option.disabled).toBe(false);
    expect(option.reason).toBeNull();
  });

  it('reads config from REST and status from the live WS row', async () => {
    useWsStore.getState().reset();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const client = {
      listChannels: vi.fn(() => Promise.resolve(snapshots)),
      listLayoutPresets: vi.fn(() => Promise.resolve(presets)),
      listSourceRoles: vi.fn(() => Promise.resolve(roles)),
      listSourceBindings: vi.fn(() => Promise.resolve(bindings(true))),
    } as unknown as EduscopeClient;
    useWsStore.setState({ channels: { meeting: { channelId: 'meeting', state: 'on', presetId: 'cam-1', ratioA: null, ratioB: null, reason: null } } as never });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(ClientContext.Provider, { value: client }, children),
    );
    const { result } = renderHook(() => useChannelCatalog('meeting'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.status?.state).toBe('on');
    expect(result.current.config?.channelId).toBe('meeting');
  });
});
