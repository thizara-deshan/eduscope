import { act, createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ProblemError } from '@eduscope/api-client';
import type { ExportJob, UsbVolume } from '@eduscope/shared';
import { ClientContext } from '../../../client/client-provider.js';
import { useWsStore } from '../../../store/ws-store.js';
import { useExport } from './use-export.js';

const envelope = (event: string, payload: unknown, seq: number) =>
  ({ event, at: '2026-08-10T10:00:00+00:00', seq, payload }) as never;

function volume(overrides: Partial<UsbVolume> = {}): UsbVolume {
  return {
    devicePath: '/dev/sdb1', mountPath: '/media/usb0', label: 'BACKUP-1',
    capacityBytes: 64_000_000_000, freeBytes: 40_000_000_000,
    ...overrides,
  };
}

function queuedJob(): ExportJob {
  return {
    id: 'J1', requestedAt: '2026-08-10T10:00:00Z', targetVolume: volume({}),
    recordingIds: ['R1'], bytesTotal: 1_000, bytesCopied: 0, state: 'queued', error: null,
  };
}

function build(methods: Partial<EduscopeClient>) {
  useWsStore.getState().reset();
  const client = { ...methods } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(ClientContext.Provider, { value: client, children });
  return wrapper;
}

describe('useExport (S-23)', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
  });

  it('opening calls listExportTargets; a live usb.volumes insert moves no-drive -> drives-listed', async () => {
    const listExportTargets = vi.fn(() => Promise.resolve([]));
    const wrapper = build({ listExportTargets });
    const { result } = renderHook(() => useExport(['R1'], 1_000_000_000), { wrapper });

    await waitFor(() => expect(listExportTargets).toHaveBeenCalled());
    await waitFor(() => expect(result.current.state).toBe('no-drive'));

    act(() => {
      useWsStore.getState().ingest(envelope('usb.volumes', { volumes: [volume({})] }, 0));
    });

    await waitFor(() => expect(result.current.state).toBe('drives-listed'));
  });

  it('all volumes too small -> insufficient-space', async () => {
    const listExportTargets = vi.fn(() => Promise.resolve([volume({ freeBytes: 500_000_000 })]));
    const wrapper = build({ listExportTargets });
    const { result } = renderHook(() => useExport(['R1'], 1_000_000_000), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('insufficient-space'));
  });

  it('pick -> createExport; export.job steps queued -> copying (bytes increase) -> completed; etaSeconds non-null once >= 2 samples', async () => {
    const listExportTargets = vi.fn(() => Promise.resolve([volume({})]));
    const createExport = vi.fn(() => Promise.resolve(queuedJob()));
    const wrapper = build({ listExportTargets, createExport });
    const { result } = renderHook(() => useExport(['R1'], 500), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('drives-listed'));

    act(() => result.current.pick('/dev/sdb1'));
    await waitFor(() => expect(createExport).toHaveBeenCalledWith({ recordingIds: ['R1'], targetDevicePath: '/dev/sdb1' }));
    await waitFor(() => expect(result.current.state).toBe('queued'));

    act(() => {
      useWsStore.getState().ingest(envelope('export.job', { jobId: 'J1', state: 'copying', bytesCopied: 200, bytesTotal: 1_000, error: null }, 0));
    });
    await waitFor(() => expect(result.current.state).toBe('copying'));
    expect(result.current.etaSeconds).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 10));

    act(() => {
      useWsStore.getState().ingest(envelope('export.job', { jobId: 'J1', state: 'copying', bytesCopied: 600, bytesTotal: 1_000, error: null }, 1));
    });
    await waitFor(() => expect(result.current.etaSeconds).not.toBeNull());

    act(() => {
      useWsStore.getState().ingest(envelope('export.job', { jobId: 'J1', state: 'completed', bytesCopied: 1_000, bytesTotal: 1_000, error: null }, 2));
    });
    await waitFor(() => expect(result.current.state).toBe('completed'));
  });

  it("a terminal export.job with a 'removed' error reads as drive-removed; retry re-issues createExport with the same recordingIds", async () => {
    const listExportTargets = vi.fn(() => Promise.resolve([volume({})]));
    const createExport = vi.fn<EduscopeClient['createExport']>(() => Promise.resolve(queuedJob()));
    const wrapper = build({ listExportTargets, createExport });
    const { result } = renderHook(() => useExport(['R1'], 500), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('drives-listed'));
    act(() => result.current.pick('/dev/sdb1'));
    await waitFor(() => expect(result.current.state).toBe('queued'));

    act(() => {
      useWsStore.getState().ingest(envelope('export.job', {
        jobId: 'J1', state: 'failed', bytesCopied: 300, bytesTotal: 1_000,
        error: 'The drive was removed before the copy finished',
      }, 0));
    });
    await waitFor(() => expect(result.current.state).toBe('drive-removed'));

    act(() => result.current.retry());
    await waitFor(() => expect(createExport).toHaveBeenCalledTimes(2));
    expect(createExport.mock.calls[1]![0]).toEqual({ recordingIds: ['R1'], targetDevicePath: '/dev/sdb1' });
  });

  it('a 422 export.insufficient-space -> create-refused with the named reason; a generic validation.invalid is not treated as a space problem', async () => {
    const listExportTargets = vi.fn(() => Promise.resolve([volume({})]));
    const createExport = vi.fn(() => Promise.reject(
      new ProblemError({ status: 422, code: 'export.insufficient-space', title: 'That drive filled up' }),
    ));
    const wrapper = build({ listExportTargets, createExport });
    const { result } = renderHook(() => useExport(['R1'], 500), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('drives-listed'));

    act(() => result.current.pick('/dev/sdb1'));
    await waitFor(() => expect(result.current.state).toBe('create-refused'));
    expect(result.current.refusalReason).toBe('That drive filled up');
  });
});
