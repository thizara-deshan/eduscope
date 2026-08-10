import { createElement, type ReactNode } from 'react';
import { act } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ProblemError } from '@eduscope/api-client';
import type { LogEntry } from '@eduscope/shared';
import { ClientContext } from '../../../client/client-provider.js';
import { useWsStore } from '../../../store/ws-store.js';
import { LogsScreen } from './logs-screen.js';

const log = (overrides: Partial<LogEntry> = {}): LogEntry => ({
  id: 'L1', at: '2026-08-10T09:00:00Z', level: 'INFO', category: 'System', service: 'core-api',
  message: 'Device booted.', context: null, sessionId: null, userId: null,
  ...overrides,
});

function build(methods: Partial<EduscopeClient> = {}) {
  useWsStore.getState().reset();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const stub = {
    queryLogs: () => Promise.resolve({ items: [log()], nextCursor: null }),
    ...methods,
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider, { client: queryClient }, createElement(ClientContext.Provider, { value: stub, children }),
  );
  return render(createElement(LogsScreen), { wrapper });
}

describe('LogsScreen', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
  });

  it('loading: renders a skeleton', () => {
    build({ queryLogs: () => new Promise(() => {}) });
    expect(screen.getByTestId('logs-skeleton')).toBeInTheDocument();
  });

  it('empty (no logs): a plain empty line', async () => {
    build({ queryLogs: () => Promise.resolve({ items: [], nextCursor: null }) });
    await waitFor(() => expect(screen.getByText('No logs yet.')).toBeInTheDocument());
  });

  it('empty (no match): different copy from the plain-empty state', async () => {
    build({
      queryLogs: (q?: { level?: string }) => Promise.resolve(
        q?.level === 'WARN' ? { items: [], nextCursor: null } : { items: [log()], nextCursor: null },
      ),
    });
    await waitFor(() => expect(screen.getByTestId('log-row-L1')).toBeInTheDocument());
    fireEvent.click(screen.getByText('WARN'));
    await waitFor(() => expect(screen.getByText(/change your filter/)).toBeInTheDocument());
  });

  it('populated: newest first', async () => {
    build({ queryLogs: () => Promise.resolve({
      items: [
        log({ id: 'L1', at: '2026-08-10T09:00:00Z', message: 'first' }),
        log({ id: 'L2', at: '2026-08-10T09:05:00Z', message: 'second' }),
      ],
      nextCursor: null,
    }) });
    await waitFor(() => expect(screen.getByTestId('log-row-L2')).toBeInTheDocument());
    const rows = screen.getAllByTestId(/log-row-/);
    expect(rows[0]).toHaveAttribute('data-testid', 'log-row-L2');
  });

  it('filtering: a level chip re-queries with the level', async () => {
    const queryLogs = vi.fn(() => Promise.resolve({ items: [log()], nextCursor: null }));
    build({ queryLogs });
    await waitFor(() => expect(screen.getByTestId('log-row-L1')).toBeInTheDocument());
    fireEvent.click(screen.getByText('WARN'));
    await waitFor(() => expect(queryLogs).toHaveBeenCalledWith(expect.objectContaining({ level: 'WARN' })));
  });

  it('session drill-in: expanding a row with a sessionId filters by it', async () => {
    const queryLogs = vi.fn(() => Promise.resolve({
      items: [log({ sessionId: 'S1' })], nextCursor: null,
    }));
    build({ queryLogs });
    await waitFor(() => expect(screen.getByTestId('log-row-L1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('log-row-L1').querySelector('button')!);
    fireEvent.click(screen.getByText('View session S1'));
    await waitFor(() => expect(queryLogs).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'S1' })));
  });

  it('live tail: an appended log.entry shows atop', async () => {
    build();
    await waitFor(() => expect(screen.getByTestId('log-row-L1')).toBeInTheDocument());
    act(() => useWsStore.getState().ingest({
      event: 'log.entry', at: '2026-08-10T09:10:00+00:00', seq: 1,
      payload: log({ id: 'L2', at: '2026-08-10T09:10:00Z', message: 'live entry' }),
    } as never));
    await waitFor(() => expect(screen.getByTestId('log-row-L2')).toBeInTheDocument());
    const rows = screen.getAllByTestId(/log-row-/);
    expect(rows[0]).toHaveAttribute('data-testid', 'log-row-L2');
  });

  it('tail stale (U-2): marked stale while the query still returns rows', async () => {
    build();
    await waitFor(() => expect(screen.getByTestId('log-row-L1')).toBeInTheDocument());
    act(() => useWsStore.setState({ stale: true }));
    expect(screen.getByTestId('tail-stale')).toBeInTheDocument();
    expect(screen.getByTestId('log-row-L1')).toBeInTheDocument();
  });

  it('exporting -> export ready', async () => {
    const exportLogsCsv = vi.fn(() => Promise.resolve('id,at,level\nL1,2026-08-10T09:00:00Z,INFO'));
    build({ exportLogsCsv });
    await waitFor(() => expect(screen.getByTestId('log-row-L1')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(screen.getByTestId('export-ready')).toBeInTheDocument());
    expect(exportLogsCsv).toHaveBeenCalled();
  });

  it('export failed (U-5)', async () => {
    const exportLogsCsv = vi.fn(() => Promise.reject(
      new ProblemError({ status: 500, code: 'not-found', title: 'Export failed' }),
    ));
    build({ exportLogsCsv });
    await waitFor(() => expect(screen.getByTestId('log-row-L1')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(screen.getByTestId('export-failed')).toHaveTextContent('Export failed'));
  });
});
