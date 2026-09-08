import {
  zQuizAppProblem,
  zRegisterParticipantRequest,
  zRegisterParticipantResponse,
  zResolveJoinCodeResponse,
  zSubmitAnswerRequest,
  zSubmitAnswerResponse,
  type QuizAppProblem,
  type RegisterParticipantRequest,
  type RegisterParticipantResponse,
  type ResolveJoinCodeResponse,
  type SubmitAnswerRequest,
  type SubmitAnswerResponse,
} from '@eduscope/shared';
import type { z } from 'zod';
import { TransportError } from '../errors.js';
import { QuizAppProblemError, type QuizAppClient } from './quiz-app-client.js';
import {
  createStudentStream,
  type StudentWebSocketFactory,
  type StudentWebSocketLike,
} from './student-stream.js';

export type QuizFetch = (url: string, init: RequestInit) => Promise<Response>;

const defaultWebSocket: StudentWebSocketFactory = (url) => {
  const Ctor = (globalThis as { WebSocket?: new (url: string) => unknown }).WebSocket;
  if (!Ctor) throw new Error('createRealQuizAppClient: no WebSocket implementation available');
  return new Ctor(url) as StudentWebSocketLike;
};

export function createRealQuizAppClient(options: {
  baseUrl: string;
  fetch?: QuizFetch;
  webSocket?: StudentWebSocketFactory;
}): QuizAppClient {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!fetchImpl) throw new Error('createRealQuizAppClient: no fetch implementation available');
  const base = `${options.baseUrl.replace(/\/+$/, '')}/api/student/v1`;
  const stream = createStudentStream({
    baseUrl: options.baseUrl,
    webSocket: options.webSocket ?? defaultWebSocket,
  });

  const request = async <T>(input: {
    operation: string;
    method: 'GET' | 'POST';
    path: string;
    body?: unknown;
    response: z.ZodType<T>;
  }): Promise<T> => {
    const headers = new Headers();
    const init: RequestInit = { method: input.method, headers, credentials: 'include' };
    if (input.body !== undefined) {
      headers.set('content-type', 'application/json');
      init.body = JSON.stringify(input.body);
    }
    let response: Response;
    try {
      response = await fetchImpl(`${base}${input.path}`, init);
    } catch (error) {
      throw new TransportError(input.operation, { cause: error });
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new TransportError(input.operation, { cause: error });
    }
    if (!response.ok) {
      const problem = zQuizAppProblem.safeParse(body);
      if (problem.success) throw new QuizAppProblemError(problem.data as QuizAppProblem);
      throw new TransportError(input.operation);
    }
    const parsed = input.response.safeParse(body);
    if (!parsed.success) throw new TransportError(input.operation, { cause: parsed.error });
    return parsed.data;
  };

  return {
    scenario: null,
    resolveJoinCode(joinCode: string): Promise<ResolveJoinCodeResponse> {
      return request({
        operation: 'resolveJoinCode', method: 'GET',
        path: `/join-codes/${encodeURIComponent(joinCode)}`,
        response: zResolveJoinCodeResponse,
      });
    },
    registerParticipant(
      quizSessionId: string,
      input: RegisterParticipantRequest,
    ): Promise<RegisterParticipantResponse> {
      return request({
        operation: 'registerParticipant', method: 'POST',
        path: `/quiz-sessions/${encodeURIComponent(quizSessionId)}/participants`,
        body: zRegisterParticipantRequest.parse(input),
        response: zRegisterParticipantResponse,
      });
    },
    submitAnswer(publicationId: string, input: SubmitAnswerRequest): Promise<SubmitAnswerResponse> {
      return request({
        operation: 'submitAnswer', method: 'POST',
        path: `/publications/${encodeURIComponent(publicationId)}/answers`,
        body: zSubmitAnswerRequest.parse(input),
        response: zSubmitAnswerResponse,
      });
    },
    connect: () => stream.connect(),
    events$: stream.events$,
    dispose: () => stream.dispose(),
  };
}

export type { StudentWebSocketFactory, StudentWebSocketLike } from './student-stream.js';
