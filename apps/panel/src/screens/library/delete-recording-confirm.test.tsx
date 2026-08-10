import { act, createElement, type ReactNode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ProblemError } from '@eduscope/api-client';
import type { Recording } from '@eduscope/shared';
import { ClientContext } from '../../client/client-provider.js';
import { useWsStore } from '../../store/ws-store.js';
import { DeleteRecordingConfirm } from './delete-recording-confirm.js';

function rec(overrides: Partial<Recording> = {}): Recording {
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

function renderConfirm(deleteRecording: EduscopeClient['deleteRecording'], target: Recording, onDone = vi.fn()) {
  const client = { deleteRecording } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(ClientContext.Provider, { value: client, children });
  return { ...render(<DeleteRecordingConfirm rec={target} onDone={onDone} />, { wrapper }), onDone };
}

describe('<DeleteRecordingConfirm/> (S-24)', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
  });

  it('initial focus is Cancel', () => {
    renderConfirm(vi.fn(), rec({}));
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('Delete -> pending (both locked)', () => {
    renderConfirm(vi.fn(() => new Promise<never>(() => undefined)), rec({}));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('a lecturer 403 -> refused with the named reason and Close replacing Delete', async () => {
    const deleteRecording = vi.fn(() => Promise.reject(
      new ProblemError({ status: 403, code: 'not-authorized', title: 'no' }),
    ));
    renderConfirm(deleteRecording, rec({}));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.getByText("You don't have permission to delete recordings.")).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('recording.artifact{deleted} -> dialog closes (calls onDone)', async () => {
    const deleteRecording = vi.fn(() => Promise.resolve({ commandId: 'c', acceptedAt: '2026-08-10T10:00:00Z', resolveBySec: 10 }));
    const { onDone } = renderConfirm(deleteRecording, rec({}));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Deleting…' })).toBeInTheDocument());

    act(() => {
      useWsStore.getState().ingest(envelope('recording.artifact', {
        recordingId: 'R1', sessionId: 'S1', state: 'deleted', mergeState: 'done',
        durationMs: 2_880_000, totalBytes: 2_100_000_000, deleteReason: 'admin',
      }, 0));
    });

    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('while stale (U-2) the destructive button is disabled', () => {
    useWsStore.setState({ stale: true });
    renderConfirm(vi.fn(), rec({}));
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });
});
