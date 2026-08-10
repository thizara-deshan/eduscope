import { act, createElement, type ReactNode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ProblemError } from '@eduscope/api-client';
import type { User } from '@eduscope/shared';
import { AuthProvider } from '../../../auth/auth-context.js';
import { ClientContext } from '../../../client/client-provider.js';
import { useWsStore } from '../../../store/ws-store.js';
import { RetryMerge } from './retry-merge.js';

const admin: User = {
  id: 'U2', username: 'admin', displayName: 'Administrator', role: 'admin',
  source: 'local', mustResetPassword: false, disabled: false,
  lastLoginAt: null, createdAt: '2026-01-01T00:00:00.000Z',
};
const lecturer: User = { ...admin, id: 'U1', username: 'a.perera', displayName: 'A. Perera', role: 'lecturer' };

const envelope = (event: string, payload: unknown, seq: number) =>
  ({ event, at: '2026-08-10T10:00:00+00:00', seq, payload }) as never;

function renderRetry(retryMergeRecording: EduscopeClient['retryMergeRecording'], viewer: User) {
  const client = { retryMergeRecording } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    ClientContext.Provider, { value: client }, createElement(AuthProvider, { initialUser: viewer, children }),
  );
  return render(<RetryMerge recordingId="R1" />, { wrapper });
}

describe('<RetryMerge/> (S-22 §2.4/CG-7)', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
  });

  it('renders for admin only', () => {
    const { container: adminContainer } = renderRetry(vi.fn(), admin);
    expect(adminContainer).not.toBeEmptyDOMElement();

    const { container: lecturerContainer } = renderRetry(vi.fn(), lecturer);
    expect(lecturerContainer).toBeEmptyDOMElement();
  });

  it('a 409 shows the named reason and the button is replaced (never re-tappable)', async () => {
    const retryMergeRecording = vi.fn(() => Promise.reject(
      new ProblemError({ status: 409, code: 'conflict', title: 'This recording is not in a failed merge state' }),
    ));
    renderRetry(retryMergeRecording, admin);
    fireEvent.click(screen.getByRole('button', { name: 'Retry preparing' }));
    await waitFor(() => expect(screen.getByText('This recording is not in a failed merge state')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Retry preparing' })).not.toBeInTheDocument();
  });

  it('resolves pending on recording.artifact{merging}', async () => {
    const retryMergeRecording = vi.fn(() => Promise.resolve({ commandId: 'c', acceptedAt: '2026-08-10T10:00:00Z', resolveBySec: 10 }));
    renderRetry(retryMergeRecording, admin);
    fireEvent.click(screen.getByRole('button', { name: 'Retry preparing' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retrying…' })).toBeInTheDocument());

    act(() => {
      useWsStore.getState().ingest(envelope('recording.artifact', {
        recordingId: 'R1', sessionId: 'S1', state: 'merging', mergeState: 'running',
        durationMs: null, totalBytes: null, deleteReason: null,
      }, 0));
    });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry preparing' })).toBeInTheDocument());
  });
});
