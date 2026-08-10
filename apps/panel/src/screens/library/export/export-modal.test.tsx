import { act, createElement, type ReactNode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ProblemError } from '@eduscope/api-client';
import type { ExportJob, UsbVolume } from '@eduscope/shared';
import { ClientContext } from '../../../client/client-provider.js';
import { useWsStore } from '../../../store/ws-store.js';
import { ExportModal } from './export-modal.js';

const envelope = (event: string, payload: unknown, seq: number) =>
  ({ event, at: '2026-08-10T10:00:00+00:00', seq, payload }) as never;

function volume(overrides: Partial<UsbVolume> = {}): UsbVolume {
  return {
    devicePath: '/dev/sdb1', mountPath: '/media/usb0', label: 'KINGSTON',
    capacityBytes: 32_000_000_000, freeBytes: 14_200_000_000,
    ...overrides,
  };
}

function build(methods: Partial<EduscopeClient>) {
  useWsStore.getState().reset();
  const client = { ...methods } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(ClientContext.Provider, { value: client, children });
  return wrapper;
}

describe('<ExportModal/> (S-23) — one state per §4', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
  });

  it('no drive', async () => {
    const wrapper = build({ listExportTargets: vi.fn(() => Promise.resolve([])) });
    render(<ExportModal recordingIds={['R1']} needBytes={6_800_000_000} onClose={vi.fn()} />, { wrapper });
    await waitFor(() => expect(screen.getByText('Insert a USB drive to continue.')).toBeInTheDocument());
  });

  it('drives listed (incl. a too-small card)', async () => {
    const wrapper = build({
      listExportTargets: vi.fn(() => Promise.resolve([volume({}), volume({ devicePath: '/dev/sdc1', label: 'LECTURE-STICK', freeBytes: 900_000_000 })])),
    });
    render(<ExportModal recordingIds={['R1']} needBytes={6_800_000_000} onClose={vi.fn()} />, { wrapper });
    await waitFor(() => expect(screen.getByText('Choose a drive:')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /LECTURE-STICK.*not enough/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Copy 6.8 GB/ })).toBeDisabled();
  });

  it('insufficient space', async () => {
    const wrapper = build({ listExportTargets: vi.fn(() => Promise.resolve([volume({ freeBytes: 900_000_000 })])) });
    render(<ExportModal recordingIds={['R1']} needBytes={6_800_000_000} onClose={vi.fn()} />, { wrapper });
    await waitFor(() => expect(screen.getByText(/None of the connected drives has room/)).toBeInTheDocument());
  });

  it('picking a card enables Copy; picking it starts the export (queued -> copying -> completed)', async () => {
    const job: ExportJob = {
      id: 'J1', requestedAt: '2026-08-10T10:00:00Z', targetVolume: volume({}),
      recordingIds: ['R1'], bytesTotal: 1_000, bytesCopied: 0, state: 'queued', error: null,
    };
    const wrapper = build({
      listExportTargets: vi.fn(() => Promise.resolve([volume({})])),
      createExport: vi.fn(() => Promise.resolve(job)),
    });
    render(<ExportModal recordingIds={['R1']} needBytes={500} onClose={vi.fn()} />, { wrapper });
    await waitFor(() => expect(screen.getByText('Choose a drive:')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /KINGSTON/ }));
    const copyButton = screen.getByRole('button', { name: /Copy/ });
    expect(copyButton).not.toBeDisabled();
    fireEvent.click(copyButton);

    await waitFor(() => expect(screen.getByText('Copying…')).toBeInTheDocument());

    act(() => {
      useWsStore.getState().ingest(envelope('export.job', { jobId: 'J1', state: 'completed', bytesCopied: 1_000, bytesTotal: 1_000, error: null }, 0));
    });
    await waitFor(() => expect(screen.getByText('Safe to remove the drive.')).toBeInTheDocument());
  });

  it('drive removed mid-copy', async () => {
    const job: ExportJob = {
      id: 'J1', requestedAt: '2026-08-10T10:00:00Z', targetVolume: volume({}),
      recordingIds: ['R1'], bytesTotal: 1_000, bytesCopied: 0, state: 'queued', error: null,
    };
    const wrapper = build({
      listExportTargets: vi.fn(() => Promise.resolve([volume({})])),
      createExport: vi.fn(() => Promise.resolve(job)),
    });
    render(<ExportModal recordingIds={['R1']} needBytes={500} onClose={vi.fn()} />, { wrapper });
    await waitFor(() => expect(screen.getByText('Choose a drive:')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /KINGSTON/ }));
    fireEvent.click(screen.getByRole('button', { name: /Copy/ }));
    await waitFor(() => expect(screen.getByText('Copying…')).toBeInTheDocument());

    act(() => {
      useWsStore.getState().ingest(envelope('export.job', {
        jobId: 'J1', state: 'failed', bytesCopied: 300, bytesTotal: 1_000,
        error: 'The drive was removed before the copy finished',
      }, 0));
    });
    await waitFor(() => expect(screen.getByText(/removed before the copy finished/)).toBeInTheDocument());
  });

  it('cancelled', async () => {
    const job: ExportJob = {
      id: 'J1', requestedAt: '2026-08-10T10:00:00Z', targetVolume: volume({}),
      recordingIds: ['R1'], bytesTotal: 1_000, bytesCopied: 0, state: 'queued', error: null,
    };
    const wrapper = build({
      listExportTargets: vi.fn(() => Promise.resolve([volume({})])),
      createExport: vi.fn(() => Promise.resolve(job)),
      cancelExport: vi.fn(() => Promise.resolve({ commandId: 'c', acceptedAt: '2026-08-10T10:00:00Z', resolveBySec: 10 })),
    });
    render(<ExportModal recordingIds={['R1']} needBytes={500} onClose={vi.fn()} />, { wrapper });
    await waitFor(() => expect(screen.getByText('Choose a drive:')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /KINGSTON/ }));
    fireEvent.click(screen.getByRole('button', { name: /Copy/ }));
    await waitFor(() => expect(screen.getByText('Copying…')).toBeInTheDocument());

    act(() => {
      useWsStore.getState().ingest(envelope('export.job', { jobId: 'J1', state: 'cancelled', bytesCopied: 200, bytesTotal: 1_000, error: null }, 0));
    });
    await waitFor(() => expect(screen.getByText('Copy cancelled.')).toBeInTheDocument());
  });

  it('create refused (CG-21)', async () => {
    const wrapper = build({
      listExportTargets: vi.fn(() => Promise.resolve([volume({})])),
      createExport: vi.fn(() => Promise.reject(new ProblemError({ status: 422, code: 'export.insufficient-space', title: 'That drive filled up' }))),
    });
    render(<ExportModal recordingIds={['R1']} needBytes={500} onClose={vi.fn()} />, { wrapper });
    await waitFor(() => expect(screen.getByText('Choose a drive:')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /KINGSTON/ }));
    fireEvent.click(screen.getByRole('button', { name: /Copy/ }));
    await waitFor(() => expect(screen.getByText(/That drive filled up/)).toBeInTheDocument());
  });
});
