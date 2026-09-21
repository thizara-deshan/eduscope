import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import type { EduscopeClient } from '@eduscope/api-client';
import { ClientContext } from '../../client/client-provider.js';
import { RecordingThumbnail } from './recording-thumbnail.js';

describe('<RecordingThumbnail/>', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('fetches the authenticated JPEG and releases its object URL on unmount', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const getRecordingThumbnail = vi.fn(async () => new Blob(['jpeg'], { type: 'image/jpeg' }));
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:thumbnail');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const client = { getRecordingThumbnail } as unknown as EduscopeClient;

    const { container, unmount } = render(
      <ClientContext.Provider value={client}>
        <RecordingThumbnail recordingId="recording-1" />
      </ClientContext.Provider>,
    );

    await waitFor(() => expect(getRecordingThumbnail).toHaveBeenCalledWith('recording-1'));
    await waitFor(() => expect(container.querySelector('img')).toHaveAttribute('src', 'blob:thumbnail'));
    expect(createObjectURL).toHaveBeenCalledOnce();
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:thumbnail');
  });
});
