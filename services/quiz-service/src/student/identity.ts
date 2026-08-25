import type { ZodError } from 'zod';
import type { FieldViolation, QuizAppProblem, QuizAppProblemCode } from '@eduscope/shared';
import { zRegisterParticipantRequest } from '@eduscope/shared';

export interface ResolvedIdentity {
  studentIdNumber: string;
  fullName: string;
}

/** v1 ships only `SelfRegistrationIdentityProvider`; the `redirect` arm exists for a future SSO provider. */
export interface IdentityProvider {
  readonly id: 'self-registration' | 'university-sso';
  resolve(input: unknown): Promise<ResolvedIdentity | { redirect: URL }>;
}

export interface QuizAppProblemErrorOptions {
  detail?: string;
  fieldViolations?: FieldViolation[];
}

/**
 * Student-surface Problem boundary. `quiz-app.yaml`'s closed
 * `QuizAppProblemCode` catalog (registration.*, quiz.*, question.closed,
 * answer.invalid-option) is disjoint from `openapi.yaml`'s `Code` union, so
 * it cannot reuse `contracts/problem.ts`'s device-surface `ProblemError`.
 */
export class QuizAppProblemError extends Error {
  readonly status: number;
  readonly code: QuizAppProblemCode;
  readonly title: string;
  readonly detail?: string;
  readonly fieldViolations?: FieldViolation[];

  constructor(status: number, code: QuizAppProblemCode, title: string, options: QuizAppProblemErrorOptions = {}) {
    super(title);
    this.name = 'QuizAppProblemError';
    this.status = status;
    this.code = code;
    this.title = title;
    if (options.detail !== undefined) this.detail = options.detail;
    if (options.fieldViolations !== undefined) this.fieldViolations = options.fieldViolations;
  }

  toBody(): QuizAppProblem {
    const body: QuizAppProblem = { status: this.status, code: this.code, title: this.title };
    if (this.detail !== undefined) body.detail = this.detail;
    if (this.fieldViolations !== undefined) body.fieldViolations = this.fieldViolations;
    return body;
  }
}

function fieldPointer(path: (string | number)[]): '/fullName' | '/studentIdNumber' {
  return path[0] === 'studentIdNumber' ? '/studentIdNumber' : '/fullName';
}

function toRegistrationProblem(error: ZodError): QuizAppProblemError {
  const fieldViolations: FieldViolation[] = error.issues.map((issue) => ({
    pointer: fieldPointer(issue.path),
    message: issue.message,
  }));
  const code: QuizAppProblemCode = fieldViolations.some((violation) => violation.pointer === '/studentIdNumber')
    ? 'registration.invalid-student-id'
    : 'registration.invalid-name';
  return new QuizAppProblemError(422, code, 'Registration validation failed', { fieldViolations });
}

/** Format validation only (D-21, ADR-012 confirmed) — no roster/API lookup. */
export class SelfRegistrationIdentityProvider implements IdentityProvider {
  readonly id = 'self-registration' as const;

  async resolve(input: unknown): Promise<ResolvedIdentity> {
    const result = zRegisterParticipantRequest.safeParse(input);
    if (!result.success) {
      throw toRegistrationProblem(result.error);
    }

    const fullName = result.data.fullName.trim();
    if (fullName.length === 0) {
      throw new QuizAppProblemError(422, 'registration.invalid-name', 'Full name must not be blank', {
        fieldViolations: [{ pointer: '/fullName', message: 'Full name must not be blank' }],
      });
    }

    return { studentIdNumber: result.data.studentIdNumber, fullName };
  }
}
