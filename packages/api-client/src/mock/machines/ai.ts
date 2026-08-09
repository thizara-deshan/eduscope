import { TIMERS } from '@eduscope/shared';
import { PAYLOAD_BUILDERS, nextUlid, type MockWorld } from '../world.js';
import { alert, emit, fire, set, t } from './helpers.js';
import type { MachineDef, Transition } from './types.js';

/**
 * Machine 2 — AI QUESTION FLOW is four coupled machines (state-machines.md §3):
 * 2a the session-scoped countdown, 2b the `QuestionSet` batch, 2c the
 * individual `Question` (create/edit/discard/send/close audit contract), and
 * 2d the `QuestionPublication` send-to-projector contract. The doc's own
 * cross-machine triggers (Q-01 fired by R-05, Q-11 fired by Q-02/Q-03, …) are
 * not auto-chained here — same as machine 1a, that sequencing belongs to a
 * scenario driver. Within a machine, `fire()` compresses the doc's real
 * timers (T-LLM-REQUEST = 45s, a 20-minute countdown, …) into demo-scale
 * delays, same as recording.ts.
 */

// ── 2a — AI countdown (session-scoped) ──────────────────────────────────────

const M_COUNTDOWN = 'ai.countdown' as const;
const citeA = (n: string) => `state-machines §3.1 ${n}`;

const DEFAULT_INTERVAL_MINUTES = 20; // A-14/INT-11 default; prototype's 15 is drift.
const DEFAULT_REMAINING_MS = DEFAULT_INTERVAL_MINUTES * 60_000;

export const aiCountdownMachine: MachineDef = {
  id: M_COUNTDOWN,
  initial: 'unavailable',
  terminal: [],
  transitions: [
    t(M_COUNTDOWN, 'Q-01', ['unavailable'], 'armed', citeA('Q-01'),
      set('ai.intervalMinutes', DEFAULT_INTERVAL_MINUTES),
      set('ai.remainingMs', DEFAULT_REMAINING_MS),
      emit('ai.countdown'),
      fire('Q-02', 6_000)),

    // W4-D-2: Q-04/Q-05 are driven by the coupled QuestionSet's own outcome
    // (Q-12/Q-13 below), not by a blind post-request timer — the doc's own
    // triggers are "2b reached ready" (Q-04) and "2b failed" (Q-05), and firing
    // Q-04 unconditionally here would always race ahead of (and mask) a
    // coupled failure.
    t(M_COUNTDOWN, 'Q-02', ['armed'], 'generating', citeA('Q-02'),
      emit('ai.countdown'),
      emit('ai.set', { state: 'requested' }),
      fire('Q-11', 50)), // W4-D-2: drive the QuestionSet lifecycle

    // LP-16: manual generate_now resets the countdown to the full interval —
    // load-bearing, not a cosmetic detail (brief Step 5).
    t(M_COUNTDOWN, 'Q-03', ['armed', 'degraded'], 'generating', citeA('Q-03'),
      set('ai.remainingMs', DEFAULT_REMAINING_MS),
      emit('ai.countdown', { remainingMs: DEFAULT_REMAINING_MS }),
      emit('ai.set', { state: 'requested', trigger: 'manual' }),
      fire('Q-11', 50)), // W4-D-2

    t(M_COUNTDOWN, 'Q-04', ['generating'], 'armed', citeA('Q-04'),
      set('ai.remainingMs', DEFAULT_REMAINING_MS),
      emit('ai.countdown')),

    t(M_COUNTDOWN, 'Q-05', ['generating'], 'degraded', citeA('Q-05'),
      emit('ai.countdown'),
      alert('ai.unavailable', 'error')),

    t(M_COUNTDOWN, 'Q-06', ['degraded'], 'armed', citeA('Q-06'),
      emit('ai.countdown'),
      alert('cleared', 'info')),

    t(M_COUNTDOWN, 'Q-07', ['armed'], 'held', citeA('Q-07'),
      emit('ai.countdown')),

    t(M_COUNTDOWN, 'Q-08', ['held'], 'armed', citeA('Q-08'),
      emit('ai.countdown')),

    t(M_COUNTDOWN, 'Q-09', ['armed', 'held', 'degraded', 'generating'], 'unavailable', citeA('Q-09'),
      emit('ai.countdown')),

    t(M_COUNTDOWN, 'Q-10', ['armed', 'held'], null, citeA('Q-10'),
      set('ai.intervalMinutes', 30),
      set('ai.remainingMs', 30 * 60_000),
      emit('ai.countdown')),
  ],
};

PAYLOAD_BUILDERS['ai.countdown'] = (w: MockWorld) => {
  const remainingMs = (w.data['ai.remainingMs'] as number | undefined) ?? null;
  return {
    state: w.state(M_COUNTDOWN),
    remainingMs,
    nextAt: remainingMs === null ? null : new Date(w.clock.now() + remainingMs).toISOString(),
    intervalMinutes: (w.data['ai.intervalMinutes'] as 10 | 15 | 20 | 30 | undefined) ?? DEFAULT_INTERVAL_MINUTES,
  };
};

// ── 2b — QuestionSet ─────────────────────────────────────────────────────────

const M_SET = 'ai.set' as const;
const citeB = (n: string) => `state-machines §3.2 ${n}`;

/**
 * A lecture produces many `QuestionSet`s (every countdown interval, or on
 * manual generate_now) — `reviewed`/`discarded` end *one* set's lifecycle,
 * not the machine's. `Q-11` (each new set's own creation, doc `Trigger:
 * Q-02/Q-03`) must be able to fire again after a prior cycle finished, so it
 * lists every state explicitly rather than `['requested']` alone — same
 * "creation event, not an exit from a tracked prior state" reasoning as
 * `Q-18`/`Q-19`/`Q-30` elsewhere in this file.
 */
const ANY_SET_STATE = ['requested', 'generating', 'ready', 'failed', 'reviewed', 'discarded'];

export const aiSetMachine: MachineDef = {
  id: M_SET,
  initial: 'requested',
  terminal: ['reviewed', 'discarded'],
  transitions: [
    t(M_SET, 'Q-11', ANY_SET_STATE, 'generating', citeB('Q-11'),
      set('ai.set.trigger', 'countdown'),
      set('ai.set.attempt', 0),
      emit('ai.set'),
      fire('Q-12', TIMERS['T-LLM-REQUEST'] / 15)),

    t(M_SET, 'Q-12', ['generating'], 'ready', citeB('Q-12'),
      set('ai.set.count', 4),
      emit('ai.set', { count: 4 }),
      // N× in the doc; the mock emits one representative draft per set.
      emit('ai.question', { state: 'draft', provenance: 'generated', edited: false }),
      // W4-D-2: this set's own success is 2a's Q-04 trigger ("2b reached ready").
      fire('Q-04', 50)),

    t(M_SET, 'Q-13', ['generating'], 'failed', citeB('Q-13'),
      set('ai.set.error', 'timeout'),
      emit('ai.set', { error: 'timeout' }),
      // W4-D-2: the mock does not auto-fire Q-14's retry (nothing schedules it
      // today), so every Q-13 is "after retries" from 2a's point of view —
      // Q-05's trigger ("2b failed ... after retries").
      fire('Q-05', 50)),

    t(M_SET, 'Q-14', ['failed'], 'generating', citeB('Q-14'),
      set('ai.set.attempt', 1),
      emit('ai.set', { attempt: 1 }),
      fire('Q-12', TIMERS['T-LLM-REQUEST'] / 15)),

    t(M_SET, 'Q-15', ['ready'], 'reviewed', citeB('Q-15'),
      emit('ai.set')),

    t(M_SET, 'Q-16', ['ready'], 'discarded', citeB('Q-16'),
      emit('ai.set', { state: 'discarded' }),
      emit('ai.question', { state: 'discarded' })),

    t(M_SET, 'Q-17', ['ready', 'failed'], 'discarded', citeB('Q-17'),
      emit('ai.set', { state: 'discarded' })),
  ],
};

PAYLOAD_BUILDERS['ai.set'] = (w: MockWorld) => ({
  setId: (w.data['ai.set.ulid'] as string | undefined) ?? nextUlid(w),
  sessionId: (w.data['session.ulid'] as string | undefined) ?? nextUlid(w),
  state: w.state(M_SET),
  trigger: (w.data['ai.set.trigger'] as 'countdown' | 'manual' | undefined) ?? 'countdown',
  count: (w.data['ai.set.count'] as number | undefined) ?? null,
  error: (w.data['ai.set.error'] as 'timeout' | 'unreachable' | 'invalid-payload' | undefined) ?? null,
  attempt: (w.data['ai.set.attempt'] as number | undefined) ?? 0,
});

// ── 2c — Question, the create/edit/discard/send/close audit contract ───────

const M_QUESTION = 'ai.question' as const;
const citeC = (n: string) => `state-machines §3.3 ${n}`;

/** Every non-terminal-in-name state a fresh Question can appear as (Q-18/Q-19 are creation events, not exits from a prior tracked state — see channel.ts's module comment for the same id-uniqueness constraint). */
const ANY_QUESTION_STATE = ['draft', 'discarded', 'sent', 'closed'];

export const aiQuestionMachine: MachineDef = {
  id: M_QUESTION,
  initial: 'draft',
  terminal: ['closed', 'discarded'],
  transitions: [
    t(M_QUESTION, 'Q-18', ANY_QUESTION_STATE, 'draft', citeC('Q-18'),
      emit('ai.question', { state: 'draft', provenance: 'generated', edited: false })),

    t(M_QUESTION, 'Q-19', ANY_QUESTION_STATE, 'draft', citeC('Q-19'),
      emit('ai.question', { state: 'draft', provenance: 'lecturer-authored', edited: false })),

    t(M_QUESTION, 'Q-20', ['draft'], null, citeC('Q-20'),
      emit('ai.question', { edited: true })),

    t(M_QUESTION, 'Q-21', ['draft'], 'discarded', citeC('Q-21'),
      emit('ai.question', { state: 'discarded' })),

    t(M_QUESTION, 'Q-22', ['draft'], 'sent', citeC('Q-22'),
      emit('ai.question', { state: 'sent' })),

    t(M_QUESTION, 'Q-23', ['sent'], 'closed', citeC('Q-23'),
      emit('ai.question', { state: 'closed' })),
  ],
};

/** Q-12 (2b) is the same doc-level creation event as Q-18 (its own row's trigger is literally "Q-12 (generated)"); Q-19 is the lecturer-authored equivalent. Every other id (edit/discard/send/close, plus 2d's re-broadcasts) mutates the *same* question, so it must keep the memoized id — otherwise a consumer can never correlate a question across its own lifecycle. */
const QUESTION_CREATION_IDS = new Set(['Q-12', 'Q-18', 'Q-19']);

PAYLOAD_BUILDERS['ai.question'] = (w: MockWorld, tr: Transition) => {
  if (QUESTION_CREATION_IDS.has(tr.id)) w.data['ai.question.ulid'] = nextUlid(w);
  const questionId = (w.data['ai.question.ulid'] as string | undefined) ?? nextUlid(w);
  return {
    questionId,
    setId: (w.data['ai.set.ulid'] as string | undefined) ?? null,
    state: w.state(M_QUESTION),
    provenance: (w.data['ai.question.provenance'] as 'generated' | 'lecturer-authored' | undefined) ?? 'generated',
    edited: (w.data['ai.question.edited'] as boolean | undefined) ?? false,
  };
};

// ── 2d — QuestionPublication, the send-to-projector contract ───────────────

const M_PUBLICATION = 'ai.publication' as const;
const citeD = (n: string) => `state-machines §3.4 ${n}`;

/**
 * Q-30 is a creation event (doc `From: —`), not an exit from a tracked prior
 * state — same shape as Q-18/Q-19. Listed explicitly rather than `['*']`
 * because `closed`/`failed` are this machine's terminal states and `'*'`
 * excludes terminal states (world.ts); a new publication legitimately starts
 * from any of them (or mid-flight, from `open`, per Q-31's own INV-QPUB-2
 * close-the-previous step).
 */
const ANY_PUBLICATION_STATE = ['publishing', 'open', 'closed', 'failed'];

export const aiPublicationMachine: MachineDef = {
  id: M_PUBLICATION,
  initial: 'publishing',
  terminal: ['closed', 'failed'],
  transitions: [
    t(M_PUBLICATION, 'Q-30', ANY_PUBLICATION_STATE, 'publishing', citeD('Q-30'),
      emit('quiz.publication', { state: 'publishing', isShowing: false }),
      fire('Q-31', TIMERS['T-PUBLISH-ACK'] / 5)),

    // INV-QPUB-1/2 ordering is load-bearing: close the previous open
    // publication *before* the new one is marked showing, so a viewer can
    // never observe two publications with isShowing=true at once.
    t(M_PUBLICATION, 'Q-31', ['publishing'], 'open', citeD('Q-31'),
      emit('quiz.publication', { state: 'closed', isShowing: false, closeReason: 'next-question' }),
      set('ai.publication.projectorState', 'showing'),
      emit('quiz.publication', { state: 'open', isShowing: true, closeReason: null }),
      emit('ai.question', { state: 'sent' })),

    // INV-QPUB-3: the projector stays on slides and the previous publication
    // stays open — students are never shown a question they cannot answer.
    t(M_PUBLICATION, 'Q-32', ['publishing'], 'failed', citeD('Q-32'),
      emit('quiz.publication', { state: 'failed', isShowing: false }),
      alert('quiz.publish-failed', 'error')),

    t(M_PUBLICATION, 'Q-33', ['open'], 'closed', citeD('Q-33'),
      emit('quiz.publication', { state: 'closed', isShowing: false, closeReason: 'next-question' }),
      emit('ai.question', { state: 'closed' })),

    t(M_PUBLICATION, 'Q-34', ['open'], 'closed', citeD('Q-34'),
      emit('quiz.publication', { state: 'closed', isShowing: false, closeReason: 'session-ended' }),
      emit('ai.question', { state: 'closed' })),

    t(M_PUBLICATION, 'Q-35', ['open'], 'closed', citeD('Q-35'),
      emit('quiz.publication', { state: 'closed', isShowing: false, closeReason: 'lecturer-closed' }),
      emit('ai.question', { state: 'closed' })),

    t(M_PUBLICATION, 'Q-36', ['open', 'closed'], null, citeD('Q-36'),
      set('ai.publication.projectorState', 'showing'),
      emit('quiz.publication')),
  ],
};

/**
 * Q-30 is a fresh entity (see the comment above `ANY_PUBLICATION_STATE`), so
 * it mints a new id; every later transition in the same cycle (Q-31, Q-33..
 * Q-36, and 4d's syncState re-broadcasts) keeps it — matching recording.ts's
 * `w.data['session.ulid'] ?? nextUlid(w)` memoization idiom, so a consumer
 * keyed by `publicationId` can actually observe INV-QPUB-1 (exactly one
 * `isShowing:true` publication) across the id staying constant. Simplification:
 * Q-31's own "close the previous publication" emit (its first effect) also
 * reports *this* id rather than the genuinely-different prior publication's —
 * this mock tracks one "current" publication, not a full history.
 */
PAYLOAD_BUILDERS['quiz.publication'] = (w: MockWorld, tr: Transition) => {
  if (tr.id === 'Q-30') {
    w.data['ai.publication.ulid'] = nextUlid(w);
    w.data['ai.publication.questionId'] = nextUlid(w);
  }
  return {
    publicationId: (w.data['ai.publication.ulid'] as string | undefined) ?? nextUlid(w),
    questionId: (w.data['ai.publication.questionId'] as string | undefined) ?? nextUlid(w),
    state: w.state(M_PUBLICATION),
    isShowing: (w.data['ai.publication.isShowing'] as boolean | undefined) ?? false,
    projectorState: (w.data['ai.publication.projectorState'] as string | undefined) ?? 'not-shown',
    syncState: w.state('quiz.sync'),
    closeReason: (w.data['ai.publication.closeReason'] as string | undefined) ?? null,
  };
};
