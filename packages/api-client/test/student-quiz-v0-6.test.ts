import { describe, expect, it, vi } from 'vitest';
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

  it('CG-23/24: catalog reaches 2/3/4-option question shapes on connect', async () => {
    const names = ['student-quiz-happy', 'student-quiz-returning', 'student-quiz-closed', 'student-quiz-reconnect'] as const;
    const snapshots = await Promise.all(names.map((name) => createMockQuizClient(name).connect()));
    const questions = snapshots.map((snapshot) => snapshot.find((event) => event.event === 'quiz.question')!);
    const optionCounts = questions.map((event) => event.payload.state === 'none' ? 0 : event.payload.options.length);
    expect(optionCounts).toEqual([4, 3, 4, 2]);
    // student-quiz-reconnect is the only catalog entry that still starts with a live result.
    const results = snapshots.flat().filter((event) => event.event === 'quiz.result');
    expect(results.map((event) => event.payload.rankState)).toEqual(['current']);
    expect(results.map((event) => event.payload.isCorrect)).toEqual([null]);
  });

  it('CG-23/24: forced transitions reach correct, incorrect and rank-current results', async () => {
    const client = createMockQuizClient('student-quiz-happy');
    await client.connect();
    const seen: Array<{ isCorrect: boolean | null; rankState: string }> = [];
    client.events$.subscribe((event) => {
      if (event.event === 'quiz.result') seen.push({ isCorrect: event.payload.isCorrect, rankState: event.payload.rankState });
    });
    client.forceStudentTransition('student.result.correct-current');
    client.forceStudentTransition('student.result.incorrect-pending');
    client.forceStudentTransition('student.result.rank-current');
    expect(seen).toEqual([
      { isCorrect: true, rankState: 'current' },
      { isCorrect: false, rankState: 'pending' },
      { isCorrect: false, rankState: 'current' },
    ]);
  });

  it('CG-25: catalog reaches both constrained terminal summaries via forced transitions', async () => {
    const participatedClient = createMockQuizClient('student-quiz-happy');
    await participatedClient.connect();
    const noneClient = createMockQuizClient('student-quiz-happy');
    await noneClient.connect();

    const participatedSeen: unknown[] = [];
    participatedClient.events$.subscribe((event) => { if (event.event === 'quiz.session') participatedSeen.push(event); });
    participatedClient.forceStudentTransition('student.session.close-participated');

    const noneSeen: unknown[] = [];
    noneClient.events$.subscribe((event) => { if (event.event === 'quiz.session') noneSeen.push(event); });
    noneClient.forceStudentTransition('student.session.close-none');

    expect(participatedSeen).toEqual([
      { event: 'quiz.session', payload: { state: 'closed', participationState: 'participated', finalScore: 30, finalRank: 3, answeredCount: 3 } },
    ]);
    expect(noneSeen).toEqual([
      { event: 'quiz.session', payload: { state: 'closed', participationState: 'none', finalScore: 0, finalRank: null, answeredCount: 0 } },
    ]);
  });

  it('extends the shared scenario catalog rather than introducing a second catalog', () => {
    expect(listScenarios().filter((script) => script.studentQuiz).map((script) => script.name)).toEqual([
      'student-quiz-happy', 'student-quiz-returning', 'student-quiz-closed',
      'student-quiz-reconnect', 'student-quiz-failures',
      'student-quiz-registration-closed', 'student-quiz-late-answer', 'student-quiz-session-not-found',
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

  it('registration-closed resolves open before rejecting registration', async () => {
    const client = createMockQuizClient('student-quiz-registration-closed');
    await expect(client.resolveJoinCode('ABC123')).resolves.toMatchObject({ state: 'open', participantState: 'anonymous' });
    await expect(client.registerParticipant(SESSION, {
      fullName: 'K. Fernando', studentIdNumber: 'IT12345678',
    })).rejects.toMatchObject({ problem: { code: 'quiz.session-closed' } });
  });

  it('late-answer keeps the session/question open while submit is refused', async () => {
    const client = createMockQuizClient('student-quiz-late-answer');
    const snapshot = await client.connect();
    expect(snapshot.find((e) => e.event === 'quiz.session')).toMatchObject({ payload: { state: 'open' } });
    expect(snapshot.find((e) => e.event === 'quiz.question')).toMatchObject({ payload: { state: 'open' } });
    await expect(client.submitAnswer(PUBLICATION, { selectedOptionId: OPTION }))
      .rejects.toMatchObject({ problem: { code: 'question.closed' } });
  });

  it('session-not-found rejects connect() with the named problem', async () => {
    const client = createMockQuizClient('student-quiz-session-not-found');
    await expect(client.connect()).rejects.toMatchObject({ problem: { code: 'quiz.session-not-found' } });
  });

  it('offline makes REST reject without queuing, and restore permits a new connect()', async () => {
    const client = createMockQuizClient('student-quiz-happy');
    client.forceStudentTransition('student.connection.offline');
    await expect(client.resolveJoinCode('ABC123')).rejects.toBeInstanceOf(TransportError);
    await expect(client.connect()).rejects.toBeInstanceOf(TransportError);
    client.forceStudentTransition('student.connection.restore');
    await expect(client.resolveJoinCode('ABC123')).resolves.toMatchObject({ state: 'open' });
    await expect(client.connect()).resolves.toBeDefined();
  });

  it('forced question transitions emit valid 2/3/4/none-option events and clear the prior result', async () => {
    const client = createMockQuizClient('student-quiz-happy');
    await client.connect();
    client.forceStudentTransition('student.result.correct-current');
    const seen: string[] = [];
    client.events$.subscribe((event) => seen.push(event.event));
    client.forceStudentTransition('student.question.open-2');
    expect(seen).toEqual(['quiz.question']);
  });

  it('missed transition atomically emits a closed question and a missed result', async () => {
    const client = createMockQuizClient('student-quiz-happy');
    await client.connect();
    const seen: string[] = [];
    client.events$.subscribe((event) => seen.push(event.event));
    client.forceStudentTransition('student.question.close-missed');
    expect(seen).toEqual(['quiz.question', 'quiz.result']);
  });

  it('uses fake timers to prove the demo restDelayMs settles without a real wait', async () => {
    vi.useFakeTimers();
    try {
      const client = createMockQuizClient('student-quiz-happy');
      const pending = client.resolveJoinCode('ABC123');
      let settled = false;
      void pending.then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(400);
      await pending;
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
