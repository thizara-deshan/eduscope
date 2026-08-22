import type { UploadFilePart, UploadMetadata } from '@eduscope/shared';

export type UploadFailureClass = 'connectivity' | 'server' | 'permanent';
export interface UploadFailure { readonly class: UploadFailureClass; readonly detail: string }
export interface ResumeCheckpoint { readonly offset: number; readonly token: string | null }
export interface PartManifest { readonly partId: string; readonly remoteFileId: string; readonly bytesTotal: number; readonly checksum: string | null }
export interface UploadAdapter {
  readonly id: 'placeholder';
  readonly capabilities: { readonly resume: true };
  createLecture(metadata: UploadMetadata): Promise<{ remoteLectureId: string }>;
  uploadPart(input: { remoteLectureId: string; part: UploadFilePart; stream: NodeJS.ReadableStream; checkpoint: ResumeCheckpoint; onCheckpoint(next: ResumeCheckpoint): Promise<void> }): Promise<{ remoteFileId: string; checkpoint: ResumeCheckpoint }>;
  completeLecture(remoteLectureId: string, manifest: readonly PartManifest[]): Promise<void>;
  deleteLecture(remoteLectureId: string): Promise<void>;
}

export class UploadAdapterError extends Error {
  constructor(readonly failure: UploadFailure) { super(failure.detail); this.name = 'UploadAdapterError'; }
  static fromStatus(status: number, detail: string): UploadAdapterError {
    return new UploadAdapterError({ class: status >= 500 || status === 408 || status === 429 ? 'server' : 'permanent', detail });
  }
}
