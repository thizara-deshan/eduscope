import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { lectureSessions, questionOptions, questions, quizSessionProjections, storageVolumes, users } from '../../src/db/schema.js';
import { SystemClock } from '../../src/lib/clock.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeQuizService } from '../fakes/quiz-service.js';

/**
 * E-49 acceptance witness: the real A+B+D projector integration.
 *
 * - **Real A**: an actual pipeline-manager FastAPI process (its own venv), with
 *   only the GStreamer worker child faked (`EDUSCOPE_PM_PROJECTOR_FAKE_WORKER`)
 *   so no HDMI/X display is required. A's routes, Pydantic models, card
 *   rendering, and QR generation are genuinely exercised.
 * - **Real B**: core-api via `buildApp`, its real `PipelineManagerClient` posting
 *   over HTTP to A and its real `HttpQuizSyncClient` posting over HTTP to D.
 * - **D boundary**: the real-HTTP quiz-sync device peer (`FakeQuizService`),
 *   used because the ordering assertion needs a *delayable* publish ack that a
 *   fixed real quiz-service cannot provide on command. B's quiz-sync fetch path
 *   is genuinely real.
 *
 * Proves: B's exact `PmProjectorRequest` payload parses at A with no translation
 * drift; the projector card is produced only after D's publish ack
 * (publish-before-project); the rendered QR decodes back to D's join URL; the
 * four forbidden privacy fields are rejected 422; and A restarts its display
 * child while B's recording stays live.
 */

const PM_PYTHON = join(__dirname, '../../../pipeline-manager/.venv/bin/python');
const PM_BEARER = 'e49-projector-real-stack-shared-bearer-token-0123456789';
const QUIZ_BEARER = 'e49-projector-real-stack-quiz-device-bearer';
const JOIN_URL = 'https://quiz.example.edu/j/E49REAL';
const JOIN_CODE = 'E49REAL';

async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('could not reserve a port'));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealthz(url: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/healthz`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await delay(150);
  }
  throw new Error(`pipeline-manager did not become healthy at ${url}`);
}

interface RealA {
  readonly url: string;
  readonly runtimeDir: string;
  stop(): Promise<void>;
  projectorStatus(): Promise<{ pgid: number | null; state: string } | null>;
  post(body: unknown): Promise<{ status: number; json: unknown }>;
}

async function startRealA(dir: string): Promise<RealA> {
  const port = await reservePort();
  const runtimeDir = join(dir, 'pm-runtime');
  mkdirSync(runtimeDir, { recursive: true });
  const url = `http://127.0.0.1:${String(port)}`;
  const inline = [
    'import subprocess, uvicorn',
    'from pipeline_manager.app import create_app',
    'from pipeline_manager.config import Settings',
    's = Settings()',
    'app = create_app(s, popen=subprocess.Popen, runtime_dir=s.runtime_dir)',
    "uvicorn.run(app, host=s.bind_host, port=s.port, log_level='warning')",
  ].join('\n');
  const child: ChildProcess = spawn(PM_PYTHON, ['-c', inline], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: {
      ...process.env,
      EDUSCOPE_PM_BIND_HOST: '127.0.0.1',
      EDUSCOPE_PM_PORT: String(port),
      EDUSCOPE_PM_SHARED_BEARER_TOKEN: PM_BEARER,
      EDUSCOPE_PM_RUNTIME_DIR: runtimeDir,
      EDUSCOPE_PM_HELPER_SOCKET: join(dir, 'helper.sock'),
      EDUSCOPE_PM_LED_PRESENT: 'false',
      EDUSCOPE_PM_PROJECTOR_FAKE_WORKER: '1',
    },
  });
  await waitForHealthz(url);

  const post = async (body: unknown): Promise<{ status: number; json: unknown }> => {
    const response = await fetch(`${url}/consumers/projector`, {
      method: 'POST',
      headers: { authorization: `Bearer ${PM_BEARER}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, json: text.length > 0 ? JSON.parse(text) : null };
  };

  const projectorStatus = async (): Promise<{ pgid: number | null; state: string } | null> => {
    const response = await fetch(`${url}/status`, { headers: { authorization: `Bearer ${PM_BEARER}` } });
    if (!response.ok) return null;
    const body = (await response.json()) as { consumers: Array<{ kind: string; pgid: number | null; state: string }> };
    const projector = body.consumers.find((c) => c.kind === 'projector');
    return projector ? { pgid: projector.pgid, state: projector.state } : null;
  };

  return {
    url,
    runtimeDir,
    projectorStatus,
    post,
    async stop(): Promise<void> {
      child.kill('SIGKILL');
      await delay(100);
    },
  };
}

/** Decode the QR in a rendered card via the pipeline-manager venv's zxing-cpp. */
function decodeQr(cardPath: string): string[] {
  const script = 'import sys, zxingcpp\nfrom PIL import Image\nprint("\\n".join(r.text for r in zxingcpp.read_barcodes(Image.open(sys.argv[1]))))';
  const result = spawnSync(PM_PYTHON, ['-c', script, cardPath], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`QR decode failed: ${result.stderr}`);
  return result.stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
}

function cardFiles(runtimeDir: string): string[] {
  try {
    return readdirSync(join(runtimeDir, 'projector')).filter((name) => name.endsWith('.png'));
  } catch {
    return [];
  }
}

interface Stack {
  dir: string;
  app: FastifyInstance;
  a: RealA;
  quiz: FakeQuizService;
  ownerId: string;
  sessionId: string;
  ids: UlidGenerator;
}

let stack: Stack;

const validQuestionPayload = (publicationId: string) => ({
  publicationId,
  prompt: 'Which service renders the projector card?',
  options: [
    { id: 'opt-a', label: 'A', text: 'core-api' },
    { id: 'opt-b', label: 'B', text: 'pipeline-manager' },
  ],
  joinUrl: JOIN_URL,
  joinCode: JOIN_CODE,
});

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'e49-projector-real-stack-'));
  mkdirSync(join(dir, 'recordings'), { recursive: true });
  mkdirSync(join(dir, 'runtime'), { recursive: true });

  const quiz = new FakeQuizService({ bearerToken: QUIZ_BEARER });
  const quizBaseUrl = await quiz.listen();
  const a = await startRealA(dir);

  const provisioningPath = join(dir, 'provisioning.json');
  writeFileSync(provisioningPath, JSON.stringify({
    deviceId: 'device-e49',
    serialNumber: 'E49-REAL',
    instituteProfileId: 'institute-1',
    hallCode: 'LAC001',
    hallDisplayName: 'Lecture Hall 1',
    titlePattern: '{hall} – {date} {time}',
    timezone: 'Asia/Colombo',
    ntpServers: [],
    expectedStorageVolumeUuid: null,
    featureFlags: { recordingEnabled: true, aiQuizEnabled: true, streamingEnabled: false },
    quizServerBaseUrl: quizBaseUrl,
    llmEndpoint: 'http://127.0.0.1:9/llm',
    provisionedAt: '2026-01-01T00:00:00.000+00:00',
    provisionedBy: 'deploy',
  }));

  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'e49-projector-real-stack-jwt-secret-value',
    CORE_API_PROVISIONING_PATH: provisioningPath,
    CORE_API_RECORDINGS_ROOT: join(dir, 'recordings'),
    CORE_API_RUNTIME_DIR: join(dir, 'runtime'),
    CORE_API_PM_BASE_URL: a.url,
    CORE_API_INTERNAL_BEARER: PM_BEARER,
  });

  const clock = new SystemClock();
  const ids = new UlidGenerator();
  const app = await buildApp({ config, clock, ids, quizServiceBaseUrl: quizBaseUrl, quizDeviceBearer: QUIZ_BEARER });
  await app.lifecycle.start();

  const now = new Date();
  const ownerId = ids.next(now);
  app.db.insert(users).values({
    id: ownerId,
    username: 'owner',
    displayName: 'Owner Lecturer',
    role: 'lecturer',
    source: 'local',
    passwordHash: await hashPassword('Password1'),
    mustResetPassword: false,
    disabled: false,
    createdAt: now.toISOString(),
  }).run();
  app.db.insert(storageVolumes).values({
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
  }).run();

  // Seed a live recording session with an open quiz session (join values from D),
  // bypassing the record-consumer spawn so real A is exercised only for the
  // projector — E-49's actual subject.
  const sessionId = ids.next(now);
  app.db.insert(lectureSessions).values({
    id: sessionId,
    title: 'E-49 Lecture',
    hallCode: 'LAC001',
    hallDisplayName: 'Lecture Hall 1',
    deviceId: 'device-e49',
    ownerUserId: ownerId,
    startedByActor: 'user',
    state: 'recording',
    startedAt: now.toISOString(),
    pauseCount: 0,
    channelActivations: [],
    sourceSnapshot: {},
    aiEnabledAtStart: true,
  }).run();
  app.db.insert(quizSessionProjections).values({
    id: ids.next(now),
    lectureSessionId: sessionId,
    deviceId: 'device-e49',
    hallDisplayName: 'Lecture Hall 1',
    joinCode: JOIN_CODE,
    joinUrl: JOIN_URL,
    state: 'open',
    openedAt: now.toISOString(),
    lastAnswerSeq: 0,
  }).run();

  stack = { dir, app, a, quiz, ownerId, sessionId, ids };
}, 60_000);

afterAll(async () => {
  if (!stack) return;
  await stack.app.close().catch(() => undefined);
  await stack.quiz.close().catch(() => undefined);
  await stack.a.stop().catch(() => undefined);
  rmSync(stack.dir, { recursive: true, force: true });
});

async function seedDraftQuestion(): Promise<string> {
  const { app, ids, sessionId } = stack;
  const now = new Date();
  const questionId = ids.next(now);
  const optionA = ids.next(now);
  const optionB = ids.next(now);
  app.db.insert(questions).values({
    id: questionId,
    sessionId,
    questionSetId: null,
    kind: 'mcq',
    prompt: 'Which service renders the projector card?',
    correctOptionId: null,
    provenance: 'lecturer-authored',
    edited: false,
    state: 'draft',
    createdAt: now.toISOString(),
    createdBy: stack.ownerId,
    orderHint: 0,
  }).run();
  app.db.insert(questionOptions).values([
    { id: optionA, questionId, label: 'A', text: 'core-api', position: 0 },
    { id: optionB, questionId, label: 'B', text: 'pipeline-manager', position: 1 },
  ]).run();
  app.db.update(questions).set({ correctOptionId: optionB }).where(eq(questions.id, questionId)).run();
  return questionId;
}

async function login(): Promise<string> {
  const response = await stack.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'owner', password: 'Password1', client: 'panel' } });
  return (response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
}

describe('E-49 projector real A+B+D stack', () => {
  it('produces the card only after D acks the publish, and its QR decodes to D\'s join URL (publish-before-project + payload parity)', async () => {
    const token = await login();
    const questionId = await seedDraftQuestion();
    const before = cardFiles(stack.a.runtimeDir).length;

    // Delay D's publish ack so the publish-before-project ordering is observable.
    stack.quiz.setResponseDelay(1_200);
    const response = await stack.app.inject({
      method: 'POST',
      url: `/api/v1/ai/questions/${questionId}/send-to-projector`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(202);

    // Mid-delay: B is still awaiting D's ack, so A must not have rendered a card.
    await delay(400);
    expect(cardFiles(stack.a.runtimeDir).length).toBe(before);

    // After the ack + projector switch: exactly one new card appears — strictly
    // after D received the publish (publish-before-project).
    let cards: string[] = [];
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      cards = cardFiles(stack.a.runtimeDir);
      if (cards.length > before) break;
      await delay(100);
    }
    stack.quiz.setResponseDelay(0);
    expect(cards.length).toBe(before + 1);
    expect(stack.quiz.calls.some((c) => c.path === '/device/v1/publications')).toBe(true);

    const cardPath = join(stack.a.runtimeDir, 'projector', cards[cards.length - 1]!);
    const decoded = decodeQr(cardPath);
    expect(decoded).toContain(JOIN_URL);
  });

  it('rejects the four forbidden privacy fields with 422 (no leaderboard/participant/score/answer)', async () => {
    for (const forbidden of ['leaderboard', 'participantCount', 'score', 'studentId']) {
      const payload = { mode: 'question', questionPayload: { ...validQuestionPayload('pub-privacy'), [forbidden]: 'nope' } };
      const { status } = await stack.a.post(payload);
      expect(status).toBe(422);
    }
  });

  it('accepts B\'s exact question payload shape directly at A (202, no translation drift)', async () => {
    const { status, json } = await stack.a.post({ mode: 'question', questionPayload: validQuestionPayload('pub-direct') });
    expect(status).toBe(202);
    expect((json as { state?: string }).state).toBeDefined();
    const card = join(stack.a.runtimeDir, 'projector', 'pub-direct.png');
    expect(readFileSync(card).length).toBeGreaterThan(0);
  });

  it('withdraws back to passthrough on B setProjector(null)', async () => {
    const token = await login();
    const response = await stack.app.inject({
      method: 'PUT',
      url: '/api/v1/ai/projector',
      headers: { authorization: `Bearer ${token}` },
      payload: { publicationId: null },
    });
    expect(response.statusCode).toBe(202);
    // A accepts a direct passthrough switch too.
    const { status } = await stack.a.post({ mode: 'passthrough' });
    expect(status).toBe(202);
  });

  it('restarts A\'s projector display child while B\'s recording stays live', async () => {
    // Ensure the projector child is running.
    await stack.a.post({ mode: 'question', questionPayload: validQuestionPayload('pub-restart') });
    const first = await stack.a.projectorStatus();
    expect(first?.pgid).toBeTypeOf('number');

    // Kill only A's projector process group — B is never touched.
    process.kill(-(first!.pgid as number), 'SIGKILL');

    // A drops the dead child; a subsequent projector command respawns it with a new pgid.
    await delay(600);
    await stack.a.post({ mode: 'question', questionPayload: validQuestionPayload('pub-restart-2') });
    let second = await stack.a.projectorStatus();
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && (second === null || second.pgid === first!.pgid)) {
      await delay(150);
      second = await stack.a.projectorStatus();
    }
    expect(second?.pgid).toBeTypeOf('number');
    expect(second!.pgid).not.toBe(first!.pgid);

    // B's recording session is unaffected by the display child's restart.
    const session = stack.app.db.select().from(lectureSessions).where(eq(lectureSessions.id, stack.sessionId)).get()!;
    expect(session.state).toBe('recording');
  });
});
