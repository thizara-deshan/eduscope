/** Generated zod and TypeScript mirror of contracts/quiz-app.yaml (CG-1).
 * Explicit exports avoid colliding with the core contract's shared `Ulid`. */
export {
  zRegistrationPolicy,
  zResolveJoinCodeResponse,
  zRegisterParticipantRequest,
  zRegisterParticipantResponse,
  zSubmitAnswerRequest,
  zSubmitAnswerResponse,
  zQuizAppProblemCode,
  zFieldViolation,
  zQuizAppProblem,
} from './quiz-generated/zod.gen.js';
export type {
  RegistrationPolicy,
  ResolveJoinCodeResponse,
  RegisterParticipantRequest,
  RegisterParticipantResponse,
  SubmitAnswerRequest,
  SubmitAnswerResponse,
  QuizAppProblemCode,
  FieldViolation,
  QuizAppProblem,
} from './quiz-generated/types.gen.js';
