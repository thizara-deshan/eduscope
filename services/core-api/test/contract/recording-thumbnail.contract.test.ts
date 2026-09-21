import { describe, expect, it } from 'vitest';
import { readOpenApiSource } from './harness.js';

describe('getRecordingThumbnail contract', () => {
  it('declares authenticated JPEG success plus owner/not-found Problems', () => {
    const source = readOpenApiSource();
    const start = source.indexOf('operationId: getRecordingThumbnail');
    const end = source.indexOf('\n  /', start);
    const operation = source.slice(start, end);
    expect(start).toBeGreaterThan(0);
    expect(operation).toContain('image/jpeg');
    expect(operation).toContain("'403': { $ref: '#/components/responses/Problem' }");
    expect(operation).toContain("'404': { $ref: '#/components/responses/Problem' }");
  });
});
