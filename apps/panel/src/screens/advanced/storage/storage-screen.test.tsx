import { createElement, type ReactNode } from 'react';
import { act } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ProblemError } from '@eduscope/api-client';
import type { StorageOverview, StorageVolume } from '@eduscope/shared';
import { ClientContext } from '../../../client/client-provider.js';
import { useWsStore } from '../../../store/ws-store.js';
import { StorageScreen } from './storage-screen.js';

const volume = (overrides: Partial<StorageVolume> = {}): StorageVolume => ({
  id: 'V1', uuid: 'a1b2c3d4-0000-4000-8000-000000000001', devicePath: '/dev/nvme0n1p1',
  mountPath: '/var/lib/eduscope/recordings', label: 'RECORDINGS', filesystem: 'ext4',
  capacityBytes: 500_000_000_000, freeBytes: 260_000_000_000, smartStatus: 'good',
  role: 'recordings', state: 'mounted', registeredAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const overview = (overrides: Partial<StorageOverview> = {}): StorageOverview => ({
  pressure: 'ok', totalBytes: 500_000_000_000, freeBytes: 260_000_000_000, volumes: [volume()],
  policy: {
    maxAgeDays: 90, warningThresholdPct: 70, criticalThresholdPct: 90,
    earlyDeleteOrder: 'uploaded-oldest-first', neverDeleteUnuploaded: true, refuseStartWhenCritical: true,
  },
  ...overrides,
});

function build(methods: Partial<EduscopeClient> = {}) {
  useWsStore.getState().reset();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const stub = {
    getStorageOverview: () => Promise.resolve(overview()),
    ...methods,
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider, { client: queryClient }, createElement(ClientContext.Provider, { value: stub, children }),
  );
  return render(createElement(StorageScreen), { wrapper });
}

describe('StorageScreen', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
  });

  it('loading: renders a skeleton', () => {
    build({ getStorageOverview: () => new Promise(() => {}) });
    expect(screen.getByTestId('storage-skeleton')).toBeInTheDocument();
  });

  it('populated: stats, SMART line, volume list, retention policy in real numbers', async () => {
    build();
    await waitFor(() => expect(screen.getByText(/260 GB free of 500 GB/)).toBeInTheDocument());
    expect(screen.getByText('good')).toBeInTheDocument();
    expect(screen.getByText(/past 90 days/)).toBeInTheDocument();
  });

  it('pressure critical shows the retention-blocked warning', async () => {
    build({ getStorageOverview: () => Promise.resolve(overview({ pressure: 'critical' })) });
    await waitFor(() => expect(screen.getByText('Pressure: critical', { exact: false })).toBeInTheDocument());
    expect(screen.getByText(/cannot be reclaimed/)).toBeInTheDocument();
  });

  it('disk failing/unknown render honestly, never hardcoded Good (C-7)', async () => {
    build({ getStorageOverview: () => Promise.resolve(overview({ volumes: [volume({ smartStatus: 'unknown' })] })) });
    await waitFor(() => expect(screen.getByText('unknown')).toBeInTheDocument());
  });

  it('register drive: pending -> registered', async () => {
    const registerStorageVolume = vi.fn(() => Promise.resolve(volume({ id: 'V2', uuid: 'b'.repeat(8) })));
    build({ registerStorageVolume });
    await waitFor(() => expect(screen.getByLabelText('Volume UUID')).toBeInTheDocument());
    expect(screen.getByLabelText('Volume UUID')).toHaveAttribute('data-osk', 'default');
    expect(screen.getByLabelText('Volume label')).toHaveAttribute('data-osk', 'default');
    fireEvent.change(screen.getByLabelText('Volume UUID'), { target: { value: 'aaaaaaaa-0000-4000-8000-000000000002' } });
    fireEvent.click(screen.getByRole('button', { name: /Register/ }));
    await waitFor(() => expect(registerStorageVolume).toHaveBeenCalled());
  });

  it('register drive 409: duplicate uuid shows the conflict reason', async () => {
    const registerStorageVolume = vi.fn(() => Promise.reject(
      new ProblemError({ status: 409, code: 'conflict', title: 'Volume already registered' }),
    ));
    build({ registerStorageVolume });
    await waitFor(() => expect(screen.getByLabelText('Volume UUID')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Volume UUID'), { target: { value: 'a1b2c3d4-0000-4000-8000-000000000001' } });
    fireEvent.click(screen.getByRole('button', { name: /Register/ }));
    await waitFor(() => expect(screen.getByText('Volume already registered')).toBeInTheDocument());
  });

  it('register drive 422: a bad uuid shows the reason', async () => {
    const registerStorageVolume = vi.fn(() => Promise.reject(
      new ProblemError({ status: 422, code: 'validation.invalid', title: 'Not a valid volume uuid' }),
    ));
    build({ registerStorageVolume });
    await waitFor(() => expect(screen.getByLabelText('Volume UUID')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Volume UUID'), { target: { value: 'not-a-uuid' } });
    fireEvent.click(screen.getByRole('button', { name: /Register/ }));
    await waitFor(() => expect(screen.getByText('Not a valid volume uuid')).toBeInTheDocument());
  });

  it('format confirm: the button stays disabled until the typed text matches the label exactly', async () => {
    build();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Format…' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Format…' }));
    const confirmInput = screen.getByLabelText('Type RECORDINGS to confirm formatting');
    const formatButton = screen.getByRole('button', { name: 'Format volume' });
    expect(formatButton).toBeDisabled();
    fireEvent.change(confirmInput, { target: { value: 'RECORDINGS' } });
    expect(formatButton).not.toBeDisabled();
  });

  it('format refused (recording): the 409 message renders, previous state intact', async () => {
    const formatStorageVolume = vi.fn(() => Promise.reject(
      new ProblemError({ status: 409, code: 'format.refused', title: 'A lecture is in progress — format is refused while recording' }),
    ));
    build({ formatStorageVolume });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Format…' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Format…' }));
    fireEvent.change(screen.getByLabelText('Type RECORDINGS to confirm formatting'), { target: { value: 'RECORDINGS' } });
    fireEvent.click(screen.getByRole('button', { name: 'Format volume' }));
    await waitFor(() => expect(screen.getByText(/refused while recording/)).toBeInTheDocument());
  });

  it('U-2: Register and Format are disabled while stale', async () => {
    build();
    await waitFor(() => expect(screen.getByRole('button', { name: /Register/ })).toBeInTheDocument());
    act(() => useWsStore.setState({ stale: true }));
    expect(screen.getByRole('button', { name: /Register/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Format…' })).toBeDisabled();
  });
});
