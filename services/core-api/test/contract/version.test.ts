import { describe, expect, it } from 'vitest';
import { PANEL_EVENT_NAMES, PANEL_OPERATION_IDS, SERVER_SIDE_ONLY_OPERATION_IDS, zEventEnvelope } from '@eduscope/shared';
import {
  assertV1Contracts,
  extractInfoVersion,
  readEventsSource,
  readOpenApiSource,
  readQuizAppSource,
  sampleEventEnvelope,
} from './harness.js';

describe('v1.0.0 contract baseline', () => {
  it('openapi.yaml declares info.version 1.0.0', () => {
    expect(extractInfoVersion(readOpenApiSource())).toBe('1.0.0');
  });

  it('quiz-app.yaml declares info.version 1.0.0', () => {
    expect(extractInfoVersion(readQuizAppSource())).toBe('1.0.0');
  });

  it('events.md declares Contract **v1.0.0**', () => {
    expect(readEventsSource()).toContain('Contract **v1.0.0**');
  });

  it('parses one zEventEnvelope', () => {
    expect(() => zEventEnvelope.parse(sampleEventEnvelope)).not.toThrow();
  });

  it('partitions exactly 78 panel operations, 4 server-side-only operations, and 22 panel events', () => {
    expect(PANEL_OPERATION_IDS.length).toBe(78);
    expect(SERVER_SIDE_ONLY_OPERATION_IDS.length).toBe(4);
    expect(PANEL_EVENT_NAMES.length).toBe(22);
  });

  it('assertV1Contracts passes against the current repository contract files', () => {
    expect(() => assertV1Contracts()).not.toThrow();
  });
});
