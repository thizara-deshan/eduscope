import { describe, expect, it } from 'vitest';
import { TransportError } from '../src/errors.js';
import { createMockQuizClient, QuizAppProblemError } from '../src/quiz/quiz-app-client.js';
import { listScenarios } from '../src/mock/scenario/registry.js';

const SESSION = '01JBQ8ZK3T7WBM5N2Q4XPRVC9D';
const PUBLICATION = '01JBQ8ZK3T7WBM5N2Q4XPRVC9F';
const OPTION = '01JBQ8ZK3T7WBM5N2Q4XPRVCA0';

describe('contract v0.6 student quiz mock', () => {
  it('CG-1: resolves case-insensitively with the confirmed policy and registers idempotently', async () => {
    const client = createMockQuizClient('student-quiz-happy');
    const upper = await client.resolveJoinCode('ABC123');
    const lower = await client.resolveJoinCode('abc123');
    expect(lower.quizSessionId).toBe(upper.quizSessionId);
    expect(upper.registrationPolicy).toEqual({
      studentIdPattern: '^[A-Z]{2}[0-9]{7,8}$',
      studentIdHint: 'Two uppercase letters followed by 7 or 8 digits',
      inputMode: 'text', studentIdMaxLength: 10, fullNameMaxLength: 128,
    });
    const first = await client.registerParticipant(upper.quizSessionId, {
      fullName: 'K. Fernando', studentIdNumber: 'IT12345678',
    });
    const again = await client.registerParticipant(upper.quizSessionId, {
      fullName: 'K. Fernando', studentIdNumber: 'IT12345678',
    });
    expect(first.outcome).toBe('created');
    expect(again).toEqual({ ...first, outcome: 'rejoined' });
  });

  it('CG-1: field refusals are named and point at the invalid field', async () => {
    const client = createMockQuizClient('student-quiz-happy');
    await expect(client.registerParticipant(SESSION, {
      fullName: 'K. Fernando', studentIdNumber: 'it12345678',
    })).rejects.toMatchObject({
      problem: {
        code: 'registration.invalid-student-id',
        fieldViolations: [{ pointer: '/studentIdNumber' }],
      },
    });
  });

  it('CG-1: first answer is durable and a duplicate returns the stored option without overwrite', async () => {
    const client = createMockQuizClient('student-quiz-happy');
    expect(await client.submitAnswer(PUBLICATION, { selectedOptionId: OPTION })).toEqual({
      outcome: 'accepted', selectedOptionId: OPTION,
    });
    expect(await client.submitAnswer(PUBLICATION, {
      selectedOptionId: '01JBQ8ZK3T7WBM5N2Q4XPRVCA1',
    })).toEqual({ outcome: 'already-accepted', selectedOptionId: OPTION });
  });

  it('S-39 request/reply loss stores the answer; retry reveals already-accepted', async () => {
    const client = createMockQuizClient('student-quiz-failures');
    await expect(client.submitAnswer(PUBLICATION, { selectedOptionId: OPTION })).rejects.toBeInstanceOf(TransportError);
    await expect(client.submitAnswer(PUBLICATION, { selectedOptionId: OPTION })).resolves.toEqual({
      outcome: 'already-accepted', selectedOptionId: OPTION,
    });
  });

  it('CG-22: every connect snapshot is emitted atomically in the required order', async () => {
    const client = createMockQuizClient('student-quiz-reconnect');
    const seen: string[] = [];
    client.events$.subscribe((event) => seen.push(event.event));
    const snapshot = await client.connect();
    expect(snapshot.map((event) => event.event)).toEqual([
      'quiz.session', 'quiz.participant', 'quiz.question', 'quiz.result',
    ]);
    expect(seen).toEqual([
      'quiz.participant', 'quiz.session', 'quiz.participant', 'quiz.question', 'quiz.result',
    ]);
  });

  it('CG-23/24: catalog reaches 2/3/4-option, none, correct, incorrect, missed and rank states', async () => {
    const names = ['student-quiz-happy', 'student-quiz-returning', 'student-quiz-closed', 'student-quiz-reconnect'] as const;
    const snapshots = await Promise.all(names.map((name) => createMockQuizClient(name).connect()));
    const questions = snapshots.map((snapshot) => snapshot.find((event) => event.event === 'quiz.question')!);
    const optionCounts = questions.map((event) => event.payload.state === 'none' ? 0 : event.payload.options.length);
    expect(optionCounts).toEqual([4, 3, 4, 2]);
    const results = snapshots.flat().filter((event) => event.event === 'quiz.result');
    expect(results.map((event) => event.payload.rankState)).toEqual(['current', 'pending', 'current']);
    expect(results.map((event) => event.payload.isCorrect)).toEqual([true, false, null]);
  });

  it('CG-25: catalog reaches both constrained terminal summaries', async () => {
    const participated = (await createMockQuizClient('student-quiz-happy').connect())[0];
    const none = (await createMockQuizClient('student-quiz-closed').connect())[0];
    expect(participated).toMatchObject({ event: 'quiz.session', payload: { participationState: 'participated', answeredCount: 3 } });
    expect(none).toEqual({
      event: 'quiz.session',
      payload: { state: 'closed', participationState: 'none', finalScore: 0, finalRank: null, answeredCount: 0 },
    });
  });

  it('extends the shared scenario catalog rather than introducing a second catalog', () => {
    expect(listScenarios().filter((script) => script.studentQuiz).map((script) => script.name)).toEqual([
      'student-quiz-happy', 'student-quiz-returning', 'student-quiz-closed',
      'student-quiz-reconnect', 'student-quiz-failures',
    ]);
  });

  it('closed, invalid, unavailable and unreachable paths are all reachable', async () => {
    await expect(createMockQuizClient('student-quiz-closed').registerParticipant(SESSION, {
      fullName: 'K. Fernando', studentIdNumber: 'IT12345678',
    })).rejects.toMatchObject({ problem: { code: 'quiz.session-closed' } });
    const failures = createMockQuizClient('student-quiz-failures');
    await expect(failures.resolveJoinCode('ABC123')).rejects.toBeInstanceOf(TransportError);
    await expect(failures.resolveJoinCode('ABC123')).resolves.toMatchObject({ state: 'open' });
    await expect(createMockQuizClient('student-quiz-happy').resolveJoinCode('INVALID'))
      .rejects.toBeInstanceOf(QuizAppProblemError);
    await expect(createMockQuizClient('student-quiz-happy').resolveJoinCode('UNAVAILABLE'))
      .rejects.toMatchObject({ problem: { code: 'quiz.unavailable' } });
  });
});
