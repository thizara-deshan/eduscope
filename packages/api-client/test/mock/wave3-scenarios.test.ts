import { describe, expect, it } from 'vitest';
import type { ChannelId, EventEnvelope, SourcesStatusPayload } from '@eduscope/shared';
import type { ChannelSnapshot } from '../../src/client.js';
import { createMockClient } from '../../src/mock/create-mock-client.js';
import { createVirtualClock, type VirtualClock } from '../../src/mock/clock.js';
import { TransportError } from '../../src/errors.js';

function channelOf(rows: readonly ChannelSnapshot[], channelId: ChannelId): ChannelSnapshot {
  return rows.find((r) => r.config.channelId === channelId)!;
}

describe('Wave 3 — channel-failures scenario and World overrides', () => {
  it('studentsCameraBound:false reports students-cam unbound in REST and the initial WS snapshot', async () => {
    const client = createMockClient('happy', { seed: { studentsCameraBound: false } });
    const statuses = await client.getSourcesStatus();
    expect(statuses.find((s) => s.roleId === 'students-cam')?.state).toBe('unbound');

    const row = client.world.snapshot().find(
      (e): e is EventEnvelope & { payload: SourcesStatusPayload } => (
        e.event === 'sources.status' && (e.payload as SourcesStatusPayload).roleId === 'students-cam'
      ),
    );
    expect(row?.payload.state).toBe('unbound');
    client.dispose();
  });

  it('streamTargetsConfigured:false returns no targets and an empty streaming streamTargetIds', async () => {
    const client = createMockClient('happy', { seed: { streamTargetsConfigured: false } });
    await client.login({ username: 'admin', password: 'battery-staple', client: 'panel' });
    const targets = await client.listStreamTargets();
    expect(targets).toEqual([]);
    const rows = await client.listChannels();
    expect(channelOf(rows, 'streaming').config.streamTargetIds).toEqual([]);
    client.dispose();
  });

  it('the first meeting enable reaches failed with a named reason; disable returns to off; the second reaches on', async () => {
    const clock = createVirtualClock('2026-08-08T09:00:00.000Z');
    const client = createMockClient('channel-failures', { clock });

    await client.startRecording();
    clock.advance(1_500);
    expect(client.world.state('recording')).toBe('recording');

    await client.enableChannel('meeting');
    clock.advance(900); // CH-04 (150ms), then the intercepted CH-05 -> CH-06 (700ms)
    let meeting = channelOf(await client.listChannels(), 'meeting');
    expect(meeting.status.state).toBe('failed');
    expect(meeting.status.reason).toBe('The output consumer did not start.');

    await client.disableChannel('meeting');
    clock.advance(200); // CH-10 (failed consumer -> off), never CH-07
    meeting = channelOf(await client.listChannels(), 'meeting');
    expect(meeting.status.state).toBe('off');

    await client.enableChannel('meeting');
    clock.advance(900); // second occurrence: the real CH-04 -> CH-05 chain
    meeting = channelOf(await client.listChannels(), 'meeting');
    expect(meeting.status.state).toBe('on');
    client.dispose();
  });

  it('the first streaming enable reaches preflight, then a named preflight failure; recording stays recording', async () => {
    const clock = createVirtualClock('2026-08-08T09:00:00.000Z');
    const client = createMockClient('channel-failures', { clock });

    await client.startRecording();
    clock.advance(1_500);

    await client.enableChannel('streaming');
    clock.advance(200);
    let streaming = channelOf(await client.listChannels(), 'streaming');
    expect(streaming.status.state).toBe('preflight');

    clock.advance(1_000); // the intercepted CH-02 -> CH-03 (preflight -> failed)
    streaming = channelOf(await client.listChannels(), 'streaming');
    expect(streaming.status.state).toBe('failed');
    expect(streaming.status.reason).toBe(
      'The streaming destination could not be reached. Your lecture is still recording.',
    );
    expect(client.world.state('recording')).toBe('recording');
    client.dispose();
  });

  it('updateChannelConfig fails at transport, then a named 422, then succeeds', async () => {
    const client = createMockClient('channel-failures');
    await expect(
      client.updateChannelConfig('local', { presetId: 'side-by-side' }),
    ).rejects.toBeInstanceOf(TransportError);

    await expect(
      client.updateChannelConfig('local', { presetId: 'side-by-side' }),
    ).rejects.toMatchObject({
      problem: { status: 422, code: 'config.invalid', title: 'This layout could not be applied.' },
    });

    const saved = await client.updateChannelConfig('local', { presetId: 'side-by-side' });
    expect(saved.presetId).toBe('side-by-side');
    client.dispose();
  }, 10_000);

  it('createStreamTarget fails at transport, then a named 422, then succeeds', async () => {
    const client = createMockClient('channel-failures');
    await client.login({ username: 'admin', password: 'battery-staple', client: 'panel' });
    const body = {
      platform: 'youtube' as const, displayName: 'Overflow', ingestUrl: 'rtmp://a.rtmp.youtube.com/live2', streamKey: 'k',
    };
    await expect(client.createStreamTarget(body)).rejects.toBeInstanceOf(TransportError);

    await expect(client.createStreamTarget(body)).rejects.toMatchObject({
      problem: { status: 422, code: 'validation.invalid', title: 'The streaming destination rejected these settings.' },
    });

    const created = await client.createStreamTarget(body);
    expect(created.displayName).toBe('Overflow');
    client.dispose();
  }, 10_000);

  it('CH-09 emits starting with the restart reason, then returns to on (meeting)', async () => {
    const clock = createVirtualClock('2026-08-08T09:00:00.000Z');
    const client = createMockClient('channel-failures', { clock });
    await client.startRecording();
    clock.advance(1_500);

    await client.enableChannel('meeting'); // consumes the CH-05 -> CH-06 rule
    clock.advance(900);
    await client.disableChannel('meeting');
    clock.advance(200);
    await client.enableChannel('meeting'); // real CH-05 this time -> on
    clock.advance(900);
    expect(channelOf(await client.listChannels(), 'meeting').status.state).toBe('on');

    client.world.apply('CH-09');
    let meeting = channelOf(await client.listChannels(), 'meeting');
    expect(meeting.status.state).toBe('starting');
    expect(meeting.status.reason).toBe('The output stopped unexpectedly and is restarting.');

    clock.advance(800); // CH-09's own fire('CH-05', 700) — the rule's only occurrence is spent
    meeting = channelOf(await client.listChannels(), 'meeting');
    expect(meeting.status.state).toBe('on');
    client.dispose();
  });

  it('CH-09S emits starting with the restart reason, then returns to on (streaming)', async () => {
    const clock = createVirtualClock('2026-08-08T09:00:00.000Z') as VirtualClock;
    const client = createMockClient('channel-failures', { clock });
    await client.startRecording();
    clock.advance(1_500);

    await client.enableChannel('streaming'); // consumes the CH-02 -> CH-03 rule
    clock.advance(1_200);
    await client.disableChannel('streaming');
    clock.advance(200);
    await client.enableChannel('streaming'); // real preflight -> starting -> on this time
    clock.advance(1_900);
    expect(channelOf(await client.listChannels(), 'streaming').status.state).toBe('on');

    client.world.apply('CH-09S');
    let streaming = channelOf(await client.listChannels(), 'streaming');
    expect(streaming.status.state).toBe('starting');
    expect(streaming.status.reason).toBe('The output stopped unexpectedly and is restarting.');

    clock.advance(800); // CH-09S's own fire('CH-05S', 700)
    streaming = channelOf(await client.listChannels(), 'streaming');
    expect(streaming.status.state).toBe('on');
    client.dispose();
  });
});
