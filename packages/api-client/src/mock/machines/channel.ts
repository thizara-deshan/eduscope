import { PAYLOAD_BUILDERS, type MockWorld } from '../world.js';
import { alert, emit, fire, t } from './helpers.js';
import type { MachineDef, Transition } from './types.js';

const cite = (n: string) => `state-machines §2.2 ${n}`;

/**
 * Machine 1c. `local` is not modeled here — the local channel *is* the record
 * consumer (machine 1a); toggling meeting/streaming starts/stops only that
 * consumer, and publishers/the record consumer are untouched (INV-CC-2).
 *
 * The doc's transition table (CH-01…CH-10) is written once, generically, for
 * "the channel consumer" — but this mock keeps one singleton `MachineDef`
 * (and one runtime state) per channel id, and transition ids must be globally
 * unique (world.ts keys them in one flat map; machines.test.ts asserts no
 * duplicates). CH-04's own doc row already wires `fire('CH-05', 700)`, which
 * fixes canonical CH-05…CH-10 to `channel:meeting`. `channel:streaming`
 * mirrors that same shared tail under distinct ids (`CH-05S`…`CH-10S`) so a
 * demo can toggle streaming through a full on/off cycle too; each mirror
 * cites the doc row it reimplements.
 */
export const meetingChannelMachine: MachineDef = {
  id: 'channel:meeting',
  initial: 'off',
  terminal: [],
  transitions: [
    t('channel:meeting', 'CH-04', ['off'], 'starting', cite('CH-04'),
      emit('channel.state'),
      fire('CH-05', 700)),

    t('channel:meeting', 'CH-05', ['starting'], 'on', cite('CH-05'),
      emit('channel.state')),

    t('channel:meeting', 'CH-06', ['starting'], 'failed', cite('CH-06'),
      emit('channel.state'),
      alert('channel.start-failed', 'error')),

    t('channel:meeting', 'CH-07', ['on'], 'stopping', cite('CH-07'),
      emit('channel.state'),
      fire('CH-08', 500)),

    t('channel:meeting', 'CH-08', ['stopping'], 'off', cite('CH-08'),
      emit('channel.state')),

    t('channel:meeting', 'CH-09', ['on'], 'starting', cite('CH-09'),
      emit('channel.state'),
      alert('channel.restarting', 'warning'),
      fire('CH-05', 700)),

    t('channel:meeting', 'CH-10', ['failed'], 'off', cite('CH-10'),
      emit('channel.state')),
  ],
};

export const streamingChannelMachine: MachineDef = {
  id: 'channel:streaming',
  initial: 'off',
  terminal: [],
  transitions: [
    t('channel:streaming', 'CH-01', ['off'], 'preflight', cite('CH-01'),
      emit('channel.state'),
      fire('CH-02', 900)),

    t('channel:streaming', 'CH-02', ['preflight'], 'starting', cite('CH-02'),
      emit('channel.state'),
      fire('CH-05S', 700)),

    t('channel:streaming', 'CH-03', ['preflight'], 'failed', cite('CH-03'),
      emit('channel.state'),
      alert('streaming.preflight-failed', 'warning')),

    // Mirrors of the shared CH-05..CH-10 tail (canonical ids live on
    // `channel:meeting` — see the module comment above).
    t('channel:streaming', 'CH-05S', ['starting'], 'on', cite('CH-05'),
      emit('channel.state')),

    t('channel:streaming', 'CH-06S', ['starting'], 'failed', cite('CH-06'),
      emit('channel.state'),
      alert('channel.start-failed', 'error')),

    t('channel:streaming', 'CH-07S', ['on'], 'stopping', cite('CH-07'),
      emit('channel.state'),
      fire('CH-08S', 500)),

    t('channel:streaming', 'CH-08S', ['stopping'], 'off', cite('CH-08'),
      emit('channel.state')),

    t('channel:streaming', 'CH-09S', ['on'], 'starting', cite('CH-09'),
      emit('channel.state'),
      alert('channel.restarting', 'warning'),
      fire('CH-05S', 700)),

    t('channel:streaming', 'CH-10S', ['failed'], 'off', cite('CH-10'),
      emit('channel.state')),
  ],
};

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
