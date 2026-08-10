import { createElement, type ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ProblemError } from '@eduscope/api-client';
import type { RecordingFile, User } from '@eduscope/shared';
import { AuthProvider } from '../../../auth/auth-context.js';
import { ClientContext } from '../../../client/client-provider.js';
import { RecordingPlayer } from './recording-player.js';

const lecturer: User = {
  id: 'U1', username: 'a.perera', displayName: 'A. Perera', role: 'lecturer',
  source: 'institute', mustResetPassword: false, disabled: false,
  lastLoginAt: null, createdAt: '2026-01-01T00:00:00.000Z',
};
const admin: User = { ...lecturer, id: 'U2', username: 'admin', displayName: 'Administrator', role: 'admin' };

function file(overrides: Partial<RecordingFile> = {}): RecordingFile {
  return {
    id: 'F1', recordingId: 'R1', segmentId: 'SEG1', kind: 'merged', streamKey: 'main',
    container: 'mp4', sizeBytes: 1_000_000, durationMs: 60_000, state: 'finalized',
    hasAudio: true, isUploadable: true,
    ...overrides,
  };
}

function renderPlayer(getRecordingMedia: EduscopeClient['getRecordingMedia'], viewer: User = lecturer, theFile: RecordingFile = file()) {
  const client = { getRecordingMedia } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    ClientContext.Provider, { value: client },
    createElement(AuthProvider, { initialUser: viewer, children: createElement(MemoryRouter, null, children) }),
  );
  return render(<RecordingPlayer recordingId="R1" file={theFile} />, { wrapper });
}

describe('<RecordingPlayer/> (S-22)', () => {
  it('builds src via the client (the media method is called)', async () => {
    const getRecordingMedia = vi.fn(() => Promise.resolve(new Blob(['x'], { type: 'video/mp4' })));
    renderPlayer(getRecordingMedia);
    await waitFor(() => expect(getRecordingMedia).toHaveBeenCalledWith('R1', 'F1'));
  });

  it('a 403 from the client surfaces forbidden, not a frozen frame', async () => {
    const getRecordingMedia = vi.fn(() => Promise.reject(
      new ProblemError({ status: 403, code: 'not-authorized', title: 'no access' }),
    ));
    renderPlayer(getRecordingMedia);
    await waitFor(() => expect(screen.getByText(/don't have access/)).toBeInTheDocument());
  });

  it('a generic error surfaces playback failed with Try again', async () => {
    const getRecordingMedia = vi.fn(() => Promise.reject(new Error('network down')));
    renderPlayer(getRecordingMedia);
    await waitFor(() => expect(screen.getByText('Playback stopped.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it("file.state === 'missing' renders file missing with the admin S-35 link and no player", async () => {
    const getRecordingMedia = vi.fn();
    renderPlayer(getRecordingMedia, admin, file({ state: 'missing' }));
    expect(screen.getByText(/no longer on the device/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Upload Queue' })).toBeInTheDocument();
    expect(getRecordingMedia).not.toHaveBeenCalled();
  });

  it("a lecturer sees no S-35 link on file missing", () => {
    renderPlayer(vi.fn(), lecturer, file({ state: 'missing' }));
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
