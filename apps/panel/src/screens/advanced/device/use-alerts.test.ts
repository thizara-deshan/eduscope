import { createElement, type ReactNode } from 'react';
import { act } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ProblemError } from '@eduscope/api-client';
import type { SystemAlert } from '@eduscope/shared';
import { ClientContext } from '../../../client/client-provider.js';
import { useWsStore } from '../../../store/ws-store.js';
import { useAlerts } from './use-alerts.js';

const alert = (overrides: Partial<SystemAlert> = {}): SystemAlert => ({
  id: 'A1', code: 'source.offline', severity: 'error', category: 'System', title: 'source.offline',
  detail: null, raisedAt: '2026-08-10T09:00:00Z', clearedAt: null, clearedReason: null,
  acknowledgedBy: null, context: null, relatedEntity: null,
  ...overrides,
});

function build(methods: Partial<EduscopeClient>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const stub = methods as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider, { client: queryClient }, createElement(ClientContext.Provider, { value: stub, children }),
  );
  return renderHook(() => useAlerts({ includeCleared: false }), { wrapper });
}

describe('useAlerts', () => {
  it('keeps the acknowledged alert in the list (C-4) after acknowledge resolves', async () => {
    const listAlerts = vi.fn(() => Promise.resolve({ items: [alert()] }));
    const acknowledgeAlert = vi.fn(() => Promise.resolve(alert({ acknowledgedBy: 'admin' })));
    const { result } = build({ listAlerts, acknowledgeAlert });
    await waitFor(() => expect(result.current.alerts).toHaveLength(1));

    act(() => result.current.acknowledge('A1'));
    await waitFor(() => expect(result.current.ackPending).toBeNull());
    expect(acknowledgeAlert).toHaveBeenCalledWith('A1');
    expect(result.current.alerts).toHaveLength(1);
  });

  it('a stale live replay of the unacknowledged row does not clobber a completed acknowledge', async () => {
    useWsStore.getState().reset();
    const listAlerts = vi.fn(() => Promise.resolve({ items: [alert()] }));
    const acknowledgeAlert = vi.fn(() => Promise.resolve(alert({ acknowledgedBy: 'admin' })));
    const { result } = build({ listAlerts, acknowledgeAlert });
    await waitFor(() => expect(result.current.alerts).toHaveLength(1));

    act(() => result.current.acknowledge('A1'));
    await waitFor(() => expect(result.current.alerts[0]?.acknowledgedBy).toBe('admin'));

    // `acknowledgeAlert` has no `system.alert` echo — a replay of the ORIGINAL
    // seeded row (e.g. from events$'s snapshot-on-subscribe) must not undo it.
    act(() => useWsStore.getState().ingest({
      event: 'system.alert', at: '2026-08-10T09:00:00+00:00', seq: 1, payload: alert(),
    } as never));
    expect(result.current.alerts[0]?.acknowledgedBy).toBe('admin');
  });

  it('maps a rejected acknowledgeAlert (404) to ackError', async () => {
    const listAlerts = vi.fn(() => Promise.resolve({ items: [alert()] }));
    const acknowledgeAlert = vi.fn(() => Promise.reject(
      new ProblemError({ status: 404, code: 'not-found', title: 'Unknown alert: A1' }),
    ));
    const { result } = build({ listAlerts, acknowledgeAlert });
    await waitFor(() => expect(result.current.alerts).toHaveLength(1));

    act(() => result.current.acknowledge('A1'));
    await waitFor(() => expect(result.current.ackError).toEqual({ id: 'A1', message: 'Unknown alert: A1' }));
  });
});
