import { describe, expect, it } from 'vitest';
import type { EventEnvelope, RecordingArtifactPayload, UploadJobPayload } from '@eduscope/shared';
import { createMockClient } from '../../src/mock/create-mock-client.js';
import { createVirtualClock } from '../../src/mock/clock.js';
import { listScenarios } from '../../src/mock/scenario/registry.js';

function eventsOf<T>(client: ReturnType<typeof createMockClient>, event: string) {
  const seen: T[] = [];
  client.events$.subscribe((e: EventEnvelope) => {
    if (e.event === event) seen.push(e.payload as T);
  });
  return seen;
}

describe('Wave 5, Task 4 — scenario emits primitive: usb-pull, wan-loss, disk-full retention removal', () => {
  it('wan-loss emits an upload.job failure for the uploading job (connectivity, no attempt spent)', () => {
    const clock = createVirtualClock('2026-08-08T09:00:00.000Z');
    const client = createMockClient('wan-loss', { clock });
    const jobs = eventsOf<UploadJobPayload>(client, 'upload.job');

    clock.advance(2_500);

    const failure = jobs.find((j) => j.state === 'failed');
    expect(failure).toBeDefined();
    expect(failure!.failureClass).toBe('connectivity');
    expect(failure!.attempt).toBe(0);

    client.dispose();
  });

  it('disk-full emits a recording.artifact deletion for a seed recording (disk-pressure)', () => {
    const clock = createVirtualClock('2026-08-08T09:00:00.000Z');
    const client = createMockClient('disk-full', { clock });
    const artifacts = eventsOf<RecordingArtifactPayload>(client, 'recording.artifact');

    clock.advance(3_500);

    const removed = artifacts.find((a) => a.state === 'deleted' && a.deleteReason === 'disk-pressure');
    expect(removed).toBeDefined();

    client.dispose();
  });

  it("usb-pull's worldSeed.exportOutcome is 'drive-removed'", () => {
    const client = createMockClient('usb-pull');
    expect(client.worldSeed.exportOutcome).toBe('drive-removed');
    client.dispose();
  });

  it('listScenarios includes usb-pull and wan-loss', () => {
    const names = listScenarios().map((s) => s.name);
    expect(names).toContain('usb-pull');
    expect(names).toContain('wan-loss');
  });
});
