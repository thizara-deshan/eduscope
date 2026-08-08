import { act, createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ProblemError } from '@eduscope/api-client';
import { ClientContext } from '../client/client-provider.js';
import { CHANNEL_QUERY_KEYS } from './channel-queries.js';
import { useChannelConfig } from './use-channel-config.js';

const otherRow = {
  config: {
    channelId: 'local', alwaysOn: true, enabledByDefault: true, presetId: 'fifty-fifty',
    ratioA: 50, ratioB: 50, streamTargetIds: null, updatedAt: '2026-01-01T00:00:00.000Z',
  },
  status: { channelId: 'local', state: 'on', presetId: 'fifty-fifty', ratioA: 50, ratioB: 50, reason: null },
};
const meetingRow = {
  config: {
    channelId: 'meeting', alwaysOn: false, enabledByDefault: false, presetId: 'cams-fifty-fifty',
    ratioA: 50, ratioB: 50, streamTargetIds: null, updatedAt: '2026-01-01T00:00:00.000Z',
  },
  status: { channelId: 'meeting', state: 'off', presetId: 'cams-fifty-fifty', ratioA: 50, ratioB: 50, reason: null },
};

function build(updateChannelConfig: (...args: never[]) => Promise<unknown>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(CHANNEL_QUERY_KEYS.snapshots, [otherRow, meetingRow]);
  const client = { updateChannelConfig } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(ClientContext.Provider, { value: client }, children),
  );
  const hook = renderHook(() => useChannelConfig('meeting'), { wrapper });
  return { ...hook, queryClient };
}

describe('useChannelConfig', () => {
  it('replaces only the matching row config in the channels cache on success', async () => {
    const savedConfig = { ...meetingRow.config, presetId: 'cam-1' };
    const { result, queryClient } = build(vi.fn(() => Promise.resolve(savedConfig)));
    act(() => result.current.save({ presetId: 'cam-1' }));
    await waitFor(() => expect(result.current.phase).toBe('applied'));

    const rows = queryClient.getQueryData<typeof otherRow[]>(CHANNEL_QUERY_KEYS.snapshots)!;
    expect(rows.find((r) => r.config.channelId === 'meeting')!.config.presetId).toBe('cam-1');
    expect(rows.find((r) => r.config.channelId === 'meeting')!.status).toBe(meetingRow.status);
    expect(rows.find((r) => r.config.channelId === 'local')).toBe(otherRow);
  });

  it('moves to refused with the named Problem on a 422', async () => {
    const problem = { status: 422, code: 'config.invalid' as const, title: 'This layout could not be applied.' };
    const { result } = build(vi.fn(() => Promise.reject(new ProblemError(problem))));
    act(() => result.current.save({ presetId: 'cam-1' }));
    await waitFor(() => expect(result.current.phase).toBe('refused'));
    expect(result.current.problem).toEqual(problem);
  });

  it('reset returns to idle', async () => {
    const problem = { status: 422, code: 'config.invalid' as const, title: 'nope' };
    const { result } = build(vi.fn(() => Promise.reject(new ProblemError(problem))));
    act(() => result.current.save({ presetId: 'cam-1' }));
    await waitFor(() => expect(result.current.phase).toBe('refused'));
    act(() => result.current.reset());
    expect(result.current.phase).toBe('idle');
    expect(result.current.problem).toBeNull();
  });
});
