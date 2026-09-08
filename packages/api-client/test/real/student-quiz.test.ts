import { describe, expect, it, vi } from 'vitest';
import type { StudentEventEnvelope, StudentServerEvent } from '@eduscope/shared';
import { TransportError } from '../../src/errors.js';
import { QuizAppProblemError } from '../../src/quiz/quiz-app-client.js';
import { createRealQuizAppClient } from '../../src/quiz/real-quiz-app-client.js';
import type {
  StudentWebSocketFactory,
  StudentWebSocketLike,
} from '../../src/quiz/student-stream.js';

const SESSION = '01JBQ8ZK3T7WBM5N2Q4XPRVC9D';
const PARTICIPANT = '01JBQ8ZK3T7WBM5N2Q4XPRVC9E';
const PUBLICATION = '01JBQ8ZK3T7WBM5N2Q4XPRVC9F';
const OPTION = '01JBQ8ZK3T7WBM5N2Q4XPRVCA0';

const resolution = {
  quizSessionId: SESSION,
  state: 'open',
  participantState: 'anonymous',
  registrationPolicy: {
    studentIdPattern: '^[A-Z]{2}[0-9]{7,8}$',
    studentIdHint: 'Two uppercase letters followed by 7 or 8 digits',
    inputMode: 'text',
    studentIdMaxLength: 10,
    fullNameMaxLength: 128,
  },
};

class FakeSocket implements StudentWebSocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly close = vi.fn((code?: number, reason?: string) => {
    this.onclose?.({ code: code ?? 1000, reason: reason ?? '' });
  });
  constructor(readonly url: string) {}
  open() { this.onopen?.(); }
  deliver(frame: StudentEventEnvelope) { this.onmessage?.({ data: JSON.stringify(frame) }); }
}

function sockets() {
  const all: FakeSocket[] = [];
  const factory: StudentWebSocketFactory = (url) => {
    const socket = new FakeSocket(url);
    all.push(socket);
    return socket;
  };
  return { all, factory, last: () => all.at(-1)! };
}

function envelope(event: StudentServerEvent, seq: number): StudentEventEnvelope {
  return { ...event, at: '2026-09-04T10:00:00.000Z', seq } as StudentEventEnvelope;
}

const session = (state: 'open' | 'closed' = 'open'): StudentServerEvent => state === 'open'
  ? { event: 'quiz.session', payload: { state: 'open' } }
  : {
      event: 'quiz.session',
      payload: {
        state: 'closed', participationState: 'participated',
        finalScore: 10, finalRank: 1, answeredCount: 1,
      },
    };
const participant = (connectionState: 'online' | 'offline' = 'online'): StudentServerEvent => ({
  event: 'quiz.participant', payload: { connectionState },
});
const question = (state: 'open' | 'closed' | 'none' = 'open'): StudentServerEvent => state === 'none'
  ? { event: 'quiz.question', payload: { state: 'none' } }
  : {
      event: 'quiz.question',
      payload: {
        state, publicationId: PUBLICATION, prompt: 'Question?', ownAnswerOptionId: OPTION,
        options: [
          { id: OPTION, label: 'A', text: 'One' },
          { id: '01JBQ8ZK3T7WBM5N2Q4XPRVCA1', label: 'B', text: 'Two' },
        ],
      },
    };
const result: StudentServerEvent = {
  event: 'quiz.result',
  payload: {
    publicationId: PUBLICATION,
    question: {
      prompt: 'Question?',
      options: [
        { id: OPTION, label: 'A', text: 'One' },
        { id: '01JBQ8ZK3T7WBM5N2Q4XPRVCA1', label: 'B', text: 'Two' },
      ],
    },
    selectedOptionId: OPTION,
    isCorrect: true,
    correctOptionId: OPTION,
    pointsAwarded: 10,
    runningScore: 10,
    ownRank: 1,
    rankState: 'current',
  },
};

describe('real student REST client', () => {
  it('encodes paths, validates bodies, and includes cookies on all three operations', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const bodies = [
      resolution,
      { quizSessionId: SESSION, participantId: PARTICIPANT, outcome: 'created' },
      { outcome: 'accepted', selectedOptionId: OPTION },
    ];
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(bodies.shift()), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });
    const ws = sockets();
    const client = createRealQuizAppClient({
      baseUrl: 'https://quiz.example.edu', fetch, webSocket: ws.factory,
    });

    await expect(client.resolveJoinCode('AB C/12')).resolves.toEqual(resolution);
    await client.registerParticipant(SESSION, { fullName: 'K. Fernando', studentIdNumber: 'IT12345678' });
    await client.submitAnswer(PUBLICATION, { selectedOptionId: OPTION });

    expect(calls.map((call) => call.url)).toEqual([
      'https://quiz.example.edu/api/student/v1/join-codes/AB%20C%2F12',
      `https://quiz.example.edu/api/student/v1/quiz-sessions/${SESSION}/participants`,
      `https://quiz.example.edu/api/student/v1/publications/${PUBLICATION}/answers`,
    ]);
    expect(calls.every((call) => call.init.credentials === 'include')).toBe(true);
    expect(JSON.stringify(calls)).not.toContain('participantCredential');
    client.dispose();
  });

  it('surfaces named Problems and distinguishes network/schema failures', async () => {
    const problemClient = createRealQuizAppClient({
      baseUrl: 'https://quiz.example.edu',
      fetch: async () => new Response(JSON.stringify({
        status: 404, code: 'quiz.session-not-found', title: 'Not found',
      }), { status: 404, headers: { 'content-type': 'application/problem+json' } }),
      webSocket: sockets().factory,
    });
    await expect(problemClient.resolveJoinCode('NOPE')).rejects.toBeInstanceOf(QuizAppProblemError);

    const networkClient = createRealQuizAppClient({
      baseUrl: 'https://quiz.example.edu',
      fetch: async () => { throw new Error('offline'); },
      webSocket: sockets().factory,
    });
    await expect(networkClient.resolveJoinCode('ABC123')).rejects.toBeInstanceOf(TransportError);

    const malformedClient = createRealQuizAppClient({
      baseUrl: 'https://quiz.example.edu',
      fetch: async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      webSocket: sockets().factory,
    });
    await expect(malformedClient.resolveJoinCode('ABC123')).rejects.toBeInstanceOf(TransportError);
  });

  it('does not retry or queue an answer after an ambiguous network failure', async () => {
    const fetch = vi.fn(async () => { throw new Error('reply lost'); });
    const client = createRealQuizAppClient({
      baseUrl: 'https://quiz.example.edu', fetch, webSocket: sockets().factory,
    });
    await expect(client.submitAnswer(PUBLICATION, { selectedOptionId: OPTION }))
      .rejects.toBeInstanceOf(TransportError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('real student snapshot stream', () => {
  it('uses a cookie-only socket and resolves the ordered three-frame open snapshot', async () => {
    const ws = sockets();
    const client = createRealQuizAppClient({
      baseUrl: 'https://quiz.example.edu/base', fetch: vi.fn(), webSocket: ws.factory,
    });
    const promise = client.connect();
    expect(ws.last().url).toBe('wss://quiz.example.edu/base/api/student/v1/stream');
    ws.last().open();
    ws.last().deliver(envelope(session(), 10));
    ws.last().deliver(envelope(participant(), 11));
    ws.last().deliver(envelope(question('open'), 12));
    await expect(promise).resolves.toEqual([session(), participant(), question('open')]);
    client.dispose();
  });

  it('waits for result after a closed question and emits only later live deltas', async () => {
    const ws = sockets();
    const client = createRealQuizAppClient({
      baseUrl: 'https://quiz.example.edu', fetch: vi.fn(), webSocket: ws.factory,
    });
    const seen: StudentServerEvent[] = [];
    client.events$.subscribe((event) => seen.push(event));
    let settled = false;
    const promise = client.connect().then((snapshot) => { settled = true; return snapshot; });
    const socket = ws.last();
    socket.open();
    socket.deliver(envelope(session(), 1));
    socket.deliver(envelope(participant(), 2));
    socket.deliver(envelope(question('closed'), 3));
    await Promise.resolve();
    expect(settled).toBe(false);
    socket.deliver(envelope(result, 4));
    await expect(promise).resolves.toHaveLength(4);
    socket.deliver(envelope(participant('offline'), 5));
    await Promise.resolve();
    expect(seen).toEqual([participant('offline')]);
    client.dispose();
  });

  it('rejects malformed/order/sequence-gap frames and replaces the prior socket on reconnect', async () => {
    const ws = sockets();
    const client = createRealQuizAppClient({
      baseUrl: 'https://quiz.example.edu', fetch: vi.fn(), webSocket: ws.factory,
    });
    const first = client.connect();
    ws.last().open();
    ws.last().deliver(envelope(participant(), 1));
    await expect(first).rejects.toBeInstanceOf(TransportError);
    expect(ws.last().close).toHaveBeenCalled();

    const second = client.connect();
    const secondSocket = ws.last();
    secondSocket.open();
    secondSocket.deliver(envelope(session(), 8));
    secondSocket.deliver(envelope(participant(), 9));
    secondSocket.deliver(envelope(question('none'), 11));
    await expect(second).rejects.toBeInstanceOf(TransportError);
    expect(secondSocket.close).toHaveBeenCalled();

    const third = client.connect();
    expect(ws.all).toHaveLength(3);
    expect(secondSocket.close).toHaveBeenCalled();
    ws.last().open();
    ws.last().deliver(envelope(session(), 20));
    ws.last().deliver(envelope(participant(), 21));
    ws.last().deliver(envelope(question('none'), 22));
    await expect(third).resolves.toHaveLength(3);
    client.dispose();
  });
});
