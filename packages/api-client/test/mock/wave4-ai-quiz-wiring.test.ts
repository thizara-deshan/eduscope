import { describe, expect, it } from 'vitest';
import type { AiSetPayload, EventEnvelope } from '@eduscope/shared';
import { createMockClient } from '../../src/mock/create-mock-client.js';
import { createVirtualClock } from '../../src/mock/clock.js';

/**
 * Wave 4, Task 1 (W4-D-1/W4-D-2/W4-D-4): record-start is machine 4a's Z-01
 * guard moment and machine 2a's Q-01 arm — today nothing drives either, so the
 * S-13 Studio never arms and S-20's quiz session never opens from a normal
 * `happy` run. This proves the `R-05` reducer schedules both (gated on the
 * seed flags `bootstrapFromSeed` stamps) and that `Q-02`/`Q-03` couple the
 * countdown to a real `QuestionSet` lifecycle.
 *
 * Timing (mock-scale delays, not the real doc timers): R-01 fires R-05 at
 * +1200ms; R-05 schedules Q-01/Z-01 at +400ms; Q-01 fires Q-02 at +6000ms;
 * Z-01 fires Z-02 at +1200ms; Q-02/Q-03 fire Q-11 at +50ms; Q-11 fires Q-12
 * at +3000ms (T-LLM-REQUEST/15). `ARM_AND_OPEN` covers R-01..Z-02/Q-01;
 * `THROUGH_SET_CYCLE` additionally covers a full Q-02->Q-11->Q-12 cycle.
 */
const ARM_AND_OPEN = 1_200 + 400 + 1_200 + 200; // through Z-02 (session open), with slack
const THROUGH_SET_CYCLE = 1_200 + 400 + 6_000 + 50 + 3_000 + 200; // through Q-12/Q-13

function aiSetEvents(client: ReturnType<typeof createMockClient>) {
  const seen: AiSetPayload[] = [];
  client.events$.subscribe((e: EventEnvelope) => {
    if (e.event === 'ai.set') seen.push(e.payload as AiSetPayload);
  });
  return seen;
}

describe('Wave 4, Task 1 — record-start arms the Studio and opens the quiz', () => {
  it('happy: starting recording arms the countdown and opens the quiz session', async () => {
    const clock = createVirtualClock('2026-08-08T09:00:00.000Z');
    const client = createMockClient('happy', { clock });

    await client.startRecording();
    clock.advance(ARM_AND_OPEN);

    expect((await client.getAiCountdown()).state).toBe('armed');
    const session = await client.getQuizSession();
    expect(session.state).toBe('open');
    expect(session.joinUrl).not.toBeNull();
    expect(session.joinCode).not.toBeNull();

    client.dispose();
  });

  it('happy: a generate cycle drives a QuestionSet to ready (Q-02 -> Q-11 -> Q-12)', async () => {
    const clock = createVirtualClock('2026-08-08T09:00:00.000Z');
    const client = createMockClient('happy', { clock });
    const sets = aiSetEvents(client);

    await client.startRecording();
    clock.advance(THROUGH_SET_CYCLE);

    const ready = sets.filter((s) => s.state === 'ready');
    expect(ready.length).toBeGreaterThanOrEqual(1);

    client.dispose();
  });

  it('aiEnabled:false — the countdown stays unavailable and no set is generated', async () => {
    const clock = createVirtualClock('2026-08-08T09:00:00.000Z');
    const client = createMockClient('happy', { clock, seed: { aiEnabled: false } });
    const sets = aiSetEvents(client);

    await client.startRecording();
    clock.advance(THROUGH_SET_CYCLE);

    expect((await client.getAiCountdown()).state).toBe('unavailable');
    expect(sets.some((s) => s.state === 'ready')).toBe(false);

    client.dispose();
  });

  it('quizAvailable:false — the quiz session stays absent after record-start', async () => {
    const clock = createVirtualClock('2026-08-08T09:00:00.000Z');
    const client = createMockClient('happy', { clock, seed: { quizAvailable: false } });

    await client.startRecording();
    clock.advance(ARM_AND_OPEN);

    expect((await client.getQuizSession()).state).toBe('absent');

    client.dispose();
  });

  it('llm-timeout: a generate cycle reaches failed and the countdown holds degraded', async () => {
    const clock = createVirtualClock('2026-08-08T09:00:00.000Z');
    const client = createMockClient('llm-timeout', { clock });
    const sets = aiSetEvents(client);

    await client.startRecording();
    // Q-12 -> Q-13 (intercepted at the same scheduled instant — the forced
    // rule's `delayMs` only feeds `onTransport`, not `intercept()`); Q-14
    // is not scheduled here so the countdown holds in `degraded` (Q-05).
    clock.advance(THROUGH_SET_CYCLE);

    const failed = sets.find((s) => s.state === 'failed');
    expect(failed?.error).toBe('timeout');
    expect((await client.getAiCountdown()).state).toBe('degraded');

    client.dispose();
  });

  it('quiz-network-loss: record-start opens the session; the script only drives it stale', async () => {
    const clock = createVirtualClock('2026-08-08T09:00:00.000Z');
    const client = createMockClient('quiz-network-loss', { clock });

    await client.startRecording();
    clock.advance(ARM_AND_OPEN);

    expect((await client.getQuizSession()).state).toBe('open');

    clock.advance(3_000); // the script's own Z-30 timeline entry (scheduled from world build)
    const session = await client.getQuizSession();
    expect(session.state).toBe('open');
    expect(session.syncState).toBe('stale');

    client.dispose();
  });
});
