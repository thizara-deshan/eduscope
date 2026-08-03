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
});
