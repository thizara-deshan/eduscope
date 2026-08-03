/**
 * ⚠ PROVISIONAL — blocked on CG-1.
 *
 * screen-inventory §10 CG-1 / events.md open item C-6: the student-facing REST
 * surface (join, register, answer submission) is quiz-service-owned and HAS NO
 * CONTRACT FILE. The shapes below are this scaffold's best reading of Z-10…Z-26
 * and exist so apps/quiz can be built and demoed on a mock — they are NOT a
 * contract and MUST be reconciled against `contracts/quiz-app.yaml` when it
 * lands. The event half is different: `StudentServerEvent` IS contract-backed
 * and is validated exactly like the panel's events.
 */
import { zStudentServerEvent, type StudentServerEvent } from '@eduscope/shared';
import { createEmitter, type EventStream } from '../stream.js';

export interface QuizIdentity {
  readonly participantId: string;
  readonly displayName: string;
  readonly studentIdNumber: string;
  readonly quizSessionId: string;
}

export interface QuizAppClient {
  /** CG-1 */ resolveSession(joinCode: string): Promise<{ quizSessionId: string; state: 'open' | 'closed' } | null>;
  /** CG-1 */ register(joinCode: string, input: { displayName: string; studentIdNumber: string }): Promise<QuizIdentity>;
  /** CG-1 */ submitAnswer(publicationId: string, optionId: string): Promise<{ accepted: boolean; reason?: 'closed' | 'already-answered' }>;
  /** Contract-backed (events.md §4 note). */
  readonly events$: EventStream<StudentServerEvent>;
  dispose(): void;
}

const STUDENT_ID = /^[A-Z]{2}\d{8}$/;

export function createMockQuizClient(): QuizAppClient {
  const emitter = createEmitter<StudentServerEvent>();
  const participants = new Map<string, QuizIdentity>();
  let counter = 0;
  const ulid = () => `01JBQ8ZK3T7WBM5N2Q4XPRVC${String(counter++).padStart(2, '0')}`;

  return {
    async resolveSession(joinCode) {
      return joinCode ? { quizSessionId: ulid(), state: 'open' } : null;
    },

    async register(joinCode, input) {
      if (input.displayName.trim().length === 0) {
        throw new Error('A real name is required (QZ-3)');
      }
      // [D-21]: FORMAT-validated only. Not checked against a roster in V1.
      if (!STUDENT_ID.test(input.studentIdNumber)) {
        throw new Error('That student id is not in the expected format');
      }
      // INV-QP-1: rejoining never creates a second participant.
      const key = `${joinCode}:${input.studentIdNumber}`;
      const existing = participants.get(key);
      if (existing) return existing;
      const identity: QuizIdentity = {
        participantId: ulid(),
        displayName: input.displayName.trim(),
        studentIdNumber: input.studentIdNumber,
        quizSessionId: ulid(),
      };
      participants.set(key, identity);
      return identity;
    },

    async submitAnswer() {
      // Z-22: the first tap is final; a second is REJECTED, not overwritten.
      return { accepted: true };
    },

    events$: {
      subscribe(listener) {
        return emitter.subscribe((e) => {
          listener(zStudentServerEvent.parse(e));
        });
      },
    },

    dispose() {},
  };
}
