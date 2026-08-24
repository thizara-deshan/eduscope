import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_MIGRATIONS_DIR, migrate } from '../../src/db/migrate.js';
import * as schema from '../../src/db/schema.js';
import { answers, devices, publications, quizSessions, students } from '../../src/db/schema.js';
import type { QuizDb } from '../../src/db/client.js';
import { chunkAnswers, replayAnswers, REPLAY_CHUNK_SIZE } from '../../src/device/replay.js';
import { startTestPostgres, type TestPostgres } from '../helpers/postgres.js';

interface SeededSession {
  quizSessionId: string;
  publicationId: string;
}

async function seedSession(db: QuizDb): Promise<SeededSession> {
  const deviceId = randomUUID();
  await db.insert(devices).values({ deviceId, credentialHash: 'hash', hallDisplayName: 'Hall', createdAt: new Date() });
  const quizSessionId = randomUUID();
  await db.insert(quizSessions).values({
    id: quizSessionId,
    lectureSessionId: randomUUID(),
    deviceId,
    hallDisplayName: 'Hall',
    joinCode: randomUUID().slice(0, 6).toUpperCase(),
    joinUrl: 'https://example.edu/j/ABCDEF',
    state: 'open',
    openedAt: new Date(),
  });
  const publicationId = randomUUID();
  await db.insert(publications).values({
    id: publicationId,
    quizSessionId,
    questionId: randomUUID(),
    prompt: 'Q?',
    options: [
      { id: 'opt-a', label: 'A', text: 'A' },
      { id: 'opt-b', label: 'B', text: 'B' },
    ],
    correctOptionId: 'opt-a',
    state: 'open',
    publishedAt: new Date(),
  });
  return { quizSessionId, publicationId };
}

let globalStudentCounter = 0;

/** Bulk-inserts `count` distinct students/answers with sequential `seq` starting at 1 — two round trips regardless of count. */
async function seedAnswers(
  db: QuizDb,
  quizSessionId: string,
  publicationId: string,
  count: number,
): Promise<void> {
  const now = new Date();
  const studentRows: (typeof students.$inferInsert)[] = [];
  const answerRows: (typeof answers.$inferInsert)[] = [];
  for (let seq = 1; seq <= count; seq += 1) {
    const studentId = randomUUID();
    globalStudentCounter += 1;
    studentRows.push({
      id: studentId,
      studentIdNumber: `ST${globalStudentCounter.toString().padStart(7, '0')}`,
      fullName: `Student ${seq}`,
      authMethod: 'self-registered',
      createdAt: now,
      lastSeenAt: now,
    });
    answerRows.push({
      id: randomUUID(),
      quizSessionId,
      publicationId,
      studentId,
      selectedOptionId: 'opt-a',
      isCorrect: true,
      pointsAwarded: 10,
      responseTimeMs: 500,
      submittedAt: now,
      seq,
    });
  }
  await db.insert(students).values(studentRows);
  await db.insert(answers).values(answerRows);
}

describe('device answer replay (events.md §4)', () => {
  let pg: TestPostgres;
  let sql: Sql;
  let db: QuizDb;

  beforeAll(async () => {
    pg = await startTestPostgres();
    sql = postgres(pg.connectionString, { max: 5 });
    db = drizzle(sql, { schema });
    await migrate(sql, DEFAULT_MIGRATIONS_DIR);
  }, 60_000);

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
    await pg?.stop();
  });

  it('returns only rows above the watermark, ordered by seq, with the exact device-facing shape', async () => {
    const { quizSessionId, publicationId } = await seedSession(db);
    await seedAnswers(db, quizSessionId, publicationId, 5);

    const rows = await replayAnswers(db, quizSessionId, 2);
    expect(rows.map((row) => row.seq)).toEqual([3, 4, 5]);
    expect(Object.keys(rows[0]!).sort()).toEqual(
      [
        'answerId',
        'isCorrect',
        'publicationId',
        'responseTimeMs',
        'seq',
        'selectedOptionId',
        'studentDisplayName',
        'studentIdNumber',
        'submittedAt',
      ].sort(),
    );
  });

  it('returns no rows when the watermark is at or above the highest seq', async () => {
    const { quizSessionId, publicationId } = await seedSession(db);
    await seedAnswers(db, quizSessionId, publicationId, 3);

    expect(await replayAnswers(db, quizSessionId, 3)).toEqual([]);
    expect(await replayAnswers(db, quizSessionId, 99)).toEqual([]);
  });

  it('returns every row for watermark 0', async () => {
    const { quizSessionId, publicationId } = await seedSession(db);
    await seedAnswers(db, quizSessionId, publicationId, 4);

    const rows = await replayAnswers(db, quizSessionId, 0);
    expect(rows).toHaveLength(4);
    expect(rows[0]?.seq).toBe(1);
  });

  it('scopes strictly to the requested quiz session', async () => {
    const a = await seedSession(db);
    const b = await seedSession(db);
    await seedAnswers(db, a.quizSessionId, a.publicationId, 2);
    await seedAnswers(db, b.quizSessionId, b.publicationId, 2);

    const rows = await replayAnswers(db, a.quizSessionId, 0);
    expect(rows).toHaveLength(2);
  });

  it('splits into chunks of at most 200 — 200/200/remainder', async () => {
    const total = REPLAY_CHUNK_SIZE * 2 + 1;
    const { quizSessionId, publicationId } = await seedSession(db);
    await seedAnswers(db, quizSessionId, publicationId, total);

    const rows = await replayAnswers(db, quizSessionId, 0);
    expect(rows).toHaveLength(total);

    const chunks = chunkAnswers(rows);
    expect(chunks.map((chunk) => chunk.length)).toEqual([200, 200, 1]);
    expect(chunks[0]![0]!.seq).toBe(1);
    expect(chunks.flat().map((row) => row.seq)).toEqual(rows.map((row) => row.seq));
  }, 30_000);

  it('never includes pointsAwarded in the device-facing row', async () => {
    const { quizSessionId, publicationId } = await seedSession(db);
    await seedAnswers(db, quizSessionId, publicationId, 1);

    const [row] = await replayAnswers(db, quizSessionId, 0);
    expect(row).toBeDefined();
    expect(JSON.stringify(row)).not.toContain('pointsAwarded');
  });
});
