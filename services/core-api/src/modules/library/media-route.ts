import { createReadStream, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { ProblemError } from '../../contracts/problem.js';
import { parseBody } from '../../contracts/validate.js';
import type { DrizzleDb } from '../../db/client.js';
import { lectureSessions, recordingFiles, recordings } from '../../db/schema.js';
import { requireAuth } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';

export interface MediaRouteDeps {
  db: DrizzleDb;
  recordingsRoot: string;
}

const zMediaQuery = z.object({
  download: z.union([z.boolean(), z.literal('true'), z.literal('false')]).optional(),
});

interface ByteRange {
  start: number;
  end: number;
}

/** `Range: bytes=start-end` / `bytes=start-` / `bytes=-suffixLength` (single range only — the panel player never sends multipart ranges). Returns `null` for anything malformed or unsatisfiable against `size`. */
function parseRange(header: string, size: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startStr, endStr] = match;
  if (startStr === '' && endStr === '') return null;

  let start: number;
  let end: number;
  if (startStr === '') {
    const suffixLength = Number(endStr);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(startStr);
    end = endStr === '' ? size - 1 : Number(endStr);
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || end >= size) return null;
  return { start, end };
}

/** Only a path that resolves at or below the active recordings mount is ever opened — a defense against a corrupted/foreign `recording_files.path` row. */
function isUnderMount(recordingsRoot: string, path: string): boolean {
  const root = resolve(recordingsRoot);
  const target = resolve(path);
  return target === root || target.startsWith(root + sep);
}

function sanitizeFilenameSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9 _.-]/g, '_').trim();
  return cleaned.length > 0 ? cleaned : 'recording';
}

/** `getRecordingMedia` (openapi.yaml, design/core-api.md §5.4): per-request owner-or-admin authz (INV-RC-6), HTTP Range (200/206), `?download=1` attachment disposition. Closes B-37 — the physical path never appears in a header or a Problem. */
export function registerMediaRoutes(app: FastifyInstance, authService: AuthService, deps: MediaRouteDeps): void {
  app.get(
    '/api/v1/recordings/:recordingId/files/:fileId/media',
    { config: { operationId: 'getRecordingMedia' }, preHandler: requireAuth(authService, 'getRecordingMedia') },
    async (request, reply) => {
      const { recordingId, fileId } = request.params as { recordingId: string; fileId: string };
      const { download } = parseBody(zMediaQuery, request.query);
      const actor = request.authContext!;

      const recording = deps.db.select().from(recordings).where(eq(recordings.id, recordingId)).get();
      if (!recording) {
        throw new ProblemError(404, 'not-found', 'Recording not found');
      }
      if (actor.role !== 'admin' && recording.ownerUserId !== actor.userId) {
        throw new ProblemError(403, 'not-authorized', 'Only the recording owner or an admin may access this media');
      }

      const file = deps.db
        .select()
        .from(recordingFiles)
        .where(and(eq(recordingFiles.id, fileId), eq(recordingFiles.recordingId, recordingId)))
        .get();
      if (!file || file.state === 'deleted' || file.state === 'missing') {
        throw new ProblemError(404, 'not-found', 'Media file not found');
      }
      if (!isUnderMount(deps.recordingsRoot, file.path)) {
        throw new ProblemError(404, 'not-found', 'Media file not found');
      }

      let size: number;
      try {
        size = statSync(file.path).size;
      } catch {
        throw new ProblemError(404, 'not-found', 'Media file not found');
      }

      const contentType = file.container === 'mp4' ? 'video/mp4' : 'video/mp2t';
      reply.header('Accept-Ranges', 'bytes');

      if (download === true || download === 'true') {
        const session = deps.db.select({ title: lectureSessions.title }).from(lectureSessions).where(eq(lectureSessions.id, recording.sessionId)).get();
        const extension = file.container === 'mp4' ? 'mp4' : 'ts';
        const filename = `${sanitizeFilenameSegment(session?.title ?? 'recording')}-${sanitizeFilenameSegment(file.streamKey)}.${extension}`;
        reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      }

      const rangeHeader = request.headers.range;
      if (rangeHeader === undefined) {
        reply.code(200).header('Content-Type', contentType).header('Content-Length', size);
        return reply.send(createReadStream(file.path));
      }

      const range = parseRange(rangeHeader, size);
      if (range === null) {
        reply.header('Content-Range', `bytes */${size}`);
        throw new ProblemError(416, 'validation.invalid', 'Requested range not satisfiable');
      }

      reply
        .code(206)
        .header('Content-Type', contentType)
        .header('Content-Length', range.end - range.start + 1)
        .header('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
      return reply.send(createReadStream(file.path, { start: range.start, end: range.end }));
    },
  );
}
