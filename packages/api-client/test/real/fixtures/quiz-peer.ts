import { spawnJsonPeer, type PeerProcess } from './core-peer.js';

export interface QuizPeerReady {
  readonly type: 'ready';
  readonly service: 'quiz';
  readonly baseUrl: string;
  readonly tlsBaseUrl: string;
  readonly controlUrl: string;
  readonly fixtureIds: {
    readonly deviceId: string;
    readonly quizSessionId: string;
    readonly joinCode: string;
  };
}

export function startQuizPeer(env: Record<string, string>): Promise<PeerProcess<QuizPeerReady>> {
  return spawnJsonPeer('@eduscope/quiz-service', 'services/quiz-service', 'test/peers/e2e-process-entry.ts', env);
}
