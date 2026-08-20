import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import type { AiCountdownPayload, AiQuestionPayload, AiSetPayload } from '@eduscope/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { openDatabase } from '../../src/db/client.js';
import { auditLogEntries, lectureSessions, logEntries, questionOptions, questions, questionSets, slideCaptures, storageVolumes, transcriptSegments, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeAiServices } from '../fakes/ai-services.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';
import { eq } from 'drizzle-orm';

const NOW = new Date('2026-08-20T08:00:00.000Z');
const BEARER = 'ai-generation-test-internal-bearer';
const FIRST_CONSUMER_ID = 'record:00000001';

function fullProvisioning(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    deviceId: 'device-1',
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

function writeProvisioning(dir: string): string {
  const path = join(dir, 'provisioning.json');
  writeFileSync(path, JSON.stringify(fullProvisioning()));
  return path;
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition not met in time');
    await delay(5);
  }
}

interface TestContext {
  dir: string;
  app: FastifyInstance;
  clock: FakeClock;
  pm: FakePipelineManager;
  ai: FakeAiServices;
  ownerToken: string;
  ownerId: string;
  setEvents: AiSetPayload[];
  questionEvents: AiQuestionPayload[];
}

async function loginAs(app: FastifyInstance, username: string, password: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password, client: 'panel' } });
  return (response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
}

async function createContext(dbPath?: string): Promise<TestContext> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-ai-generation-'));
  const pm = new FakePipelineManager({ bearerToken: BEARER });
  const pmBaseUrl = await pm.listen();
  const ai = new FakeAiServices({ bearerToken: BEARER });
  const aiBaseUrls = await ai.listen();
  const provisioningPath = writeProvisioning(dir);

  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: dbPath ?? join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'ai-generation-test-secret',
    CORE_API_PROVISIONING_PATH: provisioningPath,
    CORE_API_RECORDINGS_ROOT: join(dir, 'recordings'),
    CORE_API_RUNTIME_DIR: join(dir, 'runtime'),
    CORE_API_PM_BASE_URL: pmBaseUrl,
    CORE_API_INTERNAL_BEARER: BEARER,
  });

  const clock = new FakeClock(NOW);
  const ids = new UlidGenerator();
  const app = await buildApp({ config, clock, ids, aiBaseUrls });
  await app.lifecycle.start();
  await waitFor(() => pm.openConnectionCount === 1);

  const setEvents: AiSetPayload[] = [];
  app.bus.subscribe('ai.set', (payload) => setEvents.push(payload));
  const questionEvents: AiQuestionPayload[] = [];
  app.bus.subscribe('ai.question', (payload) => questionEvents.push(payload));

  let ownerId = app.db.select({ id: users.id }).from(users).where(eq(users.username, 'owner')).get()?.id ?? '';
  if (!ownerId) {
    ownerId = ids.next(NOW);
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
        createdAt: NOW.toISOString(),
      })
      .run();
    app.db
      .insert(storageVolumes)
      .values({
        id: ids.next(NOW),
        uuid: 'recordings-volume-1',
        devicePath: '/dev/sda1',
        mountPath: '/media/eduscope',
        filesystem: 'ext4',
        capacityBytes: 1_000_000_000_000,
        freeBytes: 500_000_000_000,
        smartStatus: 'good',
        role: 'recordings',
        state: 'mounted',
        registeredAt: NOW.toISOString(),
      })
      .run();
  }

  const ownerToken = await loginAs(app, 'owner', 'Password1');

  return { dir, app, clock, pm, ai, ownerToken, ownerId, setEvents, questionEvents };
}

async function destroyContext(ctx: TestContext, keepDir = false): Promise<void> {
  await ctx.app.close();
  await ctx.pm.close();
  await ctx.ai.close();
  if (!keepDir) rmSync(ctx.dir, { recursive: true, force: true });
}

function currentSession(ctx: TestContext): typeof lectureSessions.$inferSelect {
  return ctx.app.db.select().from(lectureSessions).all()[0]!;
}

async function startAndConfirm(ctx: TestContext): Promise<string> {
  const response = await ctx.app.inject({ method: 'POST', url: '/api/v1/recording/start', headers: { authorization: `Bearer ${ctx.ownerToken}` } });
  expect(response.statusCode).toBe(202);
  await waitFor(() => ctx.pm.calls.some((call) => call.path === '/consumers/record'));
  ctx.pm.publish('evt.pm.consumer.running', { consumerId: FIRST_CONSUMER_ID, pgid: 1 });
  await waitFor(() => currentSession(ctx).state === 'recording');
  return currentSession(ctx).id;
}

async function getCountdown(ctx: TestContext): Promise<AiCountdownPayload> {
  const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/ai/countdown', headers: { authorization: `Bearer ${ctx.ownerToken}` } });
  return response.json() as AiCountdownPayload;
}

async function triggerGeneration(ctx: TestContext): Promise<void> {
  const response = await ctx.app.inject({ method: 'POST', url: '/api/v1/ai/generate-now', headers: { authorization: `Bearer ${ctx.ownerToken}` } });
  expect(response.statusCode).toBe(202);
}

function validGeneratedItem(prompt = 'What is 2+2?'): { prompt: string; options: Array<{ text: string; isCorrect: boolean }> } {
  return {
    prompt,
    options: [
      { text: '3', isCorrect: false },
      { text: '4', isCorrect: true },
      { text: '5', isCorrect: false },
    ],
  };
}

function insertTranscriptSegment(ctx: TestContext, sessionId: string, startOffsetMs: number, endOffsetMs: number, text = 'lecture content'): void {
  ctx.app.db
    .insert(transcriptSegments)
    .values({
      id: ctx.app.ids.next(ctx.clock.now()),
      sessionId,
      startOffsetMs,
      endOffsetMs,
      text,
      confidence: 0.9,
      engine: 'vosk',
      modelVersion: 'v1',
      createdAt: ctx.clock.now().toISOString(),
    })
    .run();
}

function insertSlideCapture(ctx: TestContext, sessionId: string, offsetMs: number): string {
  const id = ctx.app.ids.next(ctx.clock.now());
  ctx.app.db
    .insert(slideCaptures)
    .values({
      id,
      sessionId,
      capturedAt: ctx.clock.now().toISOString(),
      offsetMs,
      imagePath: null,
      ocrText: 'slide text',
      dedupeHash: `hash-${String(offsetMs)}`,
      isSlideChange: true,
    })
    .run();
  return id;
}

describe('Question-set generation lifecycle (Q-11..Q-16, machine 2b)', () => {
  let ctx: TestContext;

  afterEach(async () => {
    await delay(50);
    await destroyContext(ctx);
  });

  it('Q-11: computes inputWindow from the previous ready set toOffsetMs and includes captured slides', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);
    insertTranscriptSegment(ctx, sessionId, 0, 5000, 'first window text');
    insertSlideCapture(ctx, sessionId, 2000);

    ctx.ai.queueGenerateBehaviors([{ kind: 'response', body: { questionSetId: 'x', promptVersion: 'mcq/v1', modelId: 'llama', requested: 3, returned: 1, droppedInvalid: 0, questions: [validGeneratedItem()] } }]);
    await triggerGeneration(ctx);
    await waitFor(() => ctx.setEvents.some((event) => event.state === 'ready'));

    const firstCall = ctx.ai.questionCalls.find((call) => call.path === '/generate')!;
    const firstBody = firstCall.body as { transcript: { fromOffsetMs: number; toOffsetMs: number; text: string }; slides: Array<{ offsetMs: number }> };
    expect(firstBody.transcript.fromOffsetMs).toBe(0);
    expect(firstBody.transcript.toOffsetMs).toBe(5000);
    expect(firstBody.transcript.text).toContain('first window text');
    expect(firstBody.slides).toEqual([{ offsetMs: 2000, ocrText: 'slide text' }]);

    // Second cycle: transcript arrives past the first set's toOffsetMs; the new window must start there, not from 0.
    insertTranscriptSegment(ctx, sessionId, 5000, 9000, 'second window text');
    ctx.ai.queueGenerateBehaviors([{ kind: 'response', body: { questionSetId: 'y', promptVersion: 'mcq/v1', modelId: 'llama', requested: 3, returned: 1, droppedInvalid: 0, questions: [validGeneratedItem('Second?')] } }]);
    await triggerGeneration(ctx);
    await waitFor(() => ctx.setEvents.filter((event) => event.state === 'ready').length === 2);

    const secondCall = ctx.ai.questionCalls.filter((call) => call.path === '/generate').at(-1)!;
    const secondBody = secondCall.body as { transcript: { fromOffsetMs: number; toOffsetMs: number } };
    expect(secondBody.transcript.fromOffsetMs).toBe(5000);
    expect(secondBody.transcript.toOffsetMs).toBe(9000);
  });

  it('Q-12: mixed valid/invalid survivor persistence, ULID-minted options, and provenance', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);

    ctx.ai.queueGenerateBehaviors([
      {
        kind: 'response',
        body: {
          questionSetId: 'x',
          promptVersion: 'mcq/v1',
          modelId: 'llama-3',
          requested: 3,
          returned: 3,
          droppedInvalid: 2,
          questions: [
            validGeneratedItem('Valid one?'),
            { prompt: 'Two correct', options: [{ text: 'a', isCorrect: true }, { text: 'b', isCorrect: true }] },
            { prompt: 'Too many options', options: [{ text: 'a', isCorrect: true }, { text: 'b', isCorrect: false }, { text: 'c', isCorrect: false }, { text: 'd', isCorrect: false }, { text: 'e', isCorrect: false }] },
          ],
        },
      },
    ]);
    await triggerGeneration(ctx);
    await waitFor(() => ctx.setEvents.some((event) => event.state === 'ready'));

    const readyEvent = ctx.setEvents.find((event) => event.state === 'ready')!;
    expect(readyEvent.count).toBe(1);

    const draftQuestions = ctx.app.db.select().from(questions).where(eq(questions.sessionId, sessionId)).all();
    expect(draftQuestions).toHaveLength(1);
    const question = draftQuestions[0]!;
    expect(question.provenance).toBe('generated');
    expect(question.state).toBe('draft');
    expect(question.prompt).toBe('Valid one?');

    const options = ctx.app.db.select().from(questionOptions).where(eq(questionOptions.questionId, question.id)).all();
    expect(options).toHaveLength(3);
    const ids = new Set(options.map((option) => option.id));
    expect(ids.size).toBe(3); // every option minted a unique ULID
    const correct = options.find((option) => option.id === question.correctOptionId)!;
    expect(correct.text).toBe('4');
    expect(options.map((option) => option.label).sort()).toEqual(['A', 'B', 'C']);

    expect(ctx.questionEvents).toContainEqual({ questionId: question.id, setId: readyEvent.setId, state: 'draft', provenance: 'generated', edited: false });

    const auditRows = ctx.app.db.select().from(auditLogEntries).where(eq(auditLogEntries.entityId, question.id)).all();
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({ actorKind: 'system', action: 'create', entityType: 'question' });

    const sessionLogs = ctx.app.db.select().from(logEntries).where(eq(logEntries.sessionId, sessionId)).all();
    expect(sessionLogs.filter((log) => log.category === 'Session' && log.service === 'ai')).toHaveLength(1);
  });

  it('Q-13/Q-14: unreachable classification retries twice with 10s/30s backoff before degrading', async () => {
    ctx = await createContext();
    await startAndConfirm(ctx);

    ctx.ai.queueGenerateBehaviors([
      { kind: 'status', status: 503, body: { code: 'llm.unreachable', title: 'unreachable', status: 503 } },
      { kind: 'status', status: 503, body: { code: 'llm.unreachable', title: 'unreachable', status: 503 } },
      { kind: 'status', status: 503, body: { code: 'llm.unreachable', title: 'unreachable', status: 503 } },
    ]);
    await triggerGeneration(ctx);
    await waitFor(() => ctx.ai.questionCalls.filter((call) => call.path === '/generate').length === 1);

    ctx.clock.advance(10_000); // T-LLM-RETRY step 1
    await waitFor(() => ctx.ai.questionCalls.filter((call) => call.path === '/generate').length === 2);
    expect(ctx.setEvents.some((event) => event.state === 'generating' && event.attempt === 1)).toBe(true);

    ctx.clock.advance(30_000); // T-LLM-RETRY step 2
    await waitFor(() => ctx.ai.questionCalls.filter((call) => call.path === '/generate').length === 3);

    await waitFor(() => ctx.setEvents.some((event) => event.state === 'failed'));
    const failed = ctx.setEvents.find((event) => event.state === 'failed')!;
    expect(failed.error).toBe('unreachable');
    expect(failed.attempt).toBe(2);

    await waitFor(async () => (await getCountdown(ctx)).state === 'degraded');
  });

  it('Q-13: timeout classification fires after the outer T-LLM-REQUEST deadline', async () => {
    ctx = await createContext();
    await startAndConfirm(ctx);

    ctx.ai.queueGenerateBehaviors([{ kind: 'hang' }, { kind: 'hang' }, { kind: 'hang' }]);
    await triggerGeneration(ctx);
    await waitFor(() => ctx.ai.questionCalls.filter((call) => call.path === '/generate').length === 1);

    ctx.clock.advance(45_000); // T-LLM-REQUEST
    await waitFor(() => ctx.setEvents.some((event) => event.state === 'generating' && event.attempt === 1));

    ctx.clock.advance(10_000);
    await waitFor(() => ctx.ai.questionCalls.filter((call) => call.path === '/generate').length === 2);
    ctx.clock.advance(45_000);
    await waitFor(() => ctx.setEvents.some((event) => event.state === 'generating' && event.attempt === 2));

    ctx.clock.advance(30_000);
    await waitFor(() => ctx.ai.questionCalls.filter((call) => call.path === '/generate').length === 3);
    ctx.clock.advance(45_000);

    await waitFor(() => ctx.setEvents.some((event) => event.state === 'failed'));
    const failed = ctx.setEvents.find((event) => event.state === 'failed')!;
    expect(failed.error).toBe('timeout');
  });

  it('zero-survivor / invalid-payload: exactly one automatic regeneration, then a visible failed set that leaves the countdown armed (not degraded)', async () => {
    ctx = await createContext();
    await startAndConfirm(ctx);

    const zeroSurvivorResponse = { questionSetId: 'x', promptVersion: 'mcq/v1', modelId: 'llama', requested: 3, returned: 0, droppedInvalid: 3, questions: [] };
    ctx.ai.queueGenerateBehaviors([{ kind: 'response', body: zeroSurvivorResponse }, { kind: 'response', body: zeroSurvivorResponse }, { kind: 'response', body: zeroSurvivorResponse }]);
    await triggerGeneration(ctx);
    await waitFor(() => ctx.ai.questionCalls.filter((call) => call.path === '/generate').length === 1);

    ctx.clock.advance(10_000); // the one automatic regeneration
    await waitFor(() => ctx.ai.questionCalls.filter((call) => call.path === '/generate').length === 2);

    await waitFor(() => ctx.setEvents.some((event) => event.state === 'failed'));
    const failed = ctx.setEvents.find((event) => event.state === 'failed')!;
    expect(failed.error).toBe('invalid-payload');
    // invalid-payload never appears in Q-05's guard (error ∈ {timeout, unreachable}) — the countdown returns to `armed`, not `degraded`.
    await waitFor(async () => (await getCountdown(ctx)).state === 'armed');
    expect(ctx.ai.questionCalls.filter((call) => call.path === '/generate')).toHaveLength(2); // no third attempt

    const setRow = ctx.app.db.select().from(questionSets).all().find((row) => row.state === 'failed')!;
    expect(setRow.error).toBe('invalid-payload');
  });

  it('Q-16: a new ready set supersedes the previous one, discarding its drafts, while lecturer-authored questions survive', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);

    // A lecturer-authored question predates any generation and must never be touched by supersession.
    const lecturerQuestionId = ctx.app.ids.next(ctx.clock.now());
    ctx.app.db
      .insert(questions)
      .values({
        id: lecturerQuestionId,
        sessionId,
        questionSetId: null,
        kind: 'mcq',
        prompt: 'Lecturer question',
        correctOptionId: null,
        provenance: 'lecturer-authored',
        edited: false,
        state: 'draft',
        createdAt: ctx.clock.now().toISOString(),
        createdBy: ctx.ownerId,
        orderHint: null,
      })
      .run();

    ctx.ai.queueGenerateBehaviors([{ kind: 'response', body: { questionSetId: 'a', promptVersion: 'mcq/v1', modelId: 'llama', requested: 3, returned: 1, droppedInvalid: 0, questions: [validGeneratedItem('First set question')] } }]);
    await triggerGeneration(ctx);
    await waitFor(() => ctx.setEvents.filter((event) => event.state === 'ready').length === 1);
    const firstSetId = ctx.setEvents.find((event) => event.state === 'ready')!.setId;
    const firstQuestion = ctx.app.db.select().from(questions).where(eq(questions.questionSetId, firstSetId)).get()!;

    ctx.ai.queueGenerateBehaviors([{ kind: 'response', body: { questionSetId: 'b', promptVersion: 'mcq/v1', modelId: 'llama', requested: 3, returned: 1, droppedInvalid: 0, questions: [validGeneratedItem('Second set question')] } }]);
    await triggerGeneration(ctx);
    await waitFor(() => ctx.setEvents.filter((event) => event.state === 'ready').length === 2);

    const supersededSet = ctx.app.db.select().from(questionSets).where(eq(questionSets.id, firstSetId)).get()!;
    expect(supersededSet.state).toBe('discarded');

    const supersededQuestion = ctx.app.db.select().from(questions).where(eq(questions.id, firstQuestion.id)).get()!;
    expect(supersededQuestion.state).toBe('discarded');
    expect(ctx.questionEvents).toContainEqual({ questionId: firstQuestion.id, setId: null, state: 'discarded', provenance: 'generated', edited: false });

    const supersessionAudit = ctx.app.db.select().from(auditLogEntries).where(eq(auditLogEntries.entityId, firstQuestion.id)).all();
    expect(supersessionAudit.some((row) => row.action === 'discard' && row.actorKind === 'system' && row.reason === 'superseded')).toBe(true);

    const lecturerQuestion = ctx.app.db.select().from(questions).where(eq(questions.id, lecturerQuestionId)).get()!;
    expect(lecturerQuestion.state).toBe('draft');
    expect(lecturerQuestion.questionSetId).toBeNull();
  });

  it('restart retains ready sets and questions', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);
    const dbPath = ctx.app.config.dbPath;

    ctx.ai.queueGenerateBehaviors([{ kind: 'response', body: { questionSetId: 'x', promptVersion: 'mcq/v1', modelId: 'llama', requested: 3, returned: 1, droppedInvalid: 0, questions: [validGeneratedItem()] } }]);
    await triggerGeneration(ctx);
    await waitFor(() => ctx.setEvents.some((event) => event.state === 'ready'));

    const beforeSets = ctx.app.db.select().from(questionSets).where(eq(questionSets.sessionId, sessionId)).all();
    const beforeQuestions = ctx.app.db.select().from(questions).where(eq(questions.sessionId, sessionId)).all();

    await ctx.app.close(); // release the sqlite handle before a second process reopens the same file (KEEP-style restart pattern, recording/lifecycle.test.ts)
    const reopened = openDatabase(dbPath);
    try {
      const afterSets = reopened.db.select().from(questionSets).where(eq(questionSets.sessionId, sessionId)).all();
      const afterQuestions = reopened.db.select().from(questions).where(eq(questions.sessionId, sessionId)).all();
      expect(afterSets).toHaveLength(beforeSets.length);
      expect(afterSets[0]!.state).toBe('ready');
      expect(afterQuestions).toHaveLength(beforeQuestions.length);
    } finally {
      reopened.close();
    }
  });
});
