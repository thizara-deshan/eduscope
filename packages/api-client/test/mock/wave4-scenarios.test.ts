import { describe, expect, it } from 'vitest';
import type { EventEnvelope, QuizSessionPayload } from '@eduscope/shared';
import { createMockClient } from '../../src/mock/create-mock-client.js';
import { createVirtualClock } from '../../src/mock/clock.js';

/**
 * Wave 4 (S-20 Quiz join / QR card) — CG-19: the joined-count staleness must be
 * knowable LIVE on `quiz.session`, not only on a REST snapshot. Record-start
 * opens the session (W4-D-1, `R-05`'s own Z-01 → Z-02 schedule); the
 * quiz-network-loss timeline then only drives the 4d sync link stale (Z-30);
 * with `syncState` on the WS payload (v0.4) the chip/modal can flip to S-20's
 * `stale` rendering off the socket. See S-20 §2.4 / §5.1 (3s),
 * contracts/events.md §2.15, docs/design/contract-amendments.md (A-9).
 */
function quizSessionEvents(client: ReturnType<typeof createMockClient>) {
  const seen: QuizSessionPayload[] = [];
  client.events$.subscribe((e: EventEnvelope) => {
    if (e.event === 'quiz.session') seen.push(e.payload as QuizSessionPayload);
  });
  return seen;
}

describe('Wave 4 — CG-19 quiz.session syncState reachability', () => {
  it('quiz-network-loss opens the session then marks the joined count stale LIVE on quiz.session', async () => {
    const clock = createVirtualClock('2026-08-08T09:00:00.000Z');
    const client = createMockClient('quiz-network-loss', { clock });
    const seen = quizSessionEvents(client);

    // W4-D-1: record-start (R-01 -> fire R-05 @1200) schedules Z-01 (+400ms),
    // whose own fire('Z-02', 1_200) opens the session at ~t=2800ms — checked
    // just short of the script's own Z-30 @3000ms (world-build-relative) so
    // the two don't land in the same `advance()` call.
    await client.startRecording();
    clock.advance(2_900);
    const open = seen.at(-1)!;
    expect(open.state).toBe('open');
    expect(open.syncState).toBe('synced');

    // Z-30 @3000ms (world-build-relative) -> sync stale; CG-19 re-emits quiz.session carrying it.
    clock.advance(1_000);
    const stale = seen.at(-1)!;
    expect(stale.state).toBe('open'); // session still open — the way in still works
    expect(stale.syncState).toBe('stale'); // only the count is out of date
    expect(client.world.state('quiz.sync')).toBe('stale');

    client.dispose();
  });

  it('REST getQuizSession and the WS quiz.session payload agree on syncState (one truth)', async () => {
    const clock = createVirtualClock('2026-08-08T09:00:00.000Z');
    const client = createMockClient('quiz-network-loss', { clock });
    const seen = quizSessionEvents(client);

    await client.startRecording();
    clock.advance(1_500 + 4_000); // through Z-01/Z-02/Z-30
    const rest = await client.getQuizSession();
    expect(rest.syncState).toBe('stale');
    expect(seen.at(-1)!.syncState).toBe(rest.syncState);

    client.dispose();
  });
});
