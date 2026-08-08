import { act, createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import type { User } from '@eduscope/shared';
import { AuthProvider } from '../../auth/auth-context.js';
import { ClientContext } from '../../client/client-provider.js';
import { useStreamTargets } from './use-stream-targets.js';

const target = {
  id: 'TARGET1', platform: 'youtube' as const, displayName: 'Main', ingestUrl: 'rtmp://x',
  hasStreamKey: true, requiresTlsBridge: false, enabled: true, lastPreflightAt: null, lastPreflightResult: null,
};

function user(role: 'lecturer' | 'admin'): User {
  return {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', username: 'a.perera', displayName: 'A. Perera',
    role, source: 'institute', mustResetPassword: false, disabled: false,
    lastLoginAt: null, createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function build(role: 'lecturer' | 'admin', client: Partial<EduscopeClient> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const stub = {
    listStreamTargets: vi.fn(() => Promise.resolve([target])),
    ...client,
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(ClientContext.Provider, { value: stub },
      createElement(AuthProvider, { initialUser: user(role), children })),
  );
  return { hook: renderHook(() => useStreamTargets(), { wrapper }), client: stub };
}

describe('useStreamTargets', () => {
  it('a lecturer never calls listStreamTargets', () => {
    const { client } = build('lecturer');
    expect(client.listStreamTargets).not.toHaveBeenCalled();
  });

  it('an admin lists targets', async () => {
    const { hook } = build('admin');
    await waitFor(() => expect(hook.result.current.targets).toHaveLength(1));
    expect(hook.result.current.enabled).toBe(true);
  });

  it('create adds the returned row to the cache', async () => {
    const created = { ...target, id: 'TARGET2', displayName: 'New' };
    const createStreamTarget = vi.fn(() => Promise.resolve(created));
    const { hook } = build('admin', { createStreamTarget: createStreamTarget as never });
    await waitFor(() => expect(hook.result.current.targets).toHaveLength(1));
    act(() => hook.result.current.create({ platform: 'youtube', displayName: 'New', ingestUrl: 'rtmp://y', streamKey: 'k' }));
    await waitFor(() => expect(hook.result.current.targets).toHaveLength(2));
    expect(hook.result.current.phase).toBe('applied');
  });

  it('remove drops the row from the cache', async () => {
    const deleteStreamTarget = vi.fn(() => Promise.resolve());
    const { hook } = build('admin', { deleteStreamTarget: deleteStreamTarget as never });
    await waitFor(() => expect(hook.result.current.targets).toHaveLength(1));
    act(() => hook.result.current.remove('TARGET1'));
    await waitFor(() => expect(hook.result.current.targets).toHaveLength(0));
  });
});
