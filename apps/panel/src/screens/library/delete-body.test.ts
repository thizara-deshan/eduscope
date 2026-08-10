import { describe, expect, it } from 'vitest';
import { deleteBody } from './delete-body.js';

describe('deleteBody (S-24 §2/C-1) — pure body selection', () => {
  it('uploaded -> calm body + "uploaded" tag', () => {
    const result = deleteBody({ uploadState: 'done' });
    expect(result.escalated).toBe(false);
    expect(result.metaTag).toBe('uploaded');
    expect(result.body).toMatch(/permanently removes/);
  });

  it('uploadState failed -> escalated body + "never uploaded" tag', () => {
    const result = deleteBody({ uploadState: 'failed' });
    expect(result.escalated).toBe(true);
    expect(result.metaTag).toBe('never uploaded');
    expect(result.body).toMatch(/only copy/);
  });

  it('uploadState null -> escalated body + "never uploaded" tag', () => {
    const result = deleteBody({ uploadState: null });
    expect(result.escalated).toBe(true);
    expect(result.metaTag).toBe('never uploaded');
  });

  it('uploadState uploading -> inFlight true', () => {
    expect(deleteBody({ uploadState: 'uploading' }).inFlight).toBe(true);
    expect(deleteBody({ uploadState: 'queued' }).inFlight).toBe(true);
    expect(deleteBody({ uploadState: 'completing' }).inFlight).toBe(true);
    expect(deleteBody({ uploadState: 'done' }).inFlight).toBe(false);
  });
});
