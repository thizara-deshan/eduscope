import { beforeEach, describe, expect, it } from 'vitest';
import { useTelemetryStore, useWsStore } from './ws-store.js';

const envelope = (event: string, payload: unknown, seq: number) =>
  ({ event, at: '2026-07-30T09:00:00+00:00', seq, payload }) as never;

describe('ws store', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
  });

  it('ingests recording.state into the recording slice', () => {
    useWsStore.getState().ingest(
      envelope('recording.state', { state: 'recording', sessionId: null }, 0),
    );
    expect(useWsStore.getState().recording?.state).toBe('recording');
  });

  it('keys sources.status by roleId rather than replacing the map', () => {
    const s = useWsStore.getState();
    s.ingest(envelope('sources.status', { roleId: 'lecturer-cam', state: 'online' }, 0));
    s.ingest(envelope('sources.status', { roleId: 'mic-lecturer', state: 'offline' }, 1));
    expect(Object.keys(useWsStore.getState().sources)).toEqual([
      'lecturer-cam',
      'mic-lecturer',
    ]);
  });

  it('flags a seq gap for a FULL resync — never a partial patch (events.md §1)', () => {
    const s = useWsStore.getState();
    s.ingest(envelope('recording.state', { state: 'idle' }, 0));
    s.ingest(envelope('recording.state', { state: 'recording' }, 5));
    expect(useWsStore.getState().needsResync).toBe(true);
  });

  it('marks live regions stale after T-WS-STALE but KEEPS the recording slice', () => {
    const s = useWsStore.getState();
    s.ingest(envelope('recording.state', { state: 'recording' }, 0));
    s.setConnection({ phase: 'stale', attempt: 3, since: '2026-07-30T09:00:10+00:00' });
    const after = useWsStore.getState();
    expect(after.stale).toBe(true);
    // The device is still recording; hiding the frame would be the dangerous lie.
    expect(after.recording?.state).toBe('recording');
  });

  it('never buffers commands — the store holds no outbound queue', () => {
    expect(Object.keys(useWsStore.getState())).not.toContain('pendingCommands');
  });

  it('notifies subscribers exactly ONCE per envelope', () => {
    let notifications = 0;
    const unsub = useWsStore.subscribe(() => {
      notifications += 1;
    });
    useWsStore.getState().ingest(envelope('recording.state', { state: 'recording' }, 0));
    unsub();
    expect(notifications).toBe(1);
  });

  it('keeps audio levels OUT of the application store', () => {
    useWsStore.getState().ingest(
      envelope('audio.levels', { roleId: 'mic-lecturer', rms: 0.4 }, 0),
    );
    expect(Object.keys(useWsStore.getState())).not.toContain('audioLevels');
    expect(useTelemetryStore.getState().audioLevels['mic-lecturer']).toBe(0.4);
  });

  it('does not notify the application store for telemetry', () => {
    let notifications = 0;
    const unsub = useWsStore.subscribe(() => {
      notifications += 1;
    });
    for (let i = 0; i < 20; i += 1) {
      useWsStore.getState().ingest(
        envelope('audio.levels', { roleId: 'mic-lecturer', rms: 0.4 }, i),
      );
    }
    unsub();
    expect(notifications, '10 Hz telemetry must not wake the UI store').toBe(0);
  });

  it('drops cleared alerts rather than growing forever on a weeks-long uptime', () => {
    const s = useWsStore.getState();
    s.ingest(envelope('system.alert', { id: 'A1', code: 'source.offline', clearedAt: null }, 0));
    expect(Object.keys(useWsStore.getState().alerts)).toEqual(['A1']);
    s.ingest(
      envelope(
        'system.alert',
        { id: 'A1', code: 'source.offline', clearedAt: '2026-07-30T09:01:00+00:00' },
        1,
      ),
    );
    expect(useWsStore.getState().alerts).toEqual({});
  });

  it('ingests recording.artifact keyed by recordingId', () => {
    useWsStore.getState().ingest(envelope('recording.artifact', {
      recordingId: 'R1', sessionId: 'S1', state: 'deleted', mergeState: 'done',
      durationMs: null, totalBytes: null, deleteReason: 'disk-pressure',
    }, 0));
    expect(useWsStore.getState().artifacts['R1']?.state).toBe('deleted');
  });

  it('ingests upload.job keyed by recordingId and export.job by jobId', () => {
    useWsStore.getState().ingest(envelope('upload.job', {
      jobId: 'J1', recordingId: 'R2', state: 'queued', attempt: 0,
      failureClass: null, nextAttemptAt: null, progressPct: 0, lastError: null, blockedBy: null,
    }, 1));
    useWsStore.getState().ingest(envelope('export.job', {
      jobId: 'E1', state: 'copying', bytesCopied: 10, bytesTotal: 100, error: null,
    }, 2));
    expect(useWsStore.getState().uploadJobs['R2']?.state).toBe('queued');
    expect(useWsStore.getState().exportJobs['E1']?.bytesCopied).toBe(10);
  });

  it('ingests usb.volumes as the latest list', () => {
    useWsStore.getState().ingest(envelope('usb.volumes', { volumes: [] }, 3));
    expect(useWsStore.getState().usbVolumes?.volumes).toEqual([]);
  });

  it('ingests firmware.state as the latest full read view', () => {
    useWsStore.getState().ingest(envelope('firmware.state', {
      id: 'F1', currentVersion: '2026.1.3', availableVersion: '2026.2.0',
      state: 'downloading', signatureVerified: true, rollbackVersion: '2026.1.2',
      startedAt: null, finishedAt: null, lastError: null,
    }, 0));
    expect(useWsStore.getState().firmware?.state).toBe('downloading');
  });

  it('appends log.entry to a bounded tail (max 200, newest last)', () => {
    for (let i = 0; i < 205; i += 1) {
      useWsStore.getState().ingest(envelope('log.entry', {
        id: `L${i}`, at: '2026-08-10T09:00:00.000Z', level: 'INFO', category: 'System',
        service: 'core-api', message: `m${i}`, sessionId: null, userId: null, context: null,
      }, i + 1));
    }
    const tail = useWsStore.getState().logTail;
    expect(tail).toHaveLength(200);
    expect(tail[tail.length - 1]?.id).toBe('L204');
  });

  it('records deviceHealthAt when device.health arrives', () => {
    useWsStore.getState().ingest(envelope('device.health', {
      captureCardState: 'present', publisherStates: {}, ntpSynced: true,
      clockOffsetMs: 0, diskHealth: 'good', lastBootAt: '2026-08-10T06:00:00.000Z',
    }, 300));
    expect(useWsStore.getState().deviceHealthAt).not.toBeNull();
  });
});

describe('ws store — domain-scoped resync reset (E-03)', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
  });

  it('clears ONLY the given domains, leaving other domains untouched', () => {
    const s = useWsStore.getState();
    s.ingest(envelope('system.alert', { id: 'A1', code: 'x', severity: 'warning' }, 0));
    s.ingest(envelope('channel.state', { channelId: 'meeting', state: 'idle' }, 1));
    s.ingest(envelope('storage.status', { pressure: 'nominal' }, 2));

    useWsStore.getState().resetDomains(['alerts']);
    const after = useWsStore.getState();
    expect(after.alerts).toEqual({}); // alerts domain reset
    expect(Object.keys(after.channels)).toEqual(['meeting']); // channels untouched
    expect(after.storage).not.toBeNull(); // storage untouched
  });

  it('retains the recording chrome but marks it stale', () => {
    const s = useWsStore.getState();
    s.ingest(envelope('recording.state', { state: 'recording' }, 0));
    s.ingest(envelope('recording.segment', { state: 'closed', path: '/x.ts' }, 1));

    useWsStore.getState().resetDomains(['recording']);
    const after = useWsStore.getState();
    // The device is still recording — the chrome stays, flagged stale.
    expect(after.recording?.state).toBe('recording');
    expect(after.stale).toBe(true);
    // The closed-segment marker is cleared for the fresh snapshot.
    expect(after.lastSegment).toBeNull();
  });

  it('resets the sequence tracker so the fresh snapshot is not seen as a gap', () => {
    const s = useWsStore.getState();
    s.ingest(envelope('system.alert', { id: 'A1', code: 'x', severity: 'warning' }, 40));
    useWsStore.getState().resetDomains(['alerts']);
    expect(useTelemetryStore.getState().lastSeq).toBe(-1);
    // A snapshot restarting at any seq is contiguous again (no false gap).
    useWsStore.getState().ingest(envelope('system.alert', { id: 'A2', code: 'y', severity: 'info' }, 0));
    expect(useWsStore.getState().needsResync).toBe(false);
  });

  it('never introduces an outbound command queue', () => {
    useWsStore.getState().resetDomains(['recording', 'alerts']);
    expect(Object.keys(useWsStore.getState())).not.toContain('pendingCommands');
  });
});
