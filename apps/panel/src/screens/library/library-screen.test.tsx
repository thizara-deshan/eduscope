import { createElement, type ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import type { Recording, User } from '@eduscope/shared';
import { AuthProvider } from '../../auth/auth-context.js';
import { ClientContext } from '../../client/client-provider.js';
import { useWsStore } from '../../store/ws-store.js';
import { LibraryScreen } from './library-screen.js';

const lecturer: User = {
  id: 'U1', username: 'a.perera', displayName: 'A. Perera', role: 'lecturer',
  source: 'institute', mustResetPassword: false, disabled: false,
  lastLoginAt: null, createdAt: '2026-01-01T00:00:00.000Z',
};
const admin: User = { ...lecturer, id: 'U2', username: 'admin', displayName: 'Administrator', role: 'admin' };

function rec(overrides: Partial<Recording>): Recording {
  return {
    id: 'R1', sessionId: 'S1', title: 'Lecture 1', hallDisplayName: 'Hall A',
    ownerUserId: 'U1', ownerDisplayName: 'A. Perera', startedAt: '2026-08-10T09:00:00.000Z',
    endedAt: '2026-08-10T09:48:00.000Z', state: 'ready', layoutPresetId: 'fifty-fifty',
    durationMs: 48 * 60_000, totalBytes: 2_100_000_000, segmentCount: 1,
    mergeState: 'done', uploadState: 'done',
    retentionDeleteAfter: '2026-11-10T09:00:00.000Z',
    deletedAt: null, deleteReason: null,
    ...overrides,
  };
}

const envelope = (event: string, payload: unknown, seq: number) =>
  ({ event, at: '2026-08-10T10:00:00+00:00', seq, payload }) as never;

function renderLibrary({
  viewer = lecturer,
  listRecordings,
  stale = false,
}: {
  viewer?: User;
  listRecordings: EduscopeClient['listRecordings'];
  stale?: boolean;
}) {
  useWsStore.getState().reset();
  useWsStore.setState({ stale });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = { listRecordings } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(ClientContext.Provider, { value: client },
      createElement(AuthProvider, { initialUser: viewer, children: createElement(MemoryRouter, null, children) })),
  );
  return render(<LibraryScreen />, { wrapper });
}

describe('LibraryScreen (S-21)', () => {
  it('loading: renders skeleton rows, not a full-screen spinner', () => {
    const listRecordings = vi.fn(() => new Promise<never>(() => undefined));
    renderLibrary({ listRecordings });
    expect(screen.getAllByTestId('row-skeleton').length).toBeGreaterThan(0);
  });

  it('empty (lecturer): reassuring copy', async () => {
    const listRecordings = vi.fn(() => Promise.resolve({ items: [], nextCursor: null }));
    renderLibrary({ listRecordings });
    await waitFor(() => expect(screen.getByText("You haven't recorded anything yet.")).toBeInTheDocument());
  });

  it('empty (admin): factual device statement', async () => {
    const listRecordings = vi.fn(() => Promise.resolve({ items: [], nextCursor: null }));
    renderLibrary({ viewer: admin, listRecordings });
    await waitFor(() => expect(screen.getByText('No recordings on this device.')).toBeInTheDocument());
  });

  it('populated: renders rows with badges', async () => {
    const listRecordings = vi.fn(() => Promise.resolve({ items: [rec({})], nextCursor: null }));
    renderLibrary({ listRecordings });
    await waitFor(() => expect(screen.getByText('Lecture 1')).toBeInTheDocument());
    expect(screen.getByText('Uploaded')).toBeInTheDocument();
  });

  it('selection mode: shows checkboxes and the Σ-bytes selection bar', async () => {
    const listRecordings = vi.fn(() => Promise.resolve({
      items: [
        rec({ id: 'R1', title: 'Lecture 1', totalBytes: 1_000_000_000 }),
        rec({ id: 'R2', title: 'Lecture 2', totalBytes: 2_000_000_000 }),
      ],
      nextCursor: null,
    }));
    renderLibrary({ listRecordings });
    await waitFor(() => expect(screen.getByText('Lecture 1')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(2);
    fireEvent.click(checkboxes[0]!);
    await waitFor(() => expect(screen.getByText(/1 selected · 1 GB/)).toBeInTheDocument());
  });

  it('load-more pending: appends the next page without re-skeletoning existing rows', async () => {
    const listRecordings = vi.fn()
      .mockResolvedValueOnce({ items: [rec({ id: 'R1' })], nextCursor: 'p2' })
      .mockResolvedValueOnce({ items: [rec({ id: 'R2' })], nextCursor: null });
    renderLibrary({ listRecordings: listRecordings as unknown as EduscopeClient['listRecordings'] });
    await waitFor(() => expect(screen.getByText('Lecture 1')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument());
    expect(screen.queryAllByTestId('row-skeleton').length).toBe(0);
  });

  it('removed-under-user: a live artifact{deleted} animates the row out with a non-alarming, reason-keyed note', async () => {
    const listRecordings = vi.fn(() => Promise.resolve({ items: [rec({ id: 'R1' })], nextCursor: null }));
    renderLibrary({ listRecordings });
    await waitFor(() => expect(screen.getByText('Lecture 1')).toBeInTheDocument());

    act(() => {
      useWsStore.getState().ingest(envelope('recording.artifact', {
        recordingId: 'R1', sessionId: 'S1', state: 'deleted', mergeState: 'done',
        durationMs: 2_880_000, totalBytes: 2_100_000_000, deleteReason: 'disk-pressure',
      }, 0));
    });

    await waitFor(() => expect(screen.getByText(/removed to free up space/)).toBeInTheDocument());
    expect(screen.queryByText('Lecture 1')).not.toBeInTheDocument();
  });

  it('deleted-tombstone: admin + includeDeleted renders a non-playable tombstone', async () => {
    const listRecordings = vi.fn(() => Promise.resolve({
      items: [rec({ id: 'R1', state: 'deleted', deletedAt: '2026-08-01T00:00:00.000Z', deleteReason: 'retention' })],
      nextCursor: null,
    }));
    renderLibrary({ viewer: admin, listRecordings });
    await waitFor(() => expect(screen.getByText('Lecture 1')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Play/ })).not.toBeInTheDocument();
  });

  it('U-2: while stale, Load more is disabled', async () => {
    const listRecordings = vi.fn()
      .mockResolvedValue({ items: [rec({ id: 'R1' })], nextCursor: 'p2' });
    renderLibrary({ listRecordings: listRecordings as unknown as EduscopeClient['listRecordings'], stale: true });
    await waitFor(() => expect(screen.getByText('Lecture 1')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Load more' })).toBeDisabled();
  });
});
