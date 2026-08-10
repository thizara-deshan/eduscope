import { createElement, type ReactNode } from 'react';
import { act } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ClientContext } from '../../../client/client-provider.js';
import { useWsStore } from '../../../store/ws-store.js';
import { useDeviceHealth } from './use-device-health.js';

const health = (overrides: Record<string, unknown> = {}) => ({
  deviceId: 'D1', observedAt: '2026-08-10T09:00:00Z', storageTotalBytes: 1, storageFreeBytes: 1,
  storagePressure: 'ok', diskHealth: 'good', captureCardState: 'present', publisherStates: {},
  ntpSynced: true, clockOffsetMs: 0, lastBootAt: '2026-08-10T06:00:00Z', cpuLoad1m: 0.1, tempC: 40,
  ...overrides,
});

function build(getDeviceHealth: () => Promise<unknown> = () => Promise.resolve(health())) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const stub = { getDeviceHealth } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider, { client: queryClient }, createElement(ClientContext.Provider, { value: stub, children }),
  );
  return renderHook(() => useDeviceHealth(), { wrapper });
}

describe('useDeviceHealth', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
  });

  it('is not stale with a fresh REST snapshot and no WS staleness', async () => {
    const { result } = build();
    await waitFor(() => expect(result.current.health).toBeDefined());
    expect(result.current.isStale).toBe(false);
  });

  it('is stale when the store stale flag is set', async () => {
    const { result } = build();
    await waitFor(() => expect(result.current.health).toBeDefined());
    act(() => useWsStore.setState({ stale: true }));
    expect(result.current.isStale).toBe(true);
  });
});
