import { TIMERS } from '@eduscope/shared';
import { PAYLOAD_BUILDERS, nextUlid, type MockWorld } from '../world.js';
import { alert, emit, fire, set, t } from './helpers.js';
import type { MachineDef, Transition } from './types.js';

const M = 'recording' as const;
const cite = (n: string) => `state-machines §1.2 ${n}`;

/**
 * Machine 1a. `idle` is the absence of a non-terminal LectureSession, not a row.
 * Every entry into `recording` opens exactly one segment; every exit closes one
 * (SEG-1). `error` means nothing was captured (SM-R-4) — a truncated 50-minute
 * lecture still ends `completed`.
 */
export const recordingMachine: MachineDef = {
  id: M,
  initial: 'idle',
  terminal: ['completed', 'error'],
  transitions: [
    t(M, 'R-01', ['idle'], 'starting', cite('R-01'),
      set('session.id', 'PENDING'),
      set('session.startReason', 'initial'),
      emit('recording.state'),
      fire('R-05', 1_200)),

    t(M, 'R-02', ['idle'], null, cite('R-02'),
      alert('storage.critical', 'error'),
      emit('recording.state')),

    t(M, 'R-03', ['idle'], null, cite('R-03'),
      emit('recording.state')),

    t(M, 'R-04', ['idle'], null, cite('R-04'),
      alert('config.invalid', 'error'),
      emit('recording.state')),

    t(M, 'R-05', ['starting'], 'recording', cite('R-05'),
      set('session.segmentOpen', true),
      emit('recording.state'),
      emit('recording.segment', { state: 'capturing', endReason: null }),
      emit('ai.countdown'),
      emit('quiz.session')),

    t(M, 'R-06', ['starting'], 'error', cite('R-06'),
      set('session.errorCode', 'capture.start-failed'),
      emit('recording.state'),
      alert('recording.start-failed', 'error')),

    t(M, 'R-07', ['starting'], 'stopping', cite('R-07'),
      emit('recording.state'),
      alert('recording.resume-failed', 'error'),
      fire('R-12', TIMERS['T-STOP-EOS'] / 4)),

    t(M, 'R-08', ['recording'], 'paused', cite('R-08'),
      set('session.segmentOpen', false),
      emit('recording.state'),
      emit('recording.segment', { state: 'finalized', endReason: 'pause' }),
      emit('ai.countdown')),

    t(M, 'R-09', ['recording'], 'paused', cite('R-09'),
      emit('recording.state'),
      emit('recording.segment', { state: 'truncated', endReason: 'pause' }),
      alert('recording.truncated', 'error')),

    t(M, 'R-10', ['paused'], 'starting', cite('R-10'),
      set('session.startReason', 'resume'),
      emit('recording.state'),
      fire('R-05', 800)),

    t(M, 'R-11', ['recording', 'paused'], 'stopping', cite('R-11'),
      emit('recording.state'),
      emit('ai.countdown'),
      emit('quiz.session'),
      fire('R-12', 900)),

    t(M, 'R-12', ['stopping'], 'finalizing', cite('R-12'),
      emit('recording.state'),
      emit('recording.segment', { state: 'finalized', endReason: 'stop' }),
      fire('R-14', 1_400)),

    t(M, 'R-13', ['stopping'], 'finalizing', cite('R-13'),
      emit('recording.state'),
      emit('recording.segment', { state: 'truncated', endReason: 'stop' }),
      alert('recording.stop-timeout', 'error'),
      fire('R-14', 1_400)),

    t(M, 'R-14', ['finalizing'], 'completed', cite('R-14'),
      emit('recording.state'),
      emit('recording.artifact', { state: 'merging', mergeState: 'running' })),

    t(M, 'R-15', ['finalizing'], 'error', cite('R-15'),
      set('session.errorCode', 'capture.empty'),
      emit('recording.state'),
      emit('recording.artifact', { state: 'failed', mergeState: 'failed' }),
      alert('recording.empty', 'error')),

    t(M, 'R-16', ['recording'], 'starting', cite('R-16'),
      set('session.startReason', 'recovery'),
      emit('recording.segment', { state: 'truncated', endReason: 'crash' }),
      emit('recording.state'),
      alert('recording.pipeline-lost', 'error'),
      fire('R-17', TIMERS['T-CONSUMER-RESTART'] ?? 1_000)),

    t(M, 'R-17', ['starting'], 'recording', cite('R-17'),
      emit('recording.state'),
      emit('recording.segment', { state: 'capturing', endReason: null })),

    t(M, 'R-18', ['starting'], 'stopping', cite('R-18'),
      alert('recording.unrecoverable', 'error'),
      emit('recording.state'),
      fire('R-12', 900)),

    t(M, 'R-19', ['recording'], 'stopping', cite('R-19'),
      alert('storage.critical', 'error'),
      emit('recording.state'),
      fire('R-12', 900)),

    t(M, 'R-20', ['recording'], null, cite('R-20'),
      emit('storage.status', { pressure: 'warning' }),
      alert('storage.warning', 'warning')),

    t(M, 'R-21', ['*'], null, cite('R-21'),
      emit('recording.state')),

    t(M, 'R-22', ['*'], null, cite('R-22'),
      alert('poweroff.refused', 'info')),
  ],
};

PAYLOAD_BUILDERS['recording.state'] = (w: MockWorld) => ({
  state: w.state(M),
  startReason: (w.data['session.startReason'] as string | undefined) ?? null,
  sessionId: (w.data['session.ulid'] as string | undefined) ?? null,
  title: (w.data['session.title'] as string | undefined) ?? null,
  ownerUserId: (w.data['session.ownerUserId'] as string | undefined) ?? null,
  ownerDisplayName: (w.data['session.ownerDisplayName'] as string | undefined) ?? null,
  startedAt: (w.data['session.startedAt'] as string | undefined) ?? null,
  recordedDurationMs: (w.data['session.recordedDurationMs'] as number | undefined) ?? null,
  segmentIndex: (w.data['session.segmentIndex'] as number | undefined) ?? null,
  segmentCount: (w.data['session.segmentCount'] as number | undefined) ?? null,
  pauseCount: (w.data['session.pauseCount'] as number | undefined) ?? null,
  takeoverBy: (w.data['session.takeoverBy'] as string | undefined) ?? null,
  errorCode: (w.data['session.errorCode'] as string | undefined) ?? null,
  errorMessage: (w.data['session.errorMessage'] as string | undefined) ?? null,
});

PAYLOAD_BUILDERS['recording.segment'] = (w: MockWorld, tr: Transition) => ({
  sessionId: (w.data['session.ulid'] as string) ?? nextUlid(w),
  recordingId: (w.data['recording.ulid'] as string) ?? nextUlid(w),
  segmentId: nextUlid(w),
  index: (w.data['session.segmentIndex'] as number | undefined) ?? 0,
  state: 'capturing',
  endReason: null,
  durationMs: null,
  __cite: tr.cite,
});
