import { describe, expect, it } from 'vitest';
import { zEventEnvelope } from '@eduscope/shared';
import { createVirtualClock } from '../../src/mock/clock.js';
import { MockWorld } from '../../src/mock/world.js';
import { recordingMachine } from '../../src/mock/machines/recording.js';
// Side-effect imports: register the ai.countdown/quiz.session payload
// builders that recording.ts's R-05 re-broadcasts. world.ts's missing-builder
// case throws (by design — a silent skip previously hid a real bug, see
// task-7-report.md I1), so any world that applies R-05 needs these machines
// registered too, not just recordingMachine.
import { aiCountdownMachine } from '../../src/mock/machines/ai.js';
import { quizSessionMachine } from '../../src/mock/machines/quiz.js';
import { sourceMachine } from '../../src/mock/machines/health.js';

function world() {
  const clock = createVirtualClock('2026-07-30T09:00:00.000+00:00');
  const w = new MockWorld({ clock });
  w.registerMachine(recordingMachine);
  w.registerMachine(aiCountdownMachine);
  w.registerMachine(quizSessionMachine);
  return { w, clock };
}

describe('MockWorld', () => {
  it('starts machine 1a in idle — idle is the absence of a session', () => {
    const { w } = world();
    expect(w.state('recording')).toBe('idle');
  });

  it('applies R-01 and emits recording.state{starting}', () => {
    const { w } = world();
    const seen: unknown[] = [];
    w.subscribeEvents((e) => seen.push(e));
    w.apply('R-01');
    expect(w.state('recording')).toBe('starting');
    const evt = zEventEnvelope.parse(seen.at(-1));
    expect(evt.event).toBe('recording.state');
    expect(evt.payload).toMatchObject({ state: 'starting', startReason: 'initial' });
  });

  it('refuses a transition whose `from` does not match, and says why', () => {
    const { w } = world();
    expect(() => w.apply('R-05')).toThrow(/R-05.*from idle/);
  });

  it('numbers events with a monotonic per-connection seq', () => {
    const { w } = world();
    const seen: { seq: number }[] = [];
    w.subscribeEvents((e) => seen.push(e));
    w.apply('R-01');
    w.apply('R-05');
    // R-01 emits recording.state (seq 0). R-05 emits recording.state,
    // recording.segment, and re-broadcasts ai.countdown and quiz.session
    // (seq 1..4) — all four builders are registered via aiCountdownMachine/
    // quizSessionMachine above.
    expect(seen.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4]);
  });

  it('runs scheduled transitions only when the virtual clock advances', () => {
    const { w, clock } = world();
    // R-01 itself schedules R-05 at T-START-CONFIRM-scale (1_200ms, see
    // recording.ts) — no need to schedule it again here.
    w.apply('R-01');
    expect(w.state('recording')).toBe('starting');
    clock.advance(1_199);
    expect(w.state('recording')).toBe('starting');
    clock.advance(1);
    expect(w.state('recording')).toBe('recording');
  });

  it('replays a schema-valid snapshot on subscribe (events.md §1)', () => {
    const { w } = world();
    w.apply('R-01');
    const snapshot = w.snapshot();
    expect(snapshot.map((e) => e.event)).toContain('recording.state');
    for (const e of snapshot) expect(() => zEventEnvelope.parse(e)).not.toThrow();
  });

  it('keeps one snapshot row per entity, not one per event name (events.md §1 "never a partial patch")', () => {
    const { w } = world();
    // Two independent `source:*` machines both emit `sources.status` — the
    // `latest` map used to be keyed by event name alone, so the second
    // emit would silently clobber the first in snapshot().
    w.registerMachine(sourceMachine('presentation'));
    w.registerMachine(sourceMachine('lecturer-cam'));
    w.apply('HL-02'); // presentation: unknown -> online
    w.apply('HL-02@lecturer-cam'); // lecturer-cam: unknown -> online

    const statuses = w
      .snapshot()
      .filter((e) => e.event === 'sources.status')
      .map((e) => (e.payload as { roleId: string }).roleId);
    expect(statuses.sort()).toEqual(['lecturer-cam', 'presentation']);
  });
});
