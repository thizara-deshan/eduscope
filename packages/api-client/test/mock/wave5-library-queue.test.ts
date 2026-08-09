import { describe, expect, it } from 'vitest';
import type {
  EventEnvelope, ExportJobPayload, RecordingArtifactPayload, UploadJobPayload, UsbVolumesPayload,
} from '@eduscope/shared';
import { createMockClient } from '../../src/mock/create-mock-client.js';
import { createVirtualClock } from '../../src/mock/clock.js';

function eventsOf<T>(client: ReturnType<typeof createMockClient>, event: string) {
  const seen: T[] = [];
  client.events$.subscribe((e: EventEnvelope) => {
    if (e.event === event) seen.push(e.payload as T);
  });
  return seen;
}

async function loginAdmin(client: ReturnType<typeof createMockClient>) {
  await client.login({ username: 'admin', password: 'battery-staple', client: 'panel' });
}

async function loginOtherLecturer(client: ReturnType<typeof createMockClient>) {
  await client.login({ username: 'n.silva', password: 'temp-pass-1', client: 'panel' });
}

describe('Wave 5, Task 2 — mock resolving-event emits + per-request recording authorization', () => {
  it('deleteRecording (admin) emits one recording.artifact{deleted, deleteReason:admin}', async () => {
    const client = createMockClient('happy');
    await loginAdmin(client);
    const artifacts = eventsOf<RecordingArtifactPayload>(client, 'recording.artifact');

    const page = await client.listRecordings({});
    const target = page.items[0]!;
    await client.deleteRecording(target.id);

    const matching = artifacts.filter((a) => a.recordingId === target.id);
    expect(matching).toHaveLength(1);
    expect(matching[0]).toMatchObject({ state: 'deleted', deleteReason: 'admin' });

    client.dispose();
  });

  it('retryMergeRecording (admin) on a mergeState:failed row emits recording.artifact{state:merging, mergeState:running}', async () => {
    const client = createMockClient('happy');
    await loginAdmin(client);
    const artifacts = eventsOf<RecordingArtifactPayload>(client, 'recording.artifact');

    const page = await client.listRecordings({});
    const failedRow = page.items.find((r) => r.mergeState === 'failed')!;
    expect(failedRow).toBeDefined();
    await client.retryMergeRecording(failedRow.id);

    const matching = artifacts.filter((a) => a.recordingId === failedRow.id);
    expect(matching).toHaveLength(1);
    expect(matching[0]).toMatchObject({ state: 'merging', mergeState: 'running' });

    client.dispose();
  });

  it('requeueUploadJob (admin) on the dead-letter job emits upload.job{state:queued} for that recording', async () => {
    const client = createMockClient('happy');
    await loginAdmin(client);
    const jobs = eventsOf<UploadJobPayload>(client, 'upload.job');

    const page = await client.listUploadJobs({});
    const deadLetter = page.items.find((j) => j.state === 'dead-letter')!;
    expect(deadLetter).toBeDefined();
    await client.requeueUploadJob(deadLetter.id);

    const matching = jobs.filter((j) => j.jobId === deadLetter.id);
    expect(matching).toHaveLength(1);
    expect(matching[0]).toMatchObject({ state: 'queued', recordingId: deadLetter.recordingId });

    client.dispose();
  });

  it('cancelExport emits export.job{state:cancelled}', async () => {
    const client = createMockClient('happy');
    const exportJobs = eventsOf<ExportJobPayload>(client, 'export.job');

    const targets = await client.listExportTargets();
    const drive = targets.find((v) => v.freeBytes > 1_000_000_000)!;
    const page = await client.listRecordings({});
    const job = await client.createExport({ recordingIds: [page.items[0]!.id], targetDevicePath: drive.devicePath });
    await client.cancelExport(job.id);

    const matching = exportJobs.filter((e) => e.jobId === job.id && e.state === 'cancelled');
    expect(matching).toHaveLength(1);

    client.dispose();
  });

  it('listExportTargets emits a usb.volumes snapshot matching the seed drives', async () => {
    const client = createMockClient('happy');
    const volumeEvents = eventsOf<UsbVolumesPayload>(client, 'usb.volumes');

    const targets = await client.listExportTargets();
    expect(volumeEvents.length).toBeGreaterThanOrEqual(1);
    expect(volumeEvents[volumeEvents.length - 1]!.volumes).toEqual(targets);

    client.dispose();
  });

  it('getRecording 403s a lecturer who is not the owner; resolves for the owner and for admin', async () => {
    const client = createMockClient('happy');
    const page = await client.listRecordings({});
    const owned = page.items[0]!;
    await expect(client.getRecording(owned.id)).resolves.toMatchObject({ id: owned.id });

    await loginOtherLecturer(client);
    await expect(client.getRecording(owned.id)).rejects.toMatchObject({ problem: { status: 403 } });

    await loginAdmin(client);
    await expect(client.getRecording(owned.id)).resolves.toMatchObject({ id: owned.id });

    client.dispose();
  });

  it('getRecordingMedia 403s a non-owner lecturer', async () => {
    const client = createMockClient('happy');
    const page = await client.listRecordings({});
    const owned = page.items[0]!;
    const detail = await client.getRecording(owned.id);
    const fileId = detail.files[0]!.id;

    await loginOtherLecturer(client);
    await expect(client.getRecordingMedia(owned.id, fileId)).rejects.toMatchObject({ problem: { status: 403 } });

    client.dispose();
  });
});

describe('Wave 5, Task 3 — live export progression + recordingsPresent/exportOutcome world knobs', () => {
  it('happy: createExport drives export.job queued -> copying (bytes increasing) -> completed', async () => {
    const clock = createVirtualClock('2026-08-08T09:00:00.000Z');
    const client = createMockClient('happy', { clock });
    const events = eventsOf<ExportJobPayload>(client, 'export.job');

    const targets = await client.listExportTargets();
    const drive = targets.find((v) => v.freeBytes > 1_000_000_000)!;
    const page = await client.listRecordings({});
    const job = await client.createExport({ recordingIds: [page.items[0]!.id], targetDevicePath: drive.devicePath });

    clock.advance(3_000);

    const copying = events.filter((e) => e.jobId === job.id && e.state === 'copying');
    expect(copying.length).toBeGreaterThan(1);
    const increasing = copying.every((e, i) => i === 0 || e.bytesCopied >= copying[i - 1]!.bytesCopied);
    expect(increasing).toBe(true);

    const completed = events.find((e) => e.jobId === job.id && e.state === 'completed');
    expect(completed).toBeDefined();
    expect(completed!.bytesCopied).toBe(completed!.bytesTotal);

    client.dispose();
  });

  it("exportOutcome:'drive-removed' terminates with a named failure short of full copy", async () => {
    const clock = createVirtualClock('2026-08-08T09:00:00.000Z');
    const client = createMockClient('happy', { clock, seed: { exportOutcome: 'drive-removed' } });
    const events = eventsOf<ExportJobPayload>(client, 'export.job');

    const targets = await client.listExportTargets();
    const drive = targets.find((v) => v.freeBytes > 1_000_000_000)!;
    const page = await client.listRecordings({});
    const job = await client.createExport({ recordingIds: [page.items[0]!.id], targetDevicePath: drive.devicePath });

    clock.advance(3_000);

    const terminal = events.find((e) => e.jobId === job.id && e.state === 'failed');
    expect(terminal).toBeDefined();
    expect(terminal!.error).toMatch(/removed/i);
    expect(terminal!.bytesCopied).toBeLessThan(terminal!.bytesTotal);

    client.dispose();
  });

  it('recordingsPresent:false empties listRecordings (lecturer) and listUploadJobs (admin)', async () => {
    const client = createMockClient('happy', { seed: { recordingsPresent: false } });
    await loginAdmin(client);

    const recordings = await client.listRecordings({});
    expect(recordings).toEqual({ items: [], nextCursor: null });

    const jobs = await client.listUploadJobs({});
    expect(jobs.items).toEqual([]);

    client.dispose();
  });
});
