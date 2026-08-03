import {
  zAiCountdownSnapshot, zCommandAccepted, zQuestion, zQuestionSet,
  zQuestionSetDetail,
  type AiCountdownSnapshot, type CommandAccepted, type IntervalMinutes,
  type ProjectorRequest, type PublicationWithQuestion, type Question,
  type QuestionCreate, type QuestionSet, type QuestionSetDetail,
  type QuestionState, type QuestionUpdate, type SetIntervalRequest, type Ulid,
} from '@eduscope/shared';
import { ProblemError } from '../../errors.js';
import type { Transition } from '../machines/types.js';
import { COMMAND_PLANS, RESOLVE_BY_SEC } from '../commands.js';
import { validated, nowIsoZ, seedId } from '../seed/index.js';
import { PAYLOAD_BUILDERS, nextUlid } from '../world.js';
import type { RestContext } from './index.js';

/** `zIntervalMinutes` is `z.unknown()` (see seed/ai.ts's SeededQuestionSet comment) — narrow it back to the generated literal union at the REST boundary. */
function asIntervalMinutes(n: unknown): IntervalMinutes {
  return n === 10 || n === 15 || n === 20 || n === 30 ? n : 20;
}

export function createAiOperations({ world, engine, seed }: RestContext) {
  function accept(operationId: keyof typeof COMMAND_PLANS): CommandAccepted {
    const refusal = engine.onCommand(operationId);
    if (refusal) throw new ProblemError(refusal);
    for (const step of COMMAND_PLANS[operationId] ?? []) {
      world.schedule(step.transition, step.afterMs);
    }
    return validated(zCommandAccepted, {
      commandId: nextUlid(world),
      acceptedAt: nowIsoZ(world.clock),
      resolveBySec: RESOLVE_BY_SEC,
    });
  }

  return {
    getAiCountdown: async (): Promise<AiCountdownSnapshot> => {
      const tr: Transition = { id: 'snapshot', machine: 'ai.countdown', from: [], to: null, effects: [], cite: 'C-9' };
      const parsed = validated(zAiCountdownSnapshot, PAYLOAD_BUILDERS['ai.countdown']!(world, tr));
      return { ...parsed, intervalMinutes: asIntervalMinutes(parsed.intervalMinutes) };
    },

    // Q-10's own effect hardcodes intervalMinutes=30 regardless of the
    // request body (state-machines.md's own table, not this mock) — noted
    // in task-10-report.md.
    setAiInterval: async (body: SetIntervalRequest): Promise<CommandAccepted> => {
      void body;
      return accept('setAiInterval');
    },

    generateNow: async (): Promise<CommandAccepted> => accept('generateNow'),

    // A single-session mock: every session-scoped read below ignores the
    // `sessionId` filter and returns the whole seeded set (task-10-report.md).
    listQuestionSets: async (query: { sessionId: Ulid }): Promise<QuestionSet[]> => {
      void query;
      return seed.questionSets.map((row) => {
        const parsed = validated(zQuestionSet, row);
        return { ...parsed, intervalMinutesAtRequest: asIntervalMinutes(parsed.intervalMinutesAtRequest) };
      });
    },

    getQuestionSet: async (setId: Ulid): Promise<QuestionSetDetail> => {
      const row = seed.questionSets.find((s) => s.id === setId);
      if (!row) throw new ProblemError({ status: 404, code: 'not-found', title: `Unknown question set: ${setId}` });
      const questions = seed.questions.filter((q) => q.questionSetId === setId);
      const parsed = validated(zQuestionSetDetail, { ...row, questions });
      return { ...parsed, intervalMinutesAtRequest: asIntervalMinutes(parsed.intervalMinutesAtRequest) };
    },

    listQuestions: async (query: { sessionId: Ulid; state?: QuestionState }): Promise<Question[]> => {
      void query;
      const rows = query.state ? seed.questions.filter((q) => q.state === query.state) : seed.questions;
      return rows.map((q) => validated(zQuestion, q));
    },

    createQuestion: async (body: QuestionCreate): Promise<CommandAccepted> => {
      const accepted = accept('createQuestion');
      const questionId = seedId('question');
      const options = body.options.map((o, i) => ({
        id: seedId('option'),
        questionId,
        label: (['A', 'B', 'C', 'D'] as const)[i]!,
        text: o.text,
        position: i,
      }));
      const correct = options[body.options.findIndex((o) => o.isCorrect)];
      seed.questions.push(
        validated(zQuestion, {
          id: questionId,
          sessionId: seed.questions[0]?.sessionId ?? seedId('session'),
          questionSetId: null,
          kind: 'mcq',
          prompt: body.prompt,
          options,
          correctOptionId: correct?.id ?? null,
          provenance: 'lecturer-authored',
          edited: false,
          state: 'draft',
          createdAt: nowIsoZ(world.clock),
          orderHint: null,
        }),
      );
      return accepted;
    },

    editQuestion: async (questionId: Ulid, body: QuestionUpdate): Promise<CommandAccepted> => {
      const row = seed.questions.find((q) => q.id === questionId);
      if (!row) throw new ProblemError({ status: 404, code: 'not-found', title: `Unknown question: ${questionId}` });
      if (row.state !== 'draft') {
        throw new ProblemError({ status: 409, code: 'question.immutable', title: 'Only draft questions can be edited' });
      }
      const accepted = accept('editQuestion');
      if (body.prompt !== undefined) row.prompt = body.prompt;
      if (body.options !== undefined) {
        row.options = body.options.map((o, i) => ({
          id: o.id ?? seedId('option'),
          questionId,
          label: (['A', 'B', 'C', 'D'] as const)[i]!,
          text: o.text,
          position: i,
        }));
        row.correctOptionId = row.options[body.options.findIndex((o) => o.isCorrect)]?.id ?? null;
      }
      row.edited = true;
      return accepted;
    },

    discardQuestion: async (questionId: Ulid): Promise<CommandAccepted> => {
      const row = seed.questions.find((q) => q.id === questionId);
      if (!row) throw new ProblemError({ status: 404, code: 'not-found', title: `Unknown question: ${questionId}` });
      if (row.state !== 'draft') {
        throw new ProblemError({ status: 409, code: 'question.immutable', title: 'Only draft questions can be discarded' });
      }
      const accepted = accept('discardQuestion');
      row.state = 'discarded';
      return accepted;
    },

    sendToProjector: async (questionId: Ulid): Promise<CommandAccepted> => {
      const row = seed.questions.find((q) => q.id === questionId);
      if (!row) throw new ProblemError({ status: 404, code: 'not-found', title: `Unknown question: ${questionId}` });
      const accepted = accept('sendToProjector');
      row.state = 'sent';
      return accepted;
    },

    listPublications: async (query: { sessionId: Ulid }): Promise<PublicationWithQuestion[]> => {
      void query;
      return seed.publications;
    },

    closePublication: async (publicationId: Ulid): Promise<CommandAccepted> => {
      const row = seed.publications.find((p) => p.id === publicationId);
      if (!row) throw new ProblemError({ status: 404, code: 'not-found', title: `Unknown publication: ${publicationId}` });
      const accepted = accept('closePublication');
      row.state = 'closed';
      row.closedAt = nowIsoZ(world.clock);
      row.closeReason = 'lecturer-closed';
      row.isShowing = false;
      return accepted;
    },

    setProjector: async (body: ProjectorRequest): Promise<CommandAccepted> => {
      const accepted = accept('setProjector');
      for (const pub of seed.publications) {
        pub.projectorState = pub.id === body.publicationId ? 'showing' : 'not-shown';
      }
      return accepted;
    },
  };
}
