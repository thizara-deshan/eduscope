import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import type { AiQuestionPayload } from '@eduscope/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { auditLogEntries, lectureSessions, logEntries, questionOptions, questions, storageVolumes, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeAiServices } from '../fakes/ai-services.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const NOW = new Date('2026-08-20T09:00:00.000Z');
const BEARER = 'ai-questions-test-internal-bearer';
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

function writeProvisioning(dir: string, overrides: Record<string, unknown> = {}): string {
  const path = join(dir, 'provisioning.json');
  writeFileSync(path, JSON.stringify(fullProvisioning(overrides)));
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
  otherLecturerToken: string;
  adminToken: string;
  questionEvents: AiQuestionPayload[];
}

async function loginAs(app: FastifyInstance, username: string, password: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password, client: 'panel' } });
  return (response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
}

async function createContext(provisioningOverrides: Record<string, unknown> = {}): Promise<TestContext> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-ai-questions-'));
  const pm = new FakePipelineManager({ bearerToken: BEARER });
  const pmBaseUrl = await pm.listen();
  const ai = new FakeAiServices({ bearerToken: BEARER });
  const aiBaseUrls = await ai.listen();
  const provisioningPath = writeProvisioning(dir, provisioningOverrides);

  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'ai-questions-test-secret',
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

  const questionEvents: AiQuestionPayload[] = [];
  app.bus.subscribe('ai.question', (payload) => questionEvents.push(payload));

  const ownerId = ids.next(NOW);
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
    .insert(users)
    .values({
      id: ids.next(NOW),
      username: 'otherlecturer',
      displayName: 'Other Lecturer',
      role: 'lecturer',
      source: 'local',
      passwordHash: await hashPassword('Password1'),
      mustResetPassword: false,
      disabled: false,
      createdAt: NOW.toISOString(),
    })
    .run();
  app.db
    .insert(users)
    .values({
      id: ids.next(NOW),
      username: 'admin1',
      displayName: 'Admin One',
      role: 'admin',
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

  const ownerToken = await loginAs(app, 'owner', 'Password1');
  const otherLecturerToken = await loginAs(app, 'otherlecturer', 'Password1');
  const adminToken = await loginAs(app, 'admin1', 'Password1');

  return { dir, app, clock, pm, ai, ownerToken, ownerId, otherLecturerToken, adminToken, questionEvents };
}

async function destroyContext(ctx: TestContext): Promise<void> {
  await ctx.app.close();
  await ctx.pm.close();
  await ctx.ai.close();
  rmSync(ctx.dir, { recursive: true, force: true });
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

function createBody(prompt = 'What is 2+2?'): Record<string, unknown> {
  return {
    prompt,
    options: [
      { text: '3', isCorrect: false },
      { text: '4', isCorrect: true },
      { text: '5', isCorrect: false },
    ],
  };
}

/** Seeds a question + options directly (bypassing the route), for edit/discard tests that need a specific starting state. */
function seedQuestion(
  ctx: TestContext,
  sessionId: string,
  overrides: { state?: 'draft' | 'sent' | 'closed' | 'discarded'; provenance?: 'generated' | 'lecturer-authored'; questionSetId?: string | null } = {},
): { questionId: string; optionIds: string[]; correctOptionId: string } {
  const now = ctx.clock.now();
  const questionId = ctx.app.ids.next(now);
  const optionIds = [ctx.app.ids.next(now), ctx.app.ids.next(now), ctx.app.ids.next(now)];
  ctx.app.db
    .insert(questions)
    .values({
      id: questionId,
      sessionId,
      questionSetId: overrides.questionSetId ?? null,
      kind: 'mcq',
      prompt: 'Seeded question?',
      correctOptionId: null,
      provenance: overrides.provenance ?? 'lecturer-authored',
      edited: false,
      state: overrides.state ?? 'draft',
      createdAt: now.toISOString(),
      createdBy: overrides.provenance === 'generated' ? null : ctx.ownerId,
      orderHint: null,
    })
    .run();
  ctx.app.db
    .insert(questionOptions)
    .values([
      { id: optionIds[0]!, questionId, label: 'A', text: 'x', position: 0 },
      { id: optionIds[1]!, questionId, label: 'B', text: 'y', position: 1 },
      { id: optionIds[2]!, questionId, label: 'C', text: 'z', position: 2 },
    ])
    .run();
  ctx.app.db.update(questions).set({ correctOptionId: optionIds[1]! }).where(eq(questions.id, questionId)).run();
  return { questionId, optionIds, correctOptionId: optionIds[1]! };
}

describe('Question authoring lifecycle (Q-18..Q-21, machine 2c)', () => {
  let ctx: TestContext;

  afterEach(async () => {
    await delay(50);
    await destroyContext(ctx);
  });

  it('createQuestion: mints ULID options with sequential labels/positions, exactly one correctOptionId, questionSetId null (lecturer-authored)', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);

    const response = await ctx.app.inject({ method: 'POST', url: '/api/v1/ai/questions', headers: { authorization: `Bearer ${ctx.ownerToken}` }, payload: createBody() });
    expect(response.statusCode).toBe(202);

    const row = ctx.app.db.select().from(questions).where(eq(questions.sessionId, sessionId)).get()!;
    expect(row.questionSetId).toBeNull();
    expect(row.provenance).toBe('lecturer-authored');
    expect(row.state).toBe('draft');
    expect(row.createdBy).toBe(ctx.ownerId);

    const options = ctx.app.db.select().from(questionOptions).where(eq(questionOptions.questionId, row.id)).all().sort((a, b) => a.position - b.position);
    expect(options).toHaveLength(3);
    expect(options.map((option) => option.label)).toEqual(['A', 'B', 'C']);
    expect(new Set(options.map((option) => option.id)).size).toBe(3);
    const correct = options.find((option) => option.id === row.correctOptionId)!;
    expect(correct.text).toBe('4');

    expect(ctx.questionEvents).toContainEqual({ questionId: row.id, setId: null, state: 'draft', provenance: 'lecturer-authored', edited: false });

    const audit = ctx.app.db.select().from(auditLogEntries).where(eq(auditLogEntries.entityId, row.id)).all();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorKind: 'user', actorUserId: ctx.ownerId, action: 'create' });
    const logs = ctx.app.db.select().from(logEntries).where(eq(logEntries.sessionId, sessionId)).all();
    expect(logs.filter((log) => log.category === 'Session')).toHaveLength(1);
  });

  it('createQuestion: rejects option counts outside 2-4 and payloads without exactly one correct option', async () => {
    ctx = await createContext();
    await startAndConfirm(ctx);

    const oneOption = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/ai/questions',
      headers: { authorization: `Bearer ${ctx.ownerToken}` },
      payload: { prompt: 'Bad', options: [{ text: 'only one', isCorrect: true }] },
    });
    expect(oneOption.statusCode).toBe(422);

    const twoCorrect = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/ai/questions',
      headers: { authorization: `Bearer ${ctx.ownerToken}` },
      payload: { prompt: 'Bad', options: [{ text: 'a', isCorrect: true }, { text: 'b', isCorrect: true }] },
    });
    expect(twoCorrect.statusCode).toBe(422);

    const zeroCorrect = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/ai/questions',
      headers: { authorization: `Bearer ${ctx.ownerToken}` },
      payload: { prompt: 'Bad', options: [{ text: 'a', isCorrect: false }, { text: 'b', isCorrect: false }] },
    });
    expect(zeroCorrect.statusCode).toBe(422);

    expect(ctx.app.db.select().from(questions).all()).toHaveLength(0);
  });

  it('createQuestion: session owner/admin guard — a non-owner lecturer is refused, admin and owner both succeed', async () => {
    ctx = await createContext();
    await startAndConfirm(ctx);

    const other = await ctx.app.inject({ method: 'POST', url: '/api/v1/ai/questions', headers: { authorization: `Bearer ${ctx.otherLecturerToken}` }, payload: createBody() });
    expect(other.statusCode).toBe(403);

    const admin = await ctx.app.inject({ method: 'POST', url: '/api/v1/ai/questions', headers: { authorization: `Bearer ${ctx.adminToken}` }, payload: createBody('Admin question?') });
    expect(admin.statusCode).toBe(202);

    const owner = await ctx.app.inject({ method: 'POST', url: '/api/v1/ai/questions', headers: { authorization: `Bearer ${ctx.ownerToken}` }, payload: createBody('Owner question?') });
    expect(owner.statusCode).toBe(202);

    expect(ctx.app.db.select().from(questions).all()).toHaveLength(2);
  });

  it('createQuestion: refuses with session.not-active when no recording is active', async () => {
    ctx = await createContext();
    const response = await ctx.app.inject({ method: 'POST', url: '/api/v1/ai/questions', headers: { authorization: `Bearer ${ctx.ownerToken}` }, payload: createBody() });
    expect(response.statusCode).toBe(409);
    expect((response.json() as { code: string }).code).toBe('session.not-active');
  });

  it('createQuestion: refuses with ai.unavailable when the session started with AI disabled', async () => {
    ctx = await createContext({ featureFlags: { recordingEnabled: true, aiQuizEnabled: false, streamingEnabled: false } });
    await startAndConfirm(ctx);
    const response = await ctx.app.inject({ method: 'POST', url: '/api/v1/ai/questions', headers: { authorization: `Bearer ${ctx.ownerToken}` }, payload: createBody() });
    expect(response.statusCode).toBe(409);
    expect((response.json() as { code: string }).code).toBe('ai.unavailable');
  });

  it('editQuestion: updates prompt/options, sets edited=true (including for a generated draft), and writes one audit + one Session log', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);
    const seeded = seedQuestion(ctx, sessionId, { provenance: 'generated' });

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/ai/questions/${seeded.questionId}`,
      headers: { authorization: `Bearer ${ctx.ownerToken}` },
      payload: { prompt: 'Edited prompt?' },
    });
    expect(response.statusCode).toBe(202);

    const row = ctx.app.db.select().from(questions).where(eq(questions.id, seeded.questionId)).get()!;
    expect(row.prompt).toBe('Edited prompt?');
    expect(row.edited).toBe(true);
    expect(row.provenance).toBe('generated'); // edited generated questions keep their provenance, only edited flips

    expect(ctx.questionEvents).toContainEqual({ questionId: seeded.questionId, setId: null, state: 'draft', provenance: 'generated', edited: true });

    const audit = ctx.app.db.select().from(auditLogEntries).where(eq(auditLogEntries.entityId, seeded.questionId)).all();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'edit', actorKind: 'user' });
    expect(audit[0]!.before).toEqual({ prompt: 'Seeded question?' });
    expect(audit[0]!.after).toEqual({ prompt: 'Edited prompt?' });
    const logs = ctx.app.db.select().from(logEntries).where(eq(logEntries.sessionId, sessionId)).all();
    expect(logs.filter((log) => log.category === 'Session')).toHaveLength(1);
  });

  it('editQuestion: replacing options keeps ids for entries that carry one and mints new ones otherwise', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);
    const seeded = seedQuestion(ctx, sessionId);

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/ai/questions/${seeded.questionId}`,
      headers: { authorization: `Bearer ${ctx.ownerToken}` },
      payload: {
        options: [
          { id: seeded.optionIds[0], text: 'kept-a', isCorrect: false },
          { text: 'brand-new', isCorrect: true },
        ],
      },
    });
    expect(response.statusCode).toBe(202);

    const options = ctx.app.db.select().from(questionOptions).where(eq(questionOptions.questionId, seeded.questionId)).all().sort((a, b) => a.position - b.position);
    expect(options).toHaveLength(2);
    expect(options[0]!.id).toBe(seeded.optionIds[0]);
    expect(options[0]!.text).toBe('kept-a');
    expect(options.map((option) => option.id)).not.toContain(seeded.optionIds[1]);
    expect(options.map((option) => option.id)).not.toContain(seeded.optionIds[2]);

    const row = ctx.app.db.select().from(questions).where(eq(questions.id, seeded.questionId)).get()!;
    expect(row.correctOptionId).toBe(options[1]!.id);
  });

  it('editQuestion: rejects an option id that does not belong to the question', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);
    const seeded = seedQuestion(ctx, sessionId);
    const foreign = seedQuestion(ctx, sessionId);

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/ai/questions/${seeded.questionId}`,
      headers: { authorization: `Bearer ${ctx.ownerToken}` },
      payload: { options: [{ id: foreign.optionIds[0], text: 'x', isCorrect: true }, { text: 'y', isCorrect: false }] },
    });
    expect(response.statusCode).toBe(422);
  });

  it('editQuestion: a sent/closed question is immutable — the rejection is itself audited', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);
    const seeded = seedQuestion(ctx, sessionId, { state: 'sent' });

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/ai/questions/${seeded.questionId}`,
      headers: { authorization: `Bearer ${ctx.ownerToken}` },
      payload: { prompt: 'too late' },
    });
    expect(response.statusCode).toBe(409);
    expect((response.json() as { code: string }).code).toBe('question.immutable');

    const row = ctx.app.db.select().from(questions).where(eq(questions.id, seeded.questionId)).get()!;
    expect(row.prompt).toBe('Seeded question?'); // untouched

    const audit = ctx.app.db.select().from(auditLogEntries).where(eq(auditLogEntries.entityId, seeded.questionId)).all();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'edit', reason: 'immutable' });
  });

  it('editQuestion: session owner/admin guard applies to the question\'s own session', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);
    const seeded = seedQuestion(ctx, sessionId);

    const other = await ctx.app.inject({ method: 'PATCH', url: `/api/v1/ai/questions/${seeded.questionId}`, headers: { authorization: `Bearer ${ctx.otherLecturerToken}` }, payload: { prompt: 'nope' } });
    expect(other.statusCode).toBe(403);

    const admin = await ctx.app.inject({ method: 'PATCH', url: `/api/v1/ai/questions/${seeded.questionId}`, headers: { authorization: `Bearer ${ctx.adminToken}` }, payload: { prompt: 'admin edit' } });
    expect(admin.statusCode).toBe(202);
  });

  it('discardQuestion: only a draft question can be discarded; a discarded draft writes one audit + one Session log and emits ai.question{discarded}', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);
    const sent = seedQuestion(ctx, sessionId, { state: 'sent' });
    const draft = seedQuestion(ctx, sessionId, { state: 'draft' });

    const refused = await ctx.app.inject({ method: 'POST', url: `/api/v1/ai/questions/${sent.questionId}/discard`, headers: { authorization: `Bearer ${ctx.ownerToken}` } });
    expect(refused.statusCode).toBe(409);
    expect((refused.json() as { code: string }).code).toBe('question.immutable');

    const accepted = await ctx.app.inject({ method: 'POST', url: `/api/v1/ai/questions/${draft.questionId}/discard`, headers: { authorization: `Bearer ${ctx.ownerToken}` } });
    expect(accepted.statusCode).toBe(202);

    const row = ctx.app.db.select().from(questions).where(eq(questions.id, draft.questionId)).get()!;
    expect(row.state).toBe('discarded');
    expect(ctx.questionEvents).toContainEqual({ questionId: draft.questionId, setId: null, state: 'discarded', provenance: 'lecturer-authored', edited: false });

    const audit = ctx.app.db.select().from(auditLogEntries).where(eq(auditLogEntries.entityId, draft.questionId)).all();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'discard', actorKind: 'user' });
    const logs = ctx.app.db.select().from(logEntries).where(eq(logEntries.sessionId, sessionId)).all();
    expect(logs.filter((log) => log.category === 'Session')).toHaveLength(1);
  });

  it('discardQuestion: 404 for an unknown question id', async () => {
    ctx = await createContext();
    await startAndConfirm(ctx);
    const response = await ctx.app.inject({ method: 'POST', url: '/api/v1/ai/questions/01UNKNOWNQUESTIONID000000/discard', headers: { authorization: `Bearer ${ctx.ownerToken}` } });
    expect(response.statusCode).toBe(404);
  });

  it('listQuestions: scoped by session and optionally filtered by state', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);
    const draft = seedQuestion(ctx, sessionId, { state: 'draft' });
    const discarded = seedQuestion(ctx, sessionId, { state: 'discarded' });

    const all = await ctx.app.inject({ method: 'GET', url: `/api/v1/ai/questions?sessionId=${sessionId}`, headers: { authorization: `Bearer ${ctx.ownerToken}` } });
    expect(all.statusCode).toBe(200);
    const allItems = (all.json() as { items: Array<{ id: string }> }).items;
    expect(allItems.map((item) => item.id).sort()).toEqual([discarded.questionId, draft.questionId].sort());

    const draftsOnly = await ctx.app.inject({ method: 'GET', url: `/api/v1/ai/questions?sessionId=${sessionId}&state=draft`, headers: { authorization: `Bearer ${ctx.ownerToken}` } });
    const draftItems = (draftsOnly.json() as { items: Array<{ id: string }> }).items;
    expect(draftItems.map((item) => item.id)).toEqual([draft.questionId]);
  });
});
