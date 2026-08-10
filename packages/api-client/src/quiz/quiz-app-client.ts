import {
  zQuizAppProblem,
  zRegisterParticipantRequest,
  zRegisterParticipantResponse,
  zResolveJoinCodeResponse,
  zStudentServerEvent,
  zSubmitAnswerRequest,
  zSubmitAnswerResponse,
  type QuizAppProblem,
  type RegisterParticipantRequest,
  type RegisterParticipantResponse,
  type ResolveJoinCodeResponse,
  type StudentServerEvent,
  type SubmitAnswerRequest,
  type SubmitAnswerResponse,
} from '@eduscope/shared';
import { TransportError } from '../errors.js';
import { getScenario } from '../mock/scenario/registry.js';
import type { ScenarioName, StudentQuizScenario } from '../mock/scenario/types.js';
import { createEmitter, type EventStream } from '../stream.js';

export interface QuizAppClient {
  readonly scenario: ScenarioName;
  resolveJoinCode(joinCode: string): Promise<ResolveJoinCodeResponse>;
  registerParticipant(
    quizSessionId: string,
    input: RegisterParticipantRequest,
  ): Promise<RegisterParticipantResponse>;
  submitAnswer(publicationId: string, input: SubmitAnswerRequest): Promise<SubmitAnswerResponse>;
  /** Emits and returns the atomic connect snapshot in contracts/events.md §5.1 order. */
  connect(): Promise<readonly StudentServerEvent[]>;
  readonly events$: EventStream<StudentServerEvent>;
  dispose(): void;
}

export class QuizAppProblemError extends Error {
  readonly problem: QuizAppProblem;
  constructor(problem: QuizAppProblem) {
    super(`${problem.code}: ${problem.title}`);
    this.name = 'QuizAppProblemError';
    this.problem = zQuizAppProblem.parse(problem) as QuizAppProblem;
  }
}

const SESSION_ID = '01JBQ8ZK3T7WBM5N2Q4XPRVC9D';
const PARTICIPANT_ID = '01JBQ8ZK3T7WBM5N2Q4XPRVC9E';
const PUBLICATION_ID = '01JBQ8ZK3T7WBM5N2Q4XPRVC9F';
const OPTION_IDS = [
  '01JBQ8ZK3T7WBM5N2Q4XPRVCA0',
  '01JBQ8ZK3T7WBM5N2Q4XPRVCA1',
  '01JBQ8ZK3T7WBM5N2Q4XPRVCA2',
  '01JBQ8ZK3T7WBM5N2Q4XPRVCA3',
] as const;

const DEFAULT_STUDENT_SCENARIO: StudentQuizScenario = {
  resolution: 'open-anonymous',
  registration: 'created',
  question: 'open-4',
  answer: 'accepted',
  result: 'correct-current',
  summary: 'participated',
  reconnect: false,
};

const REGISTRATION_POLICY = {
  studentIdPattern: '^[A-Z]{2}[0-9]{7,8}$',
  studentIdHint: 'Two uppercase letters followed by 7 or 8 digits',
  inputMode: 'text',
  studentIdMaxLength: 10,
  fullNameMaxLength: 128,
} as const;

function problem(
  status: number,
  code: QuizAppProblem['code'],
  title: string,
  pointer?: string,
): QuizAppProblemError {
  return new QuizAppProblemError({
    status,
    code,
    title,
    ...(pointer ? { fieldViolations: [{ pointer, message: title }] } : {}),
  });
}

function options(count: number) {
  return OPTION_IDS.slice(0, count).map((id, index) => ({
    id,
    label: String.fromCharCode(65 + index),
    text: ['Mercury', 'Venus', 'Earth', 'Mars'][index]!,
  }));
}

/** Contract-backed Wave 7 mock. Every REST response and event is parsed by generated/shared zod. */
export function createMockQuizClient(
  scenario: ScenarioName = 'student-quiz-happy',
): QuizAppClient {
  const script = getScenario(scenario);
  const state = script.studentQuiz ?? DEFAULT_STUDENT_SCENARIO;
  const emitter = createEmitter<StudentServerEvent>();
  let registered = state.resolution === 'open-returning';
  let storedOptionId: string | null = state.answer === 'already-accepted' ? OPTION_IDS[1] : null;
  let replyLossSpent = false;
  let registrationOfflineSpent = false;
  let resolutionOfflineSpent = false;

  const emit = (event: StudentServerEvent): StudentServerEvent => {
    const parsed = zStudentServerEvent.parse(event);
    emitter.emit(parsed);
    return parsed;
  };

  const questionEvent = (): StudentServerEvent => {
    if (state.question === 'none') {
      return { event: 'quiz.question', payload: { state: 'none' } };
    }
    const count = state.question === 'open-2' ? 2 : state.question === 'open-3' ? 3 : 4;
    return {
      event: 'quiz.question',
      payload: {
        state: state.question === 'closed' ? 'closed' : 'open',
        publicationId: PUBLICATION_ID,
        prompt: 'Which planet is known as the Red Planet?',
        options: options(count),
        ownAnswerOptionId: storedOptionId,
      },
    };
  };

  const resultEvent = (): StudentServerEvent | null => {
    if (state.result === 'none') return null;
    const missed = state.result === 'missed-current';
    const correct = state.result === 'correct-current';
    return {
      event: 'quiz.result',
      payload: {
        publicationId: PUBLICATION_ID,
        question: {
          prompt: 'Which planet is known as the Red Planet?',
          options: options(state.question === 'open-2' ? 2 : state.question === 'open-3' ? 3 : 4),
        },
        selectedOptionId: missed ? null : correct ? OPTION_IDS[3] : OPTION_IDS[1],
        isCorrect: missed ? null : correct,
        correctOptionId: OPTION_IDS[3],
        pointsAwarded: correct ? 10 : 0,
        runningScore: correct ? 30 : 20,
        ownRank: state.result === 'incorrect-pending' ? null : 3,
        rankState: state.result === 'incorrect-pending' ? 'pending' : 'current',
      },
    };
  };

  const sessionEvent = (): StudentServerEvent => {
    if (state.summary === 'open') return { event: 'quiz.session', payload: { state: 'open' } };
    if (state.summary === 'none') {
      return {
        event: 'quiz.session',
        payload: {
          state: 'closed', participationState: 'none',
          finalScore: 0, finalRank: null, answeredCount: 0,
        },
      };
    }
    return {
      event: 'quiz.session',
      payload: {
        state: 'closed', participationState: 'participated',
        finalScore: 30, finalRank: 3, answeredCount: 3,
      },
    };
  };

  return {
    scenario,

    async resolveJoinCode(joinCode) {
      if (joinCode.toUpperCase() === 'UNAVAILABLE' || state.resolution === 'unavailable') {
        throw problem(503, 'quiz.unavailable', 'Quiz service unavailable');
      }
      if (!joinCode || joinCode.toUpperCase() === 'INVALID' || state.resolution === 'not-found') {
        throw problem(404, 'quiz.session-not-found', 'Quiz session not found');
      }
      if (state.resolution === 'unreachable-once' && !resolutionOfflineSpent) {
        resolutionOfflineSpent = true;
        throw new TransportError('resolveJoinCode');
      }
      return zResolveJoinCodeResponse.parse({
        quizSessionId: SESSION_ID,
        state: state.resolution === 'closed' ? 'closed' : 'open',
        participantState: registered || state.resolution === 'open-returning' ? 'returning' : 'anonymous',
        registrationPolicy: REGISTRATION_POLICY,
      });
    },

    async registerParticipant(quizSessionId, input) {
      if (input.fullName.trim().length === 0) {
        throw problem(422, 'registration.invalid-name', 'Enter your real name', '/fullName');
      }
      const parsed = zRegisterParticipantRequest.safeParse(input);
      if (!parsed.success) {
        throw problem(
          422,
          parsed.error.issues.some((issue) => issue.path[0] === 'fullName')
            ? 'registration.invalid-name'
            : 'registration.invalid-student-id',
          parsed.error.issues.some((issue) => issue.path[0] === 'fullName')
            ? 'Enter your real name'
            : `Student ID: ${REGISTRATION_POLICY.studentIdHint}`,
          parsed.error.issues.some((issue) => issue.path[0] === 'fullName')
            ? '/fullName'
            : '/studentIdNumber',
        );
      }
      if (quizSessionId !== SESSION_ID) {
        throw problem(404, 'quiz.session-not-found', 'Quiz session not found');
      }
      if (state.registration === 'session-closed' || state.resolution === 'closed') {
        throw problem(409, 'quiz.session-closed', 'Quiz session has closed');
      }
      if (state.registration === 'unavailable') {
        throw problem(503, 'quiz.unavailable', 'Quiz service unavailable');
      }
      if (state.registration === 'offline-once' && !registrationOfflineSpent) {
        registrationOfflineSpent = true;
        throw new TransportError('registerParticipant');
      }
      const outcome = registered || state.registration === 'rejoined' ? 'rejoined' : 'created';
      registered = true;
      return zRegisterParticipantResponse.parse({ quizSessionId: SESSION_ID, participantId: PARTICIPANT_ID, outcome });
    },

    async submitAnswer(publicationId, input) {
      const parsed = zSubmitAnswerRequest.safeParse(input);
      if (!parsed.success || !OPTION_IDS.includes(input.selectedOptionId as (typeof OPTION_IDS)[number])) {
        throw problem(422, 'answer.invalid-option', 'That option is not valid', '/selectedOptionId');
      }
      if (publicationId !== PUBLICATION_ID) {
        throw problem(409, 'question.closed', 'Question has closed');
      }
      if (state.answer === 'question-closed') {
        throw problem(409, 'question.closed', 'Question has closed');
      }
      if (storedOptionId !== null || state.answer === 'already-accepted') {
        return zSubmitAnswerResponse.parse({
          outcome: 'already-accepted',
          selectedOptionId: storedOptionId ?? OPTION_IDS[1],
        });
      }
      storedOptionId = parsed.data.selectedOptionId;
      if (state.answer === 'reply-lost' && !replyLossSpent) {
        replyLossSpent = true;
        throw new TransportError('submitAnswer');
      }
      return zSubmitAnswerResponse.parse({ outcome: 'accepted', selectedOptionId: storedOptionId });
    },

    async connect() {
      if (state.reconnect) {
        emit({ event: 'quiz.participant', payload: { connectionState: 'offline' } });
      }
      const snapshot = [
        sessionEvent(),
        { event: 'quiz.participant', payload: { connectionState: 'online' } } as StudentServerEvent,
        questionEvent(),
        resultEvent(),
      ].filter((event): event is StudentServerEvent => event !== null).map(emit);
      return snapshot;
    },

    events$: { subscribe: emitter.subscribe },
    dispose() {},
  };
}
