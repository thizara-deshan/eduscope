import { PAYLOAD_BUILDERS, type MockWorld } from '../world.js';
import { alert, emit, fire, set, t } from './helpers.js';
import type { MachineDef, Transition, TransitionId } from './types.js';

const cite = (n: string) => `state-machines §2.2 ${n}`;

/**
 * Machine 1c. `local` is not modeled here — the local channel *is* the record
 * consumer (machine 1a); toggling meeting/streaming starts/stops only that
 * consumer, and publishers/the record consumer are untouched (INV-CC-2).
 *
 * `channel:meeting` owns the canonical CH-04..CH-10 ids; `channel:streaming`
 * reimplements the shared CH-05..CH-10 tail under `CH-05S`..`CH-10S` — see
 * index.ts's module comment for why, and use `channelTransitionId()` below
 * rather than hand-building ids.
 */
export const meetingChannelMachine: MachineDef = {
  id: 'channel:meeting',
  initial: 'off',
  terminal: [],
  transitions: [
    t('channel:meeting', 'CH-04', ['off'], 'starting', cite('CH-04'),
      set('channel.meeting.reason', null),
      emit('channel.state'),
      fire('CH-05', 700)),

    t('channel:meeting', 'CH-05', ['starting'], 'on', cite('CH-05'),
      set('channel.meeting.reason', null),
      emit('channel.state')),

    t('channel:meeting', 'CH-06', ['starting'], 'failed', cite('CH-06'),
      set('channel.meeting.reason', 'The output consumer did not start.'),
      emit('channel.state'),
      alert('channel.start-failed', 'error')),

    t('channel:meeting', 'CH-07', ['on'], 'stopping', cite('CH-07'),
      emit('channel.state'),
      fire('CH-08', 500)),

    t('channel:meeting', 'CH-08', ['stopping'], 'off', cite('CH-08'),
      set('channel.meeting.reason', null),
      emit('channel.state')),

    t('channel:meeting', 'CH-09', ['on'], 'starting', cite('CH-09'),
      set('channel.meeting.reason', 'The output stopped unexpectedly and is restarting.'),
      emit('channel.state'),
      alert('channel.restarting', 'warning'),
      fire('CH-05', 700)),

    t('channel:meeting', 'CH-10', ['failed'], 'off', cite('CH-10'),
      set('channel.meeting.reason', null),
      emit('channel.state')),
  ],
};

export const streamingChannelMachine: MachineDef = {
  id: 'channel:streaming',
  initial: 'off',
  terminal: [],
  transitions: [
    t('channel:streaming', 'CH-01', ['off'], 'preflight', cite('CH-01'),
      set('channel.streaming.reason', null),
      emit('channel.state'),
      fire('CH-02', 900)),

    t('channel:streaming', 'CH-02', ['preflight'], 'starting', cite('CH-02'),
      emit('channel.state'),
      fire('CH-05S', 700)),

    t('channel:streaming', 'CH-03', ['preflight'], 'failed', cite('CH-03'),
      set('channel.streaming.reason', 'The streaming destination could not be reached. Your lecture is still recording.'),
      emit('channel.state'),
      alert('streaming.preflight-failed', 'warning')),

    // Mirrors of the shared CH-05..CH-10 tail (canonical ids live on
    // `channel:meeting` — see the module comment above).
    t('channel:streaming', 'CH-05S', ['starting'], 'on', cite('CH-05'),
      set('channel.streaming.reason', null),
      emit('channel.state')),

    t('channel:streaming', 'CH-06S', ['starting'], 'failed', cite('CH-06'),
      set('channel.streaming.reason', 'The output consumer did not start.'),
      emit('channel.state'),
      alert('channel.start-failed', 'error')),

    t('channel:streaming', 'CH-07S', ['on'], 'stopping', cite('CH-07'),
      emit('channel.state'),
      fire('CH-08S', 500)),

    t('channel:streaming', 'CH-08S', ['stopping'], 'off', cite('CH-08'),
      set('channel.streaming.reason', null),
      emit('channel.state')),

    t('channel:streaming', 'CH-09S', ['on'], 'starting', cite('CH-09'),
      set('channel.streaming.reason', 'The output stopped unexpectedly and is restarting.'),
      emit('channel.state'),
      alert('channel.restarting', 'warning'),
      fire('CH-05S', 700)),

    t('channel:streaming', 'CH-10S', ['failed'], 'off', cite('CH-10'),
      set('channel.streaming.reason', null),
      emit('channel.state')),
  ],
};

/** CH-01..CH-03 are streaming-only entry states; every other bare id is owned by `channel:meeting`. */
const STREAMING_OWN_BARE_IDS = new Set(['CH-01', 'CH-02', 'CH-03']);

/**
 * Resolve a *bare* doc id (`'CH-05'`) to the id actually registered for a
 * given channel — `'CH-05'` for `meeting`, `'CH-05S'` for `streaming`. Use
 * this instead of hand-building ids so callers don't have to know which
 * channel owns the canonical string.
 */
export function channelTransitionId(
  channelId: 'meeting' | 'streaming',
  bareId: string,
): TransitionId {
  if (channelId === 'meeting' || STREAMING_OWN_BARE_IDS.has(bareId)) return bareId;
  return `${bareId}S`;
}

PAYLOAD_BUILDERS['channel.state'] = (w: MockWorld, tr: Transition) => {
  const channelId = tr.machine === 'channel:streaming' ? 'streaming' : 'meeting';
  return {
    channelId,
    state: w.state(tr.machine),
    presetId: (w.data[`channel.${channelId}.presetId`] as string | undefined) ?? 'fifty-fifty',
    ratioA: (w.data[`channel.${channelId}.ratioA`] as number | undefined) ?? null,
    ratioB: (w.data[`channel.${channelId}.ratioB`] as number | undefined) ?? null,
    reason: (w.data[`channel.${channelId}.reason`] as string | undefined) ?? null,
  };
};
