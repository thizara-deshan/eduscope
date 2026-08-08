import {
  zLeaderboard, zListPublicationResponsesResponse, zQuizSessionProjection,
  type AnswerProjection, type Leaderboard, type QuizSessionProjection, type Ulid,
} from '@eduscope/shared';
import { ProblemError } from '../../errors.js';
import type { Transition } from '../machines/types.js';
import { validated, nowIsoZ } from '../seed/index.js';
import { PAYLOAD_BUILDERS } from '../world.js';
import type { RestContext } from './index.js';

export function createQuizOperations({ world, seed }: RestContext) {
  return {
    getQuizSession: async (): Promise<QuizSessionProjection> => {
      const tr: Transition = { id: 'snapshot', machine: 'quiz.session', from: [], to: null, effects: [], cite: 'C-9' };
      // quiz.ts's own payload builder (machine 4a) now mirrors the WS event shape
      // field-for-field including `syncState` (CG-19, v0.4) — the one field this
      // fills in is `lectureSessionId`, which is REST-projection-only.
      const payload = PAYLOAD_BUILDERS['quiz.session']!(world, tr);
      return validated(zQuizSessionProjection, {
        ...payload,
        lectureSessionId: (world.data['session.ulid'] as string | undefined) ?? null,
      });
    },

    listPublicationResponses: async (
      publicationId: Ulid,
    ): Promise<{ items: AnswerProjection[]; syncedAt: string; stale: boolean }> => {
      const found = seed.publications.some((p) => p.id === publicationId);
      if (!found) {
        throw new ProblemError({ status: 404, code: 'not-found', title: `Unknown publication: ${publicationId}` });
      }
      return validated(zListPublicationResponsesResponse, {
        items: [],
        syncedAt: nowIsoZ(world.clock),
        stale: world.state('quiz.sync') !== 'synced',
      });
    },

    getLeaderboard: async (query: { sessionId: Ulid }): Promise<Leaderboard> => {
      if (!query.sessionId) {
        throw new ProblemError({ status: 422, code: 'validation.invalid', title: 'getLeaderboard requires sessionId' });
      }
      return validated(zLeaderboard, { ...seed.leaderboard, sessionId: query.sessionId });
    },
  };
}
