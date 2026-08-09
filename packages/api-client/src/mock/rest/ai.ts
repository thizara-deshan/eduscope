import {
  zAiCountdownSnapshot, zCommandAccepted, zPublicationWithQuestion, zQuestion,
  zQuestionSet, zQuestionSetDetail,
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
  // W4-D-2's coupling (Q-02/Q-03 -> Q-11 -> Q-12) means a QuestionSet reaching
  // `ready` mints and broadcasts a genuinely NEW draft that Q-12 never adds to
  // `seed.questions` (it only emits the WS event) — so a later edit/discard/
  // send against that exact id 404s even though the lecturer just saw it in
  // S-14. Mirror it into the seed the moment it is announced, with a
  // placeholder prompt/options (Q-12 carries no real content, same as the
  // rest of this mock's "one representative draft per set" simplification —
  // see ai.ts's module comment).
  world.subscribeEvents((envelope) => {
    if (envelope.event !== 'ai.question' || envelope.payload.state !== 'draft') return;
    if (seed.questions.some((q) => q.id === envelope.payload.questionId)) return;
    if (envelope.payload.provenance !== 'generated') return; // lecturer-authored rows are pushed by createQuestion itself
    const questionId = envelope.payload.questionId;
    const options = (['A', 'B', 'C', 'D'] as const).map((label, i) => ({
      id: seedId('option'), questionId, label, text: `Option ${label}`, position: i,
    }));
    seed.questions.push(
      validated(zQuestion, {
        id: questionId,
        sessionId: seed.questions[0]?.sessionId ?? seedId('session'),
        questionSetId: envelope.payload.setId,
        kind: 'mcq',
        prompt: 'Generated question',
        options,
        correctOptionId: options[0]!.id,
        provenance: 'generated',
        edited: false,
        state: 'draft',
        createdAt: nowIsoZ(world.clock),
        orderHint: null,
      }),
    );
  });

  // Same gap, one machine over: Q-30 (sendToProjector's own resolving
  // transition) mints a publication and only emits `quiz.publication` — it
  // never appears in `seed.publications`, so S-16's listPublications snapshot
  // can never show a question a lecturer just sent, and a later
  // closePublication/setProjector against that id would 404. Mirror it in.
  world.subscribeEvents((envelope) => {
    if (envelope.event !== 'quiz.publication' || envelope.payload.state !== 'publishing') return;
    if (seed.publications.some((p) => p.id === envelope.payload.publicationId)) return;
    const question = seed.questions.find((q) => q.id === envelope.payload.questionId);
    if (!question) return; // the id-correlation fix above always seeds this first; defensive only
    seed.publications.push(
      validated(zPublicationWithQuestion, {
        id: envelope.payload.publicationId,
        questionId: question.id,
        quizSessionId: (world.data['quiz.session.ulid'] as string | undefined) ?? seedId('quiz-session'),
        state: 'publishing',
        publishedAt: null,
        closedAt: null,
        closeReason: null,
        isShowing: false,
        projectorState: 'not-shown',
        syncState: world.state('quiz.sync'),
        question,
        responseCount: 0,
        correctCount: 0,
        incorrectCount: 0,
      }),
    );
  });

  /** Scenario refusal only — does NOT schedule. Split out so commands that
   * target an existing entity can validate the entity before any transition
   * fires (see the four ops below and task-10-report.md's I3 finding: a
   * bogus id must not still drive the machine / broadcast WS events). */
  function checkRefusal(operationId: keyof typeof COMMAND_PLANS): void {
    const refusal = engine.onCommand(operationId);
    if (refusal) throw new ProblemError(refusal);
  }

  function runPlan(operationId: keyof typeof COMMAND_PLANS): void {
    for (const step of COMMAND_PLANS[operationId] ?? []) {
      world.schedule(step.transition, step.afterMs);
    }
  }

  function buildAccepted(): CommandAccepted {
    return validated(zCommandAccepted, {
      commandId: nextUlid(world),
      acceptedAt: nowIsoZ(world.clock),
      resolveBySec: RESOLVE_BY_SEC,
    });
  }

  /** Shared by commands with no pre-existing entity to validate: refusal check, then the plan, then respond. */
  function accept(operationId: keyof typeof COMMAND_PLANS): CommandAccepted {
    checkRefusal(operationId);
    runPlan(operationId);
    return buildAccepted();
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
      if (!body.options || body.options.length === 0) {
        throw new ProblemError({ status: 422, code: 'validation.invalid', title: 'createQuestion requires at least one option' });
      }
      checkRefusal('createQuestion');
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
      // Q-19's own echo must correlate back to THIS row, not mint a stray id.
      world.data['ai.question.ulid'] = questionId;
      runPlan('createQuestion');
      return buildAccepted();
    },

    // Order matters (task-10-report.md I3): refusal check, THEN find/validate
    // the entity, and only once that passes does the transition actually
    // fire — a bogus/immutable id must 404/409 without ever touching the
    // machine or broadcasting a WS event for a command that "failed".
    editQuestion: async (questionId: Ulid, body: QuestionUpdate): Promise<CommandAccepted> => {
      checkRefusal('editQuestion');
      const row = seed.questions.find((q) => q.id === questionId);
      if (!row) throw new ProblemError({ status: 404, code: 'not-found', title: `Unknown question: ${questionId}` });
      if (row.state !== 'draft') {
        throw new ProblemError({ status: 409, code: 'question.immutable', title: 'Only draft questions can be edited' });
      }
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
      // Q-20's own echo must name THIS question, not whatever id an earlier
      // creation event happened to leave tracked.
      world.data['ai.question.ulid'] = questionId;
      runPlan('editQuestion');
      return buildAccepted();
    },

    discardQuestion: async (questionId: Ulid): Promise<CommandAccepted> => {
      checkRefusal('discardQuestion');
      const row = seed.questions.find((q) => q.id === questionId);
      if (!row) throw new ProblemError({ status: 404, code: 'not-found', title: `Unknown question: ${questionId}` });
      if (row.state !== 'draft') {
        throw new ProblemError({ status: 409, code: 'question.immutable', title: 'Only draft questions can be discarded' });
      }
      row.state = 'discarded';
      world.data['ai.question.ulid'] = questionId;
      runPlan('discardQuestion');
      return buildAccepted();
    },

    sendToProjector: async (questionId: Ulid): Promise<CommandAccepted> => {
      checkRefusal('sendToProjector');
      const row = seed.questions.find((q) => q.id === questionId);
      if (!row) throw new ProblemError({ status: 404, code: 'not-found', title: `Unknown question: ${questionId}` });
      row.state = 'sent';
      // Q-30/Q-31's ai.question/quiz.publication echoes must name THIS
      // question, not a freshly-minted stray one (the id-correlation fix).
      world.data['ai.publication.questionId'] = questionId;
      runPlan('sendToProjector');
      return buildAccepted();
    },

    // Returns a fresh array of freshly-validated rows — never the live
    // `seed.publications` reference (task-10-report.md I5: a read must not
    // hand a caller write access to the fixture array).
    listPublications: async (query: { sessionId: Ulid }): Promise<PublicationWithQuestion[]> => {
      void query;
      return seed.publications.map((p) => validated(zPublicationWithQuestion, p));
    },

    closePublication: async (publicationId: Ulid): Promise<CommandAccepted> => {
      checkRefusal('closePublication');
      const row = seed.publications.find((p) => p.id === publicationId);
      if (!row) throw new ProblemError({ status: 404, code: 'not-found', title: `Unknown publication: ${publicationId}` });
      row.state = 'closed';
      row.closedAt = nowIsoZ(world.clock);
      row.closeReason = 'lecturer-closed';
      row.isShowing = false;
      runPlan('closePublication');
      return buildAccepted();
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
