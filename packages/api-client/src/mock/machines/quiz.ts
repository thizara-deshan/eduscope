import { PAYLOAD_BUILDERS, nextUlid, type MockWorld } from '../world.js';
import { alert, emit, fire, set, t } from './helpers.js';
import type { MachineDef } from './types.js';

/**
 * Machine 4a (device-side `QuizSession` projection) and 4d (the device ↔
 * quiz-service sync link). Machines 4b/4c (`QuizParticipant`, per-student
 * answer state) are quiz-service's own writes (state-machines §0.2,
 * SM-R-1) — apps/quiz mocks those, not this core-api adapter.
 */

// ── 4a — QuizSession (device-side projection) ───────────────────────────────

const M_SESSION = 'quiz.session' as const;
// Declared here (not only beside the 4d block below) because the 4a
// `quiz.session` payload builder reads the 4d sync state for CG-19's `syncState`.
const M_SYNC = 'quiz.sync' as const;
const citeA = (n: string) => `state-machines §5.1 ${n}`;

export const quizSessionMachine: MachineDef = {
  id: M_SESSION,
  initial: 'absent',
  terminal: ['closed'],
  transitions: [
    t(M_SESSION, 'Z-01', ['absent'], 'requesting', citeA('Z-01'),
      emit('quiz.session'),
      fire('Z-02', 1_200)),

    t(M_SESSION, 'Z-02', ['requesting'], 'open', citeA('Z-02'),
      set('quiz.session.joinCode', '482913'),
      set('quiz.session.joinUrl', 'https://quiz.eduscope.local/j/482913'),
      emit('quiz.session')),

    t(M_SESSION, 'Z-03', ['requesting'], 'failed', citeA('Z-03'),
      emit('quiz.session'),
      alert('quiz.unavailable', 'error')),

    t(M_SESSION, 'Z-04', ['failed'], 'requesting', citeA('Z-04'),
      emit('quiz.session'),
      fire('Z-02', 1_200)),

    t(M_SESSION, 'Z-05', ['open'], 'closed', citeA('Z-05'),
      emit('quiz.session')),

    t(M_SESSION, 'Z-06', ['open'], 'failed', citeA('Z-06'),
      emit('quiz.session'),
      alert('quiz.sync-failed', 'error')),
  ],
};

PAYLOAD_BUILDERS['quiz.session'] = (w: MockWorld) => ({
  state: w.state(M_SESSION),
  quizSessionId: (w.data['quiz.session.ulid'] as string | undefined) ?? null,
  joinUrl: (w.data['quiz.session.joinUrl'] as string | undefined) ?? null,
  joinCode: (w.data['quiz.session.joinCode'] as string | undefined) ?? null,
  joinedCount: (w.data['quiz.session.joinedCount'] as number | undefined) ?? 0,
  // CG-19 (v0.4): the WS payload now mirrors QuizSessionProjection.syncState, so
  // the joined-count staleness is knowable live and not only on a REST snapshot.
  // Sourced from the 4d sync machine — the same value rest/quiz.ts's
  // getQuizSession already reads — so REST and WS agree by construction.
  syncState: w.state(M_SYNC),
});

// ── 4d — device ↔ quiz-service sync link (QZ-7) ─────────────────────────────
// `M_SYNC` is declared up beside `M_SESSION` — the 4a payload builder needs it.

const citeD = (n: string) => `state-machines §5.4 ${n}`;

export const quizSyncMachine: MachineDef = {
  id: M_SYNC,
  initial: 'synced',
  terminal: [],
  transitions: [
    t(M_SYNC, 'Z-30', ['synced'], 'stale', citeD('Z-30'),
      // CG-19: also surface the staleness on `quiz.session` so S-20's joined-count
      // goes stale LIVE, not only on the next REST snapshot. The builder reads the
      // now-`stale` 4d state (effects run after the state is set — world.apply).
      emit('quiz.session'),
      emit('quiz.publication', { syncState: 'stale' }),
      emit('quiz.responses', { stale: true })),

    t(M_SYNC, 'Z-31', ['stale'], 'synced', citeD('Z-31'),
      emit('quiz.session'),
      emit('quiz.responses', { stale: false }),
      emit('quiz.publication', { syncState: 'synced' })),

    t(M_SYNC, 'Z-32', ['stale'], 'failed', citeD('Z-32'),
      alert('quiz.sync-stale', 'error')),

    t(M_SYNC, 'Z-33', ['failed'], 'synced', citeD('Z-33'),
      emit('quiz.responses', { stale: false }),
      alert('cleared', 'info')),
  ],
};

PAYLOAD_BUILDERS['quiz.responses'] = (w: MockWorld) => ({
  publicationId: (w.data['ai.publication.questionId'] as string | undefined) ?? nextUlid(w),
  deltas: [],
  syncedAt: w.clock.nowIso(),
  stale: false,
});
