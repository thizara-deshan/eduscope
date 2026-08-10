import { createElement, type ReactNode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import type { RecordingFile } from '@eduscope/shared';
import { ClientContext } from '../../../client/client-provider.js';
import { FileList } from './file-list.js';

function file(overrides: Partial<RecordingFile> = {}): RecordingFile {
  return {
    id: 'F1', recordingId: 'R1', segmentId: 'SEG1', kind: 'merged', streamKey: 'composite',
    container: 'mp4', sizeBytes: 2_100_000_000, durationMs: 3_851_000, state: 'finalized',
    hasAudio: true, isUploadable: true,
    ...overrides,
  };
}

describe('<FileList/> (S-22 §2.1)', () => {
  it('Download uses getRecordingMedia with {download:true} and states the browser target', () => {
    const getRecordingMedia = vi.fn(() => Promise.resolve(new Blob(['x'])));
    const client = { getRecordingMedia } as unknown as EduscopeClient;
    const wrapper = ({ children }: { children: ReactNode }) => createElement(ClientContext.Provider, { value: client, children });
    render(<FileList recordingId="R1" files={[file({})]} />, { wrapper });

    fireEvent.click(screen.getByRole('button', { name: /Download/ }));
    expect(getRecordingMedia).toHaveBeenCalledWith('R1', 'F1', { download: true });
    expect(screen.getByText(/Download saves to this browser/)).toBeInTheDocument();
  });

  it('a missing file disables Download', () => {
    const client = { getRecordingMedia: vi.fn() } as unknown as EduscopeClient;
    const wrapper = ({ children }: { children: ReactNode }) => createElement(ClientContext.Provider, { value: client, children });
    render(<FileList recordingId="R1" files={[file({ state: 'missing' })]} />, { wrapper });
    expect(screen.getByRole('button', { name: /Download/ })).toBeDisabled();
  });
});
