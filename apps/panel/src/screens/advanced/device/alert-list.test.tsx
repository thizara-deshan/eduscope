import { createElement, type ReactNode } from 'react';
import { act } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ProblemError } from '@eduscope/api-client';
import type { SystemAlert } from '@eduscope/shared';
import { ClientContext } from '../../../client/client-provider.js';
import { useWsStore } from '../../../store/ws-store.js';
import { AlertList } from './alert-list.js';

const alert = (overrides: Partial<SystemAlert> = {}): SystemAlert => ({
  id: 'A1', code: 'source.offline', severity: 'error', category: 'System', title: 'Capture card not detected',
  detail: 'The presentation input has no signal.', raisedAt: '2026-08-10T09:00:00Z', clearedAt: null,
  clearedReason: null, acknowledgedBy: null, context: null, relatedEntity: null,
  ...overrides,
});

function build(methods: Partial<EduscopeClient>) {
  useWsStore.getState().reset();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const stub = methods as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider, { client: queryClient }, createElement(ClientContext.Provider, { value: stub, children }),
  );
  return render(createElement(AlertList), { wrapper });
}

describe('AlertList', () => {
  it('no active alerts: a calm empty line', async () => {
    build({ listAlerts: () => Promise.resolve({ items: [] }) });
    await waitFor(() => expect(screen.getByText('No active alerts.')).toBeInTheDocument());
  });

  it('acknowledged still active (INV-SA-1/C-4): the row stays, never says resolved', async () => {
    const acknowledgeAlert = () => Promise.resolve(alert({ acknowledgedBy: 'admin' }));
    build({
      listAlerts: () => Promise.resolve({ items: [alert()] }),
      acknowledgeAlert,
    });
    await waitFor(() => expect(screen.getByText('Capture card not detected')).toBeInTheDocument());
    act(() => screen.getByRole('button', { name: /Acknowledge/i }).click());
    await waitFor(() => expect(screen.getByText('✓ acknowledged · still active')).toBeInTheDocument());
    expect(screen.getByText('Capture card not detected')).toBeInTheDocument();
    expect(screen.queryByText(/resolved/i)).not.toBeInTheDocument();
  });

  it('alert cleared: visible only under Show cleared', async () => {
    build({
      listAlerts: ({ includeCleared }: { includeCleared?: boolean } = {}) => Promise.resolve({
        items: includeCleared ? [alert({ clearedAt: '2026-08-10T10:00:00Z', clearedReason: 'resolved' })] : [],
      }),
    });
    await waitFor(() => expect(screen.getByText('No active alerts.')).toBeInTheDocument());
    act(() => screen.getByLabelText('Show cleared').click());
    await waitFor(() => expect(screen.getByText('Capture card not detected')).toBeInTheDocument());
  });

  it('acknowledge pending (U-4): pending label shows while the mutation is in flight', async () => {
    let resolve!: (v: SystemAlert) => void;
    const acknowledgeAlert = () => new Promise<SystemAlert>((r) => { resolve = r; });
    build({ listAlerts: () => Promise.resolve({ items: [alert()] }), acknowledgeAlert });
    await waitFor(() => expect(screen.getByText('Capture card not detected')).toBeInTheDocument());
    act(() => screen.getByRole('button', { name: /Acknowledge/i }).click());
    expect(screen.getByText('Acknowledging…')).toBeInTheDocument();
    await waitFor(() => expect(resolve).toBeDefined());
    act(() => resolve(alert({ acknowledgedBy: 'admin' })));
    await waitFor(() => expect(screen.getByText('✓ acknowledged · still active')).toBeInTheDocument());
  });

  it('U-5: a 404 (already cleared) surfaces a benign reason next to the button', async () => {
    const acknowledgeAlert = () => Promise.reject(
      new ProblemError({ status: 404, code: 'not-found', title: 'Unknown alert: A1' }),
    );
    build({ listAlerts: () => Promise.resolve({ items: [alert()] }), acknowledgeAlert });
    await waitFor(() => expect(screen.getByText('Capture card not detected')).toBeInTheDocument());
    act(() => screen.getByRole('button', { name: /Acknowledge/i }).click());
    await waitFor(() => expect(screen.getByText('Unknown alert: A1')).toBeInTheDocument());
  });
});
