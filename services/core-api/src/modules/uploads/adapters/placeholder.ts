import type { UploadMetadata } from '@eduscope/shared';
import { UploadAdapterError, type PartManifest, type ResumeCheckpoint, type UploadAdapter } from './types.js';

const CHUNK_BYTES = 64 * 1024;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
export interface PlaceholderUploadAdapterOptions { baseUrl: string; fetch?: typeof globalThis.fetch }

export class PlaceholderUploadAdapter implements UploadAdapter {
  readonly id = 'placeholder' as const;
  readonly capabilities = { resume: true } as const;
  readonly baseUrl: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #controllers = new Set<AbortController>();
  constructor(options: PlaceholderUploadAdapterOptions) {
    const url = new URL(options.baseUrl);
    if (url.protocol !== 'https:' && !LOOPBACK.has(url.hostname)) throw new UploadAdapterError({ class: 'permanent', detail: 'non-loopback upload URLs require HTTPS' });
    this.baseUrl = url.toString().replace(/\/$/, '');
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async createLecture(metadata: UploadMetadata): Promise<{ remoteLectureId: string }> {
    const response = await this.#request('/lectures', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(metadata) });
    return await response.json() as { remoteLectureId: string };
  }

  async uploadPart(input: Parameters<UploadAdapter['uploadPart']>[0]): Promise<{ remoteFileId: string; checkpoint: ResumeCheckpoint }> {
    let checkpoint = input.checkpoint;
    let sourceOffset = 0;
    let remoteFileId = '';
    for await (const value of input.stream as AsyncIterable<Uint8Array | string>) {
      const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
      let cursor = 0;
      if (sourceOffset + buffer.length <= checkpoint.offset) { sourceOffset += buffer.length; continue; }
      if (sourceOffset < checkpoint.offset) cursor = checkpoint.offset - sourceOffset;
      while (cursor < buffer.length) {
        const chunk = buffer.subarray(cursor, Math.min(cursor + CHUNK_BYTES, buffer.length));
        const response = await this.#request(`/lectures/${encodeURIComponent(input.remoteLectureId)}/parts/${encodeURIComponent(input.part.recordingFileId)}`, { method: 'PATCH', headers: { 'content-type': 'application/octet-stream', 'upload-offset': String(checkpoint.offset), ...(checkpoint.token ? { 'upload-token': checkpoint.token } : {}) }, body: new Blob([Uint8Array.from(chunk)]) });
        const ack = await response.json() as { offset: number; token: string | null; remoteFileId: string };
        if (ack.offset !== checkpoint.offset + chunk.length) throw new UploadAdapterError({ class: 'permanent', detail: 'remote checkpoint offset mismatch' });
        checkpoint = { offset: ack.offset, token: ack.token };
        remoteFileId = ack.remoteFileId;
        await input.onCheckpoint(checkpoint);
        cursor += chunk.length;
      }
      sourceOffset += buffer.length;
    }
    if (checkpoint.offset !== input.part.bytesTotal) throw new UploadAdapterError({ class: 'permanent', detail: `part ended at ${checkpoint.offset}, expected ${input.part.bytesTotal}` });
    return { remoteFileId, checkpoint };
  }

  async completeLecture(remoteLectureId: string, manifest: readonly PartManifest[]): Promise<void> {
    await this.#request(`/lectures/${encodeURIComponent(remoteLectureId)}/complete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ parts: manifest }) });
  }
  async deleteLecture(remoteLectureId: string): Promise<void> { await this.#request(`/lectures/${encodeURIComponent(remoteLectureId)}`, { method: 'DELETE' }); }
  abortCurrent(): void { for (const controller of this.#controllers) controller.abort(); }

  async #request(path: string, init: RequestInit): Promise<Response> {
    let response: Response;
    const controller = new AbortController();
    this.#controllers.add(controller);
    try { response = await this.#fetch(`${this.baseUrl}${path}`, { ...init, signal: controller.signal }); }
    catch (error) { throw new UploadAdapterError({ class: 'connectivity', detail: error instanceof Error ? error.message : 'network unavailable' }); }
    finally { this.#controllers.delete(controller); }
    if (!response.ok) {
      const detail = await response.text().catch(() => `HTTP ${response.status}`);
      throw UploadAdapterError.fromStatus(response.status, detail || `HTTP ${response.status}`);
    }
    return response;
  }
}
