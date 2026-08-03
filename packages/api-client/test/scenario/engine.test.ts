import { beforeEach, describe, expect, it } from 'vitest';
import { createVirtualClock } from '../../src/mock/clock.js';
import { MockWorld } from '../../src/mock/world.js';
import { ALL_MACHINES } from '../../src/mock/machines/index.js';
import {
  createScenarioEngine,
  extendScenario,
  getScenario,
  listScenarios,
} from '../../src/mock/scenario/registry.js';

function worldFor(name: Parameters<typeof getScenario>[0]) {
  const engine = createScenarioEngine(getScenario(name));
  const clock = createVirtualClock('2026-07-30T09:00:00.000+00:00');
  const w = new MockWorld({ clock, intercept: engine.intercept });
  for (const machine of ALL_MACHINES) w.registerMachine(machine);
  // Scenario-specific setup: pipeline-crash-midway schedules consumer crash at 40s
  if (name === 'pipeline-crash-midway') w.schedule('R-16', 40_000);
  return { w, clock, engine };
}

describe('scenario engine', () => {
  beforeEach(() => {
    for (const s of listScenarios()) createScenarioEngine(s).reset();
  });

  it('ships exactly the seven catalog scripts', () => {
    expect(listScenarios().map((s) => s.name)).toEqual([
      'happy',
      'start-fails',
      'pipeline-crash-midway',
      'llm-timeout',
      'disk-full',
      'ws-flap',
      'quiz-network-loss',
    ]);
  });

  it('happy is the empty script — the spec path is the default', () => {
    expect(getScenario('happy').forced).toEqual([]);
    const { w, clock } = worldFor('happy');
    w.apply('R-01');
    clock.advance(1_200);
    expect(w.state('recording')).toBe('recording');
  });

  it('start-fails rewrites R-05 to R-06 so start never reads as recording', () => {
    const { w, clock } = worldFor('start-fails');
    w.apply('R-01');
    expect(w.state('recording')).toBe('starting');
    clock.advance(1_200);
    expect(w.state('recording')).toBe('error');
  });

  it('pipeline-crash-midway fires once, not on every entry to recording', () => {
    const { w, clock, engine } = worldFor('pipeline-crash-midway');
    w.apply('R-01');
    clock.advance(60_000);
    expect(w.state('recording')).toBe('recording');
    const forced = engine.trace().filter((e) => e.applied === 'R-16');
    expect(forced).toHaveLength(1);
  });

  it('a refuse rule rejects the command with a named Problem, never a no-op', () => {
    const { engine } = worldFor('disk-full');
    const problem = engine.onCommand('startRecording');
    expect(problem).toMatchObject({ status: 409, code: 'storage.critical' });
  });

  it('records a trace naming the rule that fired', () => {
    const { w, clock, engine } = worldFor('start-fails');
    w.apply('R-01');
    clock.advance(1_200);
    expect(engine.trace()).toContainEqual(
      expect.objectContaining({ requested: 'R-05', applied: 'R-06' }),
    );
  });

  it('extendScenario appends without forking, and rejects unknown names', () => {
    const before = getScenario('llm-timeout').forced.length;
    extendScenario('llm-timeout', {
      on: { command: 'createQuestion' },
      replace: 'refuse',
      refusal: { status: 409, code: 'ai.unavailable', title: 'AI is unavailable' },
    });
    expect(getScenario('llm-timeout').forced).toHaveLength(before + 1);
    expect(() =>
      // @ts-expect-error unknown scenario name is a compile error and a runtime throw
      extendScenario('made-up', { on: { command: 'getMe' }, replace: 'refuse' }),
    ).toThrow(/unknown scenario/);
  });
});
