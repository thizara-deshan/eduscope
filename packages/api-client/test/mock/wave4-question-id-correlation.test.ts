import { describe, expect, it } from 'vitest';
import type { AiQuestionPayload, EventEnvelope } from '@eduscope/shared';
import { createMockClient } from '../../src/mock/create-mock-client.js';
import { createVirtualClock } from '../../src/mock/clock.js';

/**
 * Wave 4 gate finding: Q-12 (a QuestionSet reaching `ready`) only ever
 * emitted `ai.question` — it never added the generated draft to
 * `seed.questions` — so a later editQuestion/discardQuestion/sendToProjector
 * against that exact id 404d even though the panel had just shown it. And
 * Q-30/Q-31's own `ai.question{sent}` echo read a single global "current
 * question" pointer instead of the id the command actually targeted, so a
 * 202-async UI (waiting for the WS event a command promised, never
 * optimistic) could never observe its own sendToProjector resolve. Both are
 * fixed in mock/rest/ai.ts + mock/machines/ai.ts; this proves it end to end.
 */
function aiQuestionEvents(client: ReturnType<typeof createMockClient>) {
  const seen: AiQuestionPayload[] = [];
  client.events$.subscribe((e: EventEnvelope) => {
    if (e.event === 'ai.question') seen.push(e.payload as AiQuestionPayload);
  });
  return seen;
}

describe('Wave 4 — question id correlation (Q-12 seed sync, Q-30/Q-31 echo)', () => {
  it('a freshly-generated draft is find-able by listQuestions and by its own id', async () => {
    const clock = createVirtualClock('2026-08-08T09:00:00.000Z');
    const client = createMockClient('happy', { clock });
    const events = aiQuestionEvents(client);

    await client.startRecording();
    clock.advance(1_200 + 400 + 6_000 + 50 + 3_000 + 200); // through Q-12 (see wave4-ai-quiz-wiring.test.ts's timing map)

    const generated = events.find((e) => e.state === 'draft' && e.provenance === 'generated');
    expect(generated).toBeDefined();
    const rows = await client.listQuestions({ sessionId: 'x' });
    expect(rows.some((q) => q.id === generated!.questionId)).toBe(true);

    client.dispose();
  });

  it('sendToProjector resolves via an ai.question{sent} echo carrying the SAME id that was sent', async () => {
    const clock = createVirtualClock('2026-08-08T09:00:00.000Z');
    const client = createMockClient('happy', { clock });
    const events = aiQuestionEvents(client);

    await client.startRecording();
    clock.advance(1_200 + 400 + 6_000 + 50 + 3_000 + 200);
    const generated = events.find((e) => e.state === 'draft' && e.provenance === 'generated')!;

    await client.sendToProjector(generated.questionId);
    clock.advance(150 + (5_000 / 5) + 200); // sendToProjector's Q-30 delay, then Q-30's own fire(Q-31, T-PUBLISH-ACK/5)

    const sentEcho = events.find((e) => e.state === 'sent');
    expect(sentEcho?.questionId).toBe(generated.questionId);

    const rows = await client.listQuestions({ sessionId: 'x' });
    expect(rows.find((q) => q.id === generated.questionId)?.state).toBe('sent');

    client.dispose();
  });

  it('createQuestion resolves via an ai.question{draft, lecturer-authored} echo carrying the pushed row\'s real id', async () => {
    const clock = createVirtualClock('2026-08-08T09:00:00.000Z');
    const client = createMockClient('happy', { clock });
    const events = aiQuestionEvents(client);

    await client.startRecording();
    clock.advance(1_500);
    await client.createQuestion({
      prompt: 'What is 2+2?',
      options: [{ text: '4', isCorrect: true }, { text: '5', isCorrect: false }],
    });
    clock.advance(200);

    const authored = events.find((e) => e.provenance === 'lecturer-authored' && e.state === 'draft');
    expect(authored).toBeDefined();
    const rows = await client.listQuestions({ sessionId: 'x' });
    const row = rows.find((q) => q.id === authored!.questionId);
    expect(row?.prompt).toBe('What is 2+2?');

    client.dispose();
  });
});
