import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import type { UploadFilePart, UploadMetadata } from '@eduscope/shared';
import { PlaceholderUploadAdapter } from '../../src/modules/uploads/adapters/placeholder.js';
import { UploadAdapterError, type ResumeCheckpoint } from '../../src/modules/uploads/adapters/types.js';
import { UploadFixtureServer } from '../fakes/upload-fixture-server.js';

const servers: UploadFixtureServer[] = [];
const metadata: UploadMetadata = { title: 'Mechanical placeholder', hallCode: 'H-1', startedAt: '2026-07-08T00:00:00.000Z', endedAt: '2026-07-08T01:00:00.000Z', recordedDurationMs: 3_600_000, files: [{ streamKey: 'main', sizeBytes: 150_000, durationMs: 3_600_000, checksum: null }] };
const part: UploadFilePart = { id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', uploadJobId: '01ARZ3NDEKTSV4RRFFQ69G5FAW', recordingFileId: '01ARZ3NDEKTSV4RRFFQ69G5FAX', streamKey: 'main', state: 'pending', bytesTotal: 150_000, bytesSent: 0, attempt: 0, lastError: null };

afterEach(async () => { for (const server of servers.splice(0)) await server.close(); });
async function fixture() { const server = new UploadFixtureServer(); servers.push(server); return { server, adapter: new PlaceholderUploadAdapter({ baseUrl: await server.listen() }) }; }

describe('placeholder resumable upload adapter', () => {
  it('creates one lecture, uploads multiple parts, and completes a manifest without institute fields', async () => {
    const { server, adapter } = await fixture();
    const { remoteLectureId } = await adapter.createLecture(metadata);
    const checkpoints: ResumeCheckpoint[] = [];
    const result = await adapter.uploadPart({ remoteLectureId, part, stream: Readable.from(Buffer.alloc(150_000, 7)), checkpoint: { offset: 0, token: null }, onCheckpoint: async (next) => { checkpoints.push(next); } });
    const second = { ...part, id: '01ARZ3NDEKTSV4RRFFQ69G5FAY', recordingFileId: '01ARZ3NDEKTSV4RRFFQ69G5FAZ', streamKey: 'slides', bytesTotal: 10 };
    const secondResult = await adapter.uploadPart({ remoteLectureId, part: second, stream: Readable.from(Buffer.alloc(10, 8)), checkpoint: { offset: 0, token: null }, onCheckpoint: async () => {} });
    await adapter.completeLecture(remoteLectureId, [{ partId: part.id, remoteFileId: result.remoteFileId, bytesTotal: part.bytesTotal, checksum: null }, { partId: second.id, remoteFileId: secondResult.remoteFileId, bytesTotal: second.bytesTotal, checksum: null }]);
    expect(server.lectures).toHaveLength(1);
    expect(server.lectures.get(remoteLectureId)!.parts.get(part.recordingFileId)).toHaveLength(150_000);
    expect(server.lectures.get(remoteLectureId)!.parts.get(second.recordingFileId)).toHaveLength(10);
    expect(checkpoints.length).toBeGreaterThan(1);
    expect(server.completions).toBe(1);
    expect(server.payloadKeys.some((key) => /institute|course|faculty|student/i.test(key))).toBe(false);
  });

  it('resumes after a network cut from the durable offset without duplicate bytes or lecture creation', async () => {
    const { server, adapter } = await fixture();
    server.cutOnPatch(2);
    const { remoteLectureId } = await adapter.createLecture(metadata);
    let checkpoint: ResumeCheckpoint = { offset: 0, token: null };
    await expect(adapter.uploadPart({ remoteLectureId, part, stream: Readable.from(Buffer.alloc(150_000, 3)), checkpoint, onCheckpoint: async (next) => { checkpoint = next; } })).rejects.toMatchObject({ failure: { class: 'connectivity' } });
    const restarted = new PlaceholderUploadAdapter({ baseUrl: adapter.baseUrl });
    const result = await restarted.uploadPart({ remoteLectureId, part, stream: Readable.from(Buffer.alloc(150_000, 3)), checkpoint, onCheckpoint: async (next) => { checkpoint = next; } });
    expect(result.checkpoint.offset).toBe(150_000);
    expect(server.lectures).toHaveLength(1);
    expect(server.lectures.get(remoteLectureId)!.parts.get(part.recordingFileId)).toHaveLength(150_000);
  });

  it('deletes a partial remote lecture before retry', async () => {
    const { server, adapter } = await fixture();
    const { remoteLectureId } = await adapter.createLecture(metadata);
    await adapter.deleteLecture(remoteLectureId);
    expect(server.lectures.get(remoteLectureId)!.deleted).toBe(true);
  });

  it('exposes structural connectivity, server, and permanent failures', async () => {
    const connectivity = new PlaceholderUploadAdapter({ baseUrl: 'http://127.0.0.1:1' });
    await expect(connectivity.createLecture(metadata)).rejects.toMatchObject({ failure: { class: 'connectivity' } });
    for (const [status, failureClass] of [[500, 'server'], [422, 'permanent']] as const) {
      const error = UploadAdapterError.fromStatus(status, 'opaque');
      expect(error.failure.class).toBe(failureClass);
    }
  });

  it('classifies a remote checksum mismatch as permanent', async () => {
    const { server, adapter } = await fixture();
    const { remoteLectureId } = await adapter.createLecture(metadata);
    server.failNextPatch(422, 'checksum-mismatch');
    await expect(adapter.uploadPart({ remoteLectureId, part, stream: Readable.from(Buffer.alloc(150_000)), checkpoint: { offset: 0, token: null }, onCheckpoint: async () => {} })).rejects.toMatchObject({ failure: { class: 'permanent' } });
  });
});
