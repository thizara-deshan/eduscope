import { act, createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ProblemError } from '@eduscope/api-client';
import { ClientContext } from '../../client/client-provider.js';
import { useWsStore } from '../../store/ws-store.js';
import { useLocalCaptureLayout } from './use-local-capture-layout.js';

const localConfig = {
  channelId: 'local', alwaysOn: true, enabledByDefault: true, presetId: 'fifty-fifty',
  ratioA: 50, ratioB: 50, streamTargetIds: null, updatedAt: '2026-01-01T00:00:00.000Z',
};
const snapshots = [{ config: localConfig, status: { channelId: 'local', state: 'on', presetId: 'fifty-fifty', ratioA: 50, ratioB: 50, reason: null } }];

const presets = [
  {
    id: 'fifty-fifty', displayName: 'Slides + lecturer', description: 'desc', allowedChannels: ['local'],
    kind: 'composite', canvas: { width: 1920, height: 1080 }, tiles: [], parametric: true,
    outputs: [], passthroughEligible: false, requiredRoles: ['presentation', 'lecturer-cam'],
  },
  {
    id: 'cam-1', displayName: 'Lecturer only', description: 'desc', allowedChannels: ['local', 'meeting', 'streaming'],
    kind: 'single', canvas: { width: 1920, height: 1080 }, tiles: [], parametric: false,
    outputs: [], passthroughEligible: true, requiredRoles: ['lecturer-cam'],
  },
];
const roles = [
  { id: 'presentation', medium: 'video', displayLabel: 'Presentation', requiredForStart: true, provisionable: true },
  { id: 'lecturer-cam', medium: 'video', displayLabel: 'Lecturer Camera', requiredForStart: true, provisionable: true },
];
const bindings = [
  { roleId: 'presentation', physicalInputId: 'IN1', enabled: true, updatedAt: '2026-01-01T00:00:00.000Z' },
  { roleId: 'lecturer-cam', physicalInputId: 'IN2', enabled: true, updatedAt: '2026-01-01T00:00:00.000Z' },
];

function build(updateChannelConfig: (...args: never[]) => Promise<unknown>) {
  useWsStore.getState().reset();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = {
    listChannels: vi.fn(() => Promise.resolve(snapshots)),
    listLayoutPresets: vi.fn(() => Promise.resolve(presets)),
    listSourceRoles: vi.fn(() => Promise.resolve(roles)),
    listSourceBindings: vi.fn(() => Promise.resolve(bindings)),
    updateChannelConfig,
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(ClientContext.Provider, { value: client }, children),
  );
  return renderHook(() => useLocalCaptureLayout(), { wrapper });
}

describe('useLocalCaptureLayout', () => {
  it('selects local and exposes its filtered options', async () => {
    const { result } = build(vi.fn());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.config?.channelId).toBe('local');
    expect(result.current.options.map((o) => o.preset.id).sort()).toEqual(['cam-1', 'fifty-fifty']);
    expect(result.current.selectedPreset?.id).toBe('fifty-fifty');
  });

  it('delegates a selection to updateChannelConfig with only presetId', async () => {
    const update = vi.fn(() => Promise.resolve({ ...localConfig, presetId: 'cam-1' }));
    const { result } = build(update);
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.select('cam-1'));
    await waitFor(() => expect(update).toHaveBeenCalledWith('local', { presetId: 'cam-1' }));
    await waitFor(() => expect(result.current.phase).toBe('applied'));
  });

  it('surfaces a refused save as the named Problem', async () => {
    const problem = { status: 422, code: 'config.invalid' as const, title: 'This layout could not be applied.' };
    const { result } = build(vi.fn(() => Promise.reject(new ProblemError(problem))));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.select('cam-1'));
    await waitFor(() => expect(result.current.phase).toBe('refused'));
    expect(result.current.problem).toEqual(problem);
  });

  it('marks every option disabled with a stale reason while WS is stale', async () => {
    const { result } = build(vi.fn());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => useWsStore.setState({ stale: true }));
    expect(result.current.options.every((o) => o.disabled)).toBe(true);
    expect(result.current.stale).toBe(true);
  });

  it('refuses to select while stale', async () => {
    const update = vi.fn();
    const { result } = build(update);
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => useWsStore.setState({ stale: true }));
    act(() => result.current.select('cam-1'));
    expect(update).not.toHaveBeenCalled();
  });
});
