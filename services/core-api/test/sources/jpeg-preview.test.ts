import { describe, expect, it, vi } from 'vitest';
import { PipelineManagerClient } from '../../src/modules/recording/pm/client.js';
import { PipelineManagerError } from '../../src/modules/recording/pm/types.js';

describe('pipeline-manager JPEG preview boundary', () => {
  it('authenticates, validates content type, and returns bytes', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
      headers: { 'content-type': 'image/jpeg' },
    }));
    const pm = new PipelineManagerClient({ baseUrl: 'http://127.0.0.1:8091', bearerToken: 'secret', fetchImpl });
    await expect(pm.getJpegThumbnail('lecturer-cam')).resolves.toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:8091/consumers/thumbnails/lecturer-cam.jpg',
      { headers: { authorization: 'Bearer secret' } },
    );
  });

  it('rejects a non-JPEG upstream response', async () => {
    const pm = new PipelineManagerClient({
      baseUrl: 'http://127.0.0.1:8091', bearerToken: 'secret',
      fetchImpl: async () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
    });
    await expect(pm.getJpegThumbnail('presentation')).rejects.toBeInstanceOf(PipelineManagerError);
  });
});
