import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { zEventEnvelope, zSystemAlert, type EventEnvelope } from '@eduscope/shared';
import { createVirtualClock } from '../../src/mock/clock.js';
import { MockWorld } from '../../src/mock/world.js';
import {
  ALL_MACHINES,
  aiCountdownMachine,
  aiPublicationMachine,
  aiQuestionMachine,
  aiSetMachine,
  captureCardMachine,
  channelTransitionId,
  quizSessionMachine,
  quizSyncMachine,
  recordingMachine,
  sourceMachine,
  sourceTransitionId,
  storageMachine,
  streamingChannelMachine,
} from '../../src/mock/machines/index.js';

const doc = readFileSync(
  resolve(__dirname, '../../../../docs/design/state-machines.md'),
  'utf8',
);

/** Transition-table rows look like: `| R-05 | starting | … |` */
function documentedIds(prefix: string): string[] {
  return [
    ...new Set(
      [...doc.matchAll(new RegExp(`^\\| (${prefix}-\\d+) \\|`, 'gm'))].map((m) => m[1]!),
    ),
  ];
}

const implemented = new Set(
  ALL_MACHINES.flatMap((m) => m.transitions.map((t) => t.id)),
);

/**
 * Machines 4b (QuizParticipant) and 4c (per-student answer view) run on
 * quiz-service, not core-api — state-machines §0.2 names quiz-service as their
 * single writer. apps/quiz mocks them; this adapter must not.
 */
const QUIZ_SERVICE_SIDE = new Set([
  'Z-10', 'Z-11', 'Z-12', 'Z-13', 'Z-14', 'Z-15',
  'Z-20', 'Z-21', 'Z-22', 'Z-23', 'Z-24', 'Z-25', 'Z-26',
]);

describe('machine definitions mirror state-machines.md', () => {
  it.each(['R', 'CH', 'Q', 'Z', 'HL'])(
    'implements every %s-xx transition core-api owns',
    (prefix) => {
      const ids = documentedIds(prefix).filter((id) => !QUIZ_SERVICE_SIDE.has(id));
      expect(ids.length).toBeGreaterThan(0);
      const missing = ids.filter((id) => !implemented.has(id));
      expect(missing, `unimplemented transitions: ${missing.join(', ')}`).toEqual([]);
    },
  );

  it('does not implement the quiz-service-owned machines (SM-R-1: one writer)', () => {
    const leaked = [...QUIZ_SERVICE_SIDE].filter((id) => implemented.has(id));
    expect(leaked, `core-api mock claims quiz-service transitions: ${leaked.join(', ')}`)
      .toEqual([]);
  });

  it('cites a spec section on every transition', () => {
    const uncited = ALL_MACHINES.flatMap((m) => m.transitions)
      .filter((t) => !/state-machines §/.test(t.cite))
      .map((t) => t.id);
    expect(uncited, `missing citation: ${uncited.join(', ')}`).toEqual([]);
  });

  it('declares no duplicate transition ids across machines', () => {
    const all = ALL_MACHINES.flatMap((m) => m.transitions.map((t) => t.id));
    expect(all.length).toBe(new Set(all).size);
  });

  it('gives every non-initial state at least one inbound transition', () => {
    for (const m of ALL_MACHINES) {
      const reachable = new Set([m.initial, ...m.transitions.map((t) => t.to)]);
      for (const t of m.transitions) {
        for (const from of t.from) {
          if (from === '*') continue;
          expect(reachable.has(from), `${m.id}: ${t.id} starts from unreachable "${from}"`)
            .toBe(true);
        }
      }
    }
  });
});

/**
 * Execution-level regressions from the round-1 review: static structure was
 * clean, but actually *running* transitions through a real MockWorld turned
 * up a `buildAlert` schema bug, a silently-skipped machine-1b gap, and two
 * id-lifecycle bugs the id-set/citation checks above can't see.
 */
function freshWorld(...machines: Parameters<MockWorld['registerMachine']>[0][]): MockWorld {
  const clock = createVirtualClock('2026-08-03T09:00:00.000+00:00');
  const w = new MockWorld({ clock });
  for (const m of machines) w.registerMachine(m);
  return w;
}

function payloadOf(e: EventEnvelope): Record<string, unknown> {
  return e.payload as Record<string, unknown>;
}

describe('machine execution (real MockWorld, not just static analysis)', () => {
  it('an alert() effect produces a zSystemAlert-valid payload (C1 regression)', () => {
    const w = freshWorld(storageMachine);
    const seen: EventEnvelope[] = [];
    w.subscribeEvents((e) => seen.push(e));
    expect(() => w.apply('HL-10')).not.toThrow();
    const alertEvt = seen.find((e) => e.event === 'system.alert');
    expect(alertEvt).toBeDefined();
    expect(() => zEventEnvelope.parse(alertEvt)).not.toThrow();
    expect(zSystemAlert.safeParse(payloadOf(alertEvt!)).success).toBe(true);
  });

  it("recording.ts's own alert() effects are schema-valid too (R-04, verbatim machine 1a)", () => {
    const w = freshWorld(recordingMachine);
    const seen: EventEnvelope[] = [];
    w.subscribeEvents((e) => seen.push(e));
    expect(() => w.apply('R-04')).not.toThrow();
    const alertEvt = seen.find((e) => e.event === 'system.alert');
    expect(zSystemAlert.safeParse(payloadOf(alertEvt!)).success).toBe(true);
  });

  it('a full recording lifecycle reaches completed and emits a schema-valid recording.artifact (machine-1b stub)', () => {
    // R-05/R-11 re-broadcast quiz.session, whose builder reads the 4d quiz.sync
    // machine for `syncState` (CG-19, v0.4) — so quizSyncMachine must be registered.
    const w = freshWorld(recordingMachine, aiCountdownMachine, quizSessionMachine, quizSyncMachine);
    const seen: EventEnvelope[] = [];
    w.subscribeEvents((e) => seen.push(e));
    w.apply('R-01');
    w.apply('R-05');
    w.apply('R-11');
    w.apply('R-12');
    expect(() => w.apply('R-14')).not.toThrow();
    expect(w.state('recording')).toBe('completed');
    const artifactEvt = seen.find((e) => e.event === 'recording.artifact');
    expect(artifactEvt).toBeDefined();
    expect(() => zEventEnvelope.parse(artifactEvt)).not.toThrow();
  });

  it('channelTransitionId/sourceTransitionId resolve to the ids actually registered (I2)', () => {
    expect(channelTransitionId('meeting', 'CH-05')).toBe('CH-05');
    expect(channelTransitionId('streaming', 'CH-01')).toBe('CH-01');
    expect(channelTransitionId('streaming', 'CH-05')).toBe('CH-05S');
    expect(sourceTransitionId('presentation', 'HL-02')).toBe('HL-02');
    expect(sourceTransitionId('lecturer-cam', 'HL-02')).toBe('HL-02@lecturer-cam');

    const lecturerCam = sourceMachine('lecturer-cam');
    const w1 = freshWorld(lecturerCam);
    expect(() => w1.apply(sourceTransitionId('lecturer-cam', 'HL-02'))).not.toThrow();
    expect(w1.state(lecturerCam.id)).toBe('online');

    const w2 = freshWorld(streamingChannelMachine);
    w2.apply('CH-01');
    w2.apply(channelTransitionId('streaming', 'CH-02'));
    expect(() => w2.apply(channelTransitionId('streaming', 'CH-05'))).not.toThrow();
    expect(w2.state('channel:streaming')).toBe('on');
  });

  it('a publication keeps one publicationId across its own lifecycle (I3, makes INV-QPUB-1 observable)', () => {
    // Q-31 re-broadcasts ai.question{sent}, so aiQuestionMachine must be registered too.
    const w = freshWorld(aiPublicationMachine, quizSyncMachine, aiQuestionMachine);
    const seen: EventEnvelope[] = [];
    w.subscribeEvents((e) => seen.push(e));

    w.apply('Q-30');
    const createdId = payloadOf(seen.find((e) => e.event === 'quiz.publication')!).publicationId;
    expect(typeof createdId).toBe('string');

    w.apply('Q-31');
    const openEvt = seen.filter((e) => e.event === 'quiz.publication').at(-1)!;
    expect(payloadOf(openEvt).isShowing).toBe(true);
    expect(payloadOf(openEvt).publicationId).toBe(createdId);

    w.apply('Q-33');
    const closeEvt = seen.filter((e) => e.event === 'quiz.publication').at(-1)!;
    expect(payloadOf(closeEvt).publicationId).toBe(createdId);
  });

  it('a question keeps one questionId across its own lifecycle (I3)', () => {
    const w = freshWorld(aiQuestionMachine);
    const seen: EventEnvelope[] = [];
    w.subscribeEvents((e) => seen.push(e));

    w.apply('Q-18');
    const createdId = payloadOf(seen.at(-1)!).questionId;
    expect(typeof createdId).toBe('string');

    w.apply('Q-20');
    expect(payloadOf(seen.at(-1)!).questionId).toBe(createdId);
    w.apply('Q-22');
    expect(payloadOf(seen.at(-1)!).questionId).toBe(createdId);
    w.apply('Q-23');
    expect(payloadOf(seen.at(-1)!).questionId).toBe(createdId);
  });

  it('aiSetMachine supports a second generation cycle after reviewed (I4 regression)', () => {
    // Q-12 re-broadcasts ai.question{draft}, so aiQuestionMachine must be registered too.
    const w = freshWorld(aiSetMachine, aiQuestionMachine);
    w.apply('Q-11');
    w.apply('Q-12');
    w.apply('Q-15');
    expect(w.state('ai.set')).toBe('reviewed');
    expect(() => w.apply('Q-11')).not.toThrow();
    expect(w.state('ai.set')).toBe('generating');
  });

  it('the capture-card watchdog also raises a schema-valid alert (C1, second machine)', () => {
    const w = freshWorld(captureCardMachine);
    const seen: EventEnvelope[] = [];
    w.subscribeEvents((e) => seen.push(e));
    expect(() => w.apply('HL-20')).not.toThrow();
    const alertEvt = seen.find((e) => e.event === 'system.alert');
    expect(zSystemAlert.safeParse(payloadOf(alertEvt!)).success).toBe(true);
  });
});
