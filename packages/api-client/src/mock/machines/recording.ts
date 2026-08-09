import { TIMERS } from '@eduscope/shared';
import {
  PAYLOAD_BUILDERS, TRANSITION_DATA_REDUCERS, nextUlid, type MockWorld,
} from '../world.js';
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

/** state-machines §1.2 — non-terminal = a session is live (starting|recording|paused|stopping|finalizing). Shared by CG-15 (updateAudioControl) and CG-16/R-22 (powerOffDevice). */
export function isRecordingNonTerminal(w: MockWorld): boolean {
  return !recordingMachine.terminal.includes(w.state(M)) && w.state(M) !== recordingMachine.initial;
}

function numberData(w: MockWorld, path: string): number {
  const value = w.data[path];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function openSegment(w: MockWorld): void {
  const now = w.clock.now();
  if (typeof w.data['session.startedAt'] !== 'string') {
    w.data['session.startedAt'] = new Date(now).toISOString();
  }
  w.data['session.currentSegmentStartedAtMs'] = now;
  w.data['session.segmentIndex'] = numberData(w, 'session.segmentIndex') + 1;
  w.data['session.segmentCount'] = numberData(w, 'session.segmentCount') + 1;
}

function closeSegment(w: MockWorld): void {
  const openedAt = w.data['session.currentSegmentStartedAtMs'];
  if (typeof openedAt !== 'number') return;
  const durationMs = Math.max(0, w.clock.now() - openedAt);
  w.data['session.recordedDurationMs'] = numberData(w, 'session.recordedDurationMs') + durationMs;
  w.data['session.lastSegmentDurationMs'] = durationMs;
  delete w.data['session.currentSegmentStartedAtMs'];
}

TRANSITION_DATA_REDUCERS['R-01'] = (w) => {
  w.data['session.ulid'] = nextUlid(w);
  w.data['recording.ulid'] = nextUlid(w);
  w.data['session.startedAt'] = null;
  w.data['session.recordedDurationMs'] = 0;
  w.data['session.segmentIndex'] = 0;
  w.data['session.segmentCount'] = 0;
  w.data['session.pauseCount'] = 0;
  delete w.data['session.currentSegmentStartedAtMs'];
  delete w.data['session.lastSegmentDurationMs'];
};
// W4-D-1: record-start is machine 4a's Z-01 guard moment (recording ∧ configured ∧
// AI enabled) and machine 2a's Q-01 arm. Schedule them here — gated by the seed
// flags bootstrapFromSeed stamped — rather than as unconditional `fire` effects, so
// an AI-disabled or quiz-unavailable world stays absent/unavailable. Idempotent by
// the machines' own `from` guards (Q-01 only from `unavailable`, Z-01 only from
// `absent`), so a second R-05 (e.g. after a resume path) cannot double-arm.
TRANSITION_DATA_REDUCERS['R-05'] = (w) => {
  openSegment(w);
  if (w.data['ai.enabledAtStart'] === true && w.state('ai.countdown') === 'unavailable') {
    w.schedule('Q-01', 400);
  }
  if (w.data['quiz.available'] === true && w.state('quiz.session') === 'absent') {
    w.schedule('Z-01', 400);
  }
};
TRANSITION_DATA_REDUCERS['R-17'] = openSegment;
for (const transition of ['R-08', 'R-09'] as const) {
  TRANSITION_DATA_REDUCERS[transition] = (w) => {
    closeSegment(w);
    w.data['session.pauseCount'] = numberData(w, 'session.pauseCount') + 1;
  };
}
for (const transition of ['R-12', 'R-13', 'R-16'] as const) {
  TRANSITION_DATA_REDUCERS[transition] = closeSegment;
}

PAYLOAD_BUILDERS['recording.state'] = (w: MockWorld) => ({
  state: w.state(M),
  startReason: (w.data['session.startReason'] as string | undefined) ?? null,
  sessionId: (w.data['session.ulid'] as string | undefined) ?? null,
  title: (w.data['session.title'] as string | undefined) ?? null,
  ownerUserId: (w.data['session.ownerUserId'] as string | undefined) ?? null,
  ownerDisplayName: (w.data['session.ownerDisplayName'] as string | undefined) ?? null,
  // The wire field is the active elapsed-time anchor while capturing. The
  // canonical first-segment instant remains in session.startedAt for the
  // persisted lecture row; a pending resume/recovery deliberately exposes no
  // active anchor, so the panel renders Starting… rather than counting a gap.
  startedAt: w.state(M) === 'starting'
    ? null
    : w.state(M) === 'recording' && typeof w.data['session.currentSegmentStartedAtMs'] === 'number'
      ? new Date(w.data['session.currentSegmentStartedAtMs']).toISOString()
      : (w.data['session.startedAt'] as string | undefined) ?? null,
  recordedDurationMs: (w.data['session.recordedDurationMs'] as number | undefined) ?? null,
  segmentIndex: (w.data['session.segmentIndex'] as number | undefined) ?? null,
  segmentCount: (w.data['session.segmentCount'] as number | undefined) ?? null,
  pauseCount: (w.data['session.pauseCount'] as number | undefined) ?? null,
  takeoverBy: (w.data['session.takeoverBy'] as string | undefined) ?? null,
  // v0.3, CG-14 — set alongside takeoverBy by rest/recording.ts's
  // takeoverRecording BEFORE R-21 is scheduled (S06-D-4); R-21 itself does not
  // touch ownerUserId (C-1) and carries no per-call data to set these from.
  takeoverAt: (w.data['session.takeoverAt'] as string | undefined) ?? null,
  takeoverByDisplayName: (w.data['session.takeoverByDisplayName'] as string | undefined) ?? null,
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
  durationMs: ['R-08', 'R-09', 'R-12', 'R-13', 'R-16'].includes(tr.id)
    ? numberData(w, 'session.lastSegmentDurationMs')
    : null,
  __cite: tr.cite,
});

/**
 * Stub for machine 1b (RA-01..07, state-machines.md §2) — full merge
 * supervision, upload-job creation, and retention are out of scope for this
 * scaffold and deferred to a future phase. This exists only so R-14/R-15
 * (which the verbatim machine 1a table above already emits
 * `recording.artifact` from) don't crash the mock for lack of a builder.
 */
PAYLOAD_BUILDERS['recording.artifact'] = (w: MockWorld) => ({
  recordingId: (w.data['recording.ulid'] as string | undefined) ?? nextUlid(w),
  sessionId: (w.data['session.ulid'] as string | undefined) ?? nextUlid(w),
  state: w.state(M) === 'completed' ? 'ready' : 'failed',
  mergeState: w.state(M) === 'completed' ? 'done' : 'failed',
  durationMs: null,
  totalBytes: null,
  deleteReason: null,
});
