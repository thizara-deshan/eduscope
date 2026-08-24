import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import type { QuizSessionPayload } from '@eduscope/shared';
import { eq } from 'drizzle-orm';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { answerProjections, lectureSessions, questionOptions, questionPublications, questions, quizSessionProjections, storageVolumes, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeAiServices } from '../fakes/ai-services.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const FIRST_CONSUMER_ID = 'record:00000001';
const DEFAULT_INTERNAL_BEARER = 'quiz-sync-peer-internal-bearer';
const DEFAULT_NOW = new Date('2026-08-20T08:00:00.000Z');

export interface QuizSyncPeerOptions {
  /** Base URL of the quiz-service (D) instance under test. Real D (D-08) or `FakeQuizService` (B's own pre-existing tests) — the peer never constructs or fakes this side itself. */
  quizServiceBaseUrl: string;
  quizDeviceId: string;
  quizDeviceBearer: string;
  now?: Date;
  provisioningOverrides?: Record<string, unknown>;
  internalBearer?: string;
}

export interface AnswerProjectionRow {
  id: string;
  publicationId: string;
  studentIdNumber: string;
  studentDisplayName: string;
  selectedOptionId: string;
  isCorrect: boolean;
  responseTimeMs: number;
  submittedAt: string;
  syncedAt: string;
}

export interface QuizSessionSnapshot {
  state: string;
  joinCode: string | null;
  joinUrl: string | null;
  joinedCount: number;
  syncState: string | null;
}

export interface PublishedQuestion {
  publicationId: string;
  questionId: string;
  optionAId: string;
  optionBId: string;
}

export interface QuizSyncPeer {
  readonly app: FastifyInstance;
  readonly clock: FakeClock;
  readonly pm: FakePipelineManager;
  readonly ai: FakeAiServices;
  readonly dir: string;
  readonly ownerToken: string;
  readonly sessionEvents: QuizSessionPayload[];
  startRecordingAndConfirm(): Promise<{ lectureSessionId: string; quizSessionId: string }>;
  publishQuestion(prompt?: string): Promise<PublishedQuestion>;
  advanceClock(ms: number): void;
  snapshotQuizSession(): Promise<QuizSessionSnapshot>;
  listAnswerProjections(publicationId: string): AnswerProjectionRow[];
  watermark(quizSessionId: string): number;
  close(): Promise<void>;
}

function fullProvisioning(deviceId: string, overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    deviceId,
    serialNumber: 'SN-1',
    instituteProfileId: 'institute-1',
    hallCode: 'LAC001',
    hallDisplayName: 'Lecture Hall 1',
    titlePattern: '{hall} – {date} {time}',
    timezone: 'Asia/Colombo',
    ntpServers: [],
    expectedStorageVolumeUuid: null,
    featureFlags: { recordingEnabled: true, aiQuizEnabled: true, streamingEnabled: false },
    quizServerBaseUrl: null,
    llmEndpoint: 'http://127.0.0.1:9/llm',
    provisionedAt: '2026-01-01T00:00:00.000+00:00',
    provisionedBy: 'deploy',
    ...overrides,
  };
}

export async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error('quiz-sync-peer: waitFor condition not met in time');
    await delay(5);
  }
}

async function loginAs(app: FastifyInstance, username: string, password: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password, client: 'panel' } });
  return (response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
}

/**
 * B's device-side quiz-sync half (`QuizSessionMachine`, `QuizSyncStream`, the
 * answer-projection watermark) wired to a caller-supplied quiz-service base
 * URL/device credential. Extracted from `test/quiz/sync.test.ts` (which keeps
 * consuming this same peer against its own `FakeQuizService`, proving the
 * extraction is behavior-preserving); D-08 supplies real D instead. Never
 * fakes D REST/WS itself and never touches B production source.
 */
export async function startCoreQuizSyncPeer(options: QuizSyncPeerOptions): Promise<QuizSyncPeer> {
  const now = options.now ?? DEFAULT_NOW;
  const internalBearer = options.internalBearer ?? DEFAULT_INTERNAL_BEARER;
  const dir = mkdtempSync(join(tmpdir(), 'core-api-quiz-sync-peer-'));
  const pm = new FakePipelineManager({ bearerToken: internalBearer });
  const pmBaseUrl = await pm.listen();
  const ai = new FakeAiServices({ bearerToken: internalBearer });
  const aiBaseUrls = await ai.listen();

  const provisioningPath = join(dir, 'provisioning.json');
  writeFileSync(provisioningPath, JSON.stringify(fullProvisioning(options.quizDeviceId, options.provisioningOverrides ?? {})));

  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'quiz-sync-peer-test-secret',
    CORE_API_PROVISIONING_PATH: provisioningPath,
    CORE_API_RECORDINGS_ROOT: join(dir, 'recordings'),
    CORE_API_RUNTIME_DIR: join(dir, 'runtime'),
    CORE_API_PM_BASE_URL: pmBaseUrl,
    CORE_API_INTERNAL_BEARER: internalBearer,
  });

  const clock = new FakeClock(now);
  const ids = new UlidGenerator();
  const app = await buildApp({ config, clock, ids, aiBaseUrls, quizServiceBaseUrl: options.quizServiceBaseUrl, quizDeviceBearer: options.quizDeviceBearer });
  await app.lifecycle.start();
  await waitFor(() => pm.openConnectionCount === 1);

  const sessionEvents: QuizSessionPayload[] = [];
  app.bus.subscribe('quiz.session', (payload) => sessionEvents.push(payload));

  const ownerId = ids.next(now);
  app.db
    .insert(users)
    .values({
      id: ownerId,
      username: 'owner',
      displayName: 'Owner Lecturer',
      role: 'lecturer',
      source: 'local',
      passwordHash: await hashPassword('Password1'),
      mustResetPassword: false,
      disabled: false,
      createdAt: now.toISOString(),
    })
    .run();
  app.db
    .insert(storageVolumes)
    .values({
      id: ids.next(now),
      uuid: 'recordings-volume-1',
      devicePath: '/dev/sda1',
      mountPath: '/media/eduscope',
      filesystem: 'ext4',
      capacityBytes: 1_000_000_000_000,
      freeBytes: 500_000_000_000,
      smartStatus: 'good',
      role: 'recordings',
      state: 'mounted',
      registeredAt: now.toISOString(),
    })
    .run();

  const ownerToken = await loginAs(app, 'owner', 'Password1');

  function currentLectureSession(): typeof lectureSessions.$inferSelect {
    return app.db.select().from(lectureSessions).all()[0]!;
  }

  return {
    app,
    clock,
    pm,
    ai,
    dir,
    ownerToken,
    sessionEvents,

    async startRecordingAndConfirm() {
      const response = await app.inject({ method: 'POST', url: '/api/v1/recording/start', headers: { authorization: `Bearer ${ownerToken}` } });
      if (response.statusCode !== 202) throw new Error(`quiz-sync-peer: recording/start returned ${String(response.statusCode)}`);
      await waitFor(() => pm.calls.some((call) => call.path === '/consumers/record'));
      pm.publish('evt.pm.consumer.running', { consumerId: FIRST_CONSUMER_ID, pgid: 1 });
      await waitFor(() => currentLectureSession().state === 'recording');
      const lectureSessionId = currentLectureSession().id;
      await waitFor(() => app.db.select().from(quizSessionProjections).where(eq(quizSessionProjections.lectureSessionId, lectureSessionId)).get()?.state === 'open');
      const quizSessionId = app.db.select().from(quizSessionProjections).where(eq(quizSessionProjections.lectureSessionId, lectureSessionId)).get()!.id;
      return { lectureSessionId, quizSessionId };
    },

    async publishQuestion(prompt = 'What is 2+2?') {
      const create = await app.inject({
        method: 'POST',
        url: '/api/v1/ai/questions',
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { prompt, options: [{ text: '3', isCorrect: false }, { text: '4', isCorrect: true }] },
      });
      if (create.statusCode !== 202) throw new Error(`quiz-sync-peer: ai/questions returned ${String(create.statusCode)}`);
      const question = app.db.select().from(questions).where(eq(questions.prompt, prompt)).all().at(-1)!;
      const options = app.db.select().from(questionOptions).where(eq(questionOptions.questionId, question.id)).orderBy(questionOptions.position).all();

      const send = await app.inject({ method: 'POST', url: `/api/v1/ai/questions/${question.id}/send-to-projector`, headers: { authorization: `Bearer ${ownerToken}` } });
      if (send.statusCode !== 202) throw new Error(`quiz-sync-peer: send-to-projector returned ${String(send.statusCode)}`);
      await waitFor(() => app.db.select().from(questionPublications).where(eq(questionPublications.questionId, question.id)).get()?.state === 'open');
      const publication = app.db.select().from(questionPublications).where(eq(questionPublications.questionId, question.id)).get()!;
      return { publicationId: publication.id, questionId: question.id, optionAId: options[0]!.id, optionBId: options[1]!.id };
    },

    advanceClock(ms: number) {
      clock.advance(ms);
    },

    async snapshotQuizSession() {
      const response = await app.inject({ method: 'GET', url: '/api/v1/quiz/session', headers: { authorization: `Bearer ${ownerToken}` } });
      return response.json() as QuizSessionSnapshot;
    },

    listAnswerProjections(publicationId: string) {
      return app.db.select().from(answerProjections).where(eq(answerProjections.publicationId, publicationId)).all();
    },

    watermark(quizSessionId: string) {
      return app.db.select().from(quizSessionProjections).where(eq(quizSessionProjections.id, quizSessionId)).get()!.lastAnswerSeq;
    },

    async close() {
      await app.close();
      await pm.close();
      await ai.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
