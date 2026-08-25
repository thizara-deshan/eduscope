import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_MIGRATIONS_DIR, migrate } from '../../src/db/migrate.js';
import { hashDeviceCredential, verifyDeviceCredential } from '../../src/device/credentials.js';
import { startTestPostgres, type TestPostgres } from '../helpers/postgres.js';

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === '23505';
}

async function insertDevice(sql: Sql, deviceId: string, credentialHash: string): Promise<void> {
  await sql`
    INSERT INTO devices (device_id, credential_hash, hall_display_name, enabled, created_at)
    VALUES (${deviceId}, ${credentialHash}, 'Lecture Hall 1', true, now())
  `;
}

async function insertQuizSession(
  sql: Sql,
  args: { id: string; lectureSessionId: string; deviceId: string; joinCode: string; state: 'open' | 'closed' },
): Promise<void> {
  await sql`
    INSERT INTO quiz_sessions (id, lecture_session_id, device_id, hall_display_name, join_code, join_url, state, opened_at)
    VALUES (${args.id}, ${args.lectureSessionId}, ${args.deviceId}, 'Lecture Hall 1', ${args.joinCode}, ${'https://example.edu/j/' + args.joinCode}, ${args.state}, now())
  `;
}

async function insertStudent(sql: Sql, id: string, studentIdNumber: string): Promise<void> {
  await sql`
    INSERT INTO students (id, student_id_number, full_name, auth_method, created_at, last_seen_at)
    VALUES (${id}, ${studentIdNumber}, 'Test Student', 'self-registered', now(), now())
  `;
}

async function insertPublication(
  sql: Sql,
  args: { id: string; quizSessionId: string; questionId: string; state: 'open' | 'closed' },
): Promise<void> {
  const options = JSON.stringify([
    { id: 'opt-a', label: 'A', text: 'A' },
    { id: 'opt-b', label: 'B', text: 'B' },
  ]);
  await sql`
    INSERT INTO publications (id, quiz_session_id, question_id, prompt, options, correct_option_id, state, published_at)
    VALUES (${args.id}, ${args.quizSessionId}, ${args.questionId}, 'Prompt?', ${options}::jsonb, 'opt-a', ${args.state}, now())
  `;
}

describe('quiz-service postgres migrations', () => {
  let pg: TestPostgres;
  let sql: Sql;

  beforeAll(async () => {
    pg = await startTestPostgres();
    sql = postgres(pg.connectionString, { max: 5 });
    await migrate(sql, DEFAULT_MIGRATIONS_DIR);
  }, 60_000);

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
    await pg?.stop();
  });

  it('records exactly one checksum row and leaves the schema unchanged on a second run', async () => {
    await migrate(sql, DEFAULT_MIGRATIONS_DIR);
    const rows = await sql`SELECT name, checksum FROM quiz_schema_migrations`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('0001_quiz.sql');

    const tableNames = await sql`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name
    `;
    expect(tableNames.map((row) => row.table_name)).toEqual([
      'answers',
      'devices',
      'participant_sessions',
      'participants',
      'publications',
      'quiz_schema_migrations',
      'quiz_sessions',
      'students',
    ]);
  });

  it('rejects a checksum change to an already-applied migration', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'quiz-migrate-'));
    const file = join(dir, '0001_probe.sql');
    writeFileSync(file, 'CREATE TABLE checksum_probe (id text PRIMARY KEY);');

    const probeSql = postgres(pg.connectionString, { max: 1 });
    try {
      await migrate(probeSql, dir);
      writeFileSync(file, 'CREATE TABLE checksum_probe (id text PRIMARY KEY, extra text);');
      await expect(migrate(probeSql, dir)).rejects.toThrow(/checksum/i);
    } finally {
      await probeSql.end({ timeout: 5 });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('allows only one open quiz session per lecture_session_id', async () => {
    const deviceId = randomUUID();
    await insertDevice(sql, deviceId, 'hash');
    const lectureSessionId = randomUUID();

    await insertQuizSession(sql, {
      id: randomUUID(),
      lectureSessionId,
      deviceId,
      joinCode: randomUUID().slice(0, 6).toUpperCase(),
      state: 'open',
    });

    await expect(
      insertQuizSession(sql, {
        id: randomUUID(),
        lectureSessionId,
        deviceId,
        joinCode: randomUUID().slice(0, 6).toUpperCase(),
        state: 'open',
      }),
    ).rejects.toSatisfy(isUniqueViolation);
  });

  it('allows only one open quiz session per join_code', async () => {
    const deviceId = randomUUID();
    await insertDevice(sql, deviceId, 'hash');
    const joinCode = randomUUID().slice(0, 6).toUpperCase();

    await insertQuizSession(sql, {
      id: randomUUID(),
      lectureSessionId: randomUUID(),
      deviceId,
      joinCode,
      state: 'open',
    });

    await expect(
      insertQuizSession(sql, {
        id: randomUUID(),
        lectureSessionId: randomUUID(),
        deviceId,
        joinCode,
        state: 'open',
      }),
    ).rejects.toSatisfy(isUniqueViolation);
  });

  it('allows only one open publication per quiz session', async () => {
    const deviceId = randomUUID();
    await insertDevice(sql, deviceId, 'hash');
    const quizSessionId = randomUUID();
    await insertQuizSession(sql, {
      id: quizSessionId,
      lectureSessionId: randomUUID(),
      deviceId,
      joinCode: randomUUID().slice(0, 6).toUpperCase(),
      state: 'open',
    });

    await insertPublication(sql, { id: randomUUID(), quizSessionId, questionId: randomUUID(), state: 'open' });

    await expect(
      insertPublication(sql, { id: randomUUID(), quizSessionId, questionId: randomUUID(), state: 'open' }),
    ).rejects.toSatisfy(isUniqueViolation);
  });

  it('allows only one participant per quiz session/student', async () => {
    const deviceId = randomUUID();
    await insertDevice(sql, deviceId, 'hash');
    const quizSessionId = randomUUID();
    await insertQuizSession(sql, {
      id: quizSessionId,
      lectureSessionId: randomUUID(),
      deviceId,
      joinCode: randomUUID().slice(0, 6).toUpperCase(),
      state: 'open',
    });
    const studentId = randomUUID();
    await insertStudent(sql, studentId, randomUUID().slice(0, 9));

    await sql`
      INSERT INTO participants (id, quiz_session_id, student_id, joined_at, last_seen_at, connection_state)
      VALUES (${randomUUID()}, ${quizSessionId}, ${studentId}, now(), now(), 'online')
    `;

    await expect(
      sql`
        INSERT INTO participants (id, quiz_session_id, student_id, joined_at, last_seen_at, connection_state)
        VALUES (${randomUUID()}, ${quizSessionId}, ${studentId}, now(), now(), 'online')
      `,
    ).rejects.toSatisfy(isUniqueViolation);
  });

  it('allows only one answer per publication/student', async () => {
    const deviceId = randomUUID();
    await insertDevice(sql, deviceId, 'hash');
    const quizSessionId = randomUUID();
    await insertQuizSession(sql, {
      id: quizSessionId,
      lectureSessionId: randomUUID(),
      deviceId,
      joinCode: randomUUID().slice(0, 6).toUpperCase(),
      state: 'open',
    });
    const publicationId = randomUUID();
    await insertPublication(sql, { id: publicationId, quizSessionId, questionId: randomUUID(), state: 'open' });
    const studentId = randomUUID();
    await insertStudent(sql, studentId, randomUUID().slice(0, 9));

    await sql`
      INSERT INTO answers (id, quiz_session_id, publication_id, student_id, selected_option_id, is_correct, points_awarded, response_time_ms, submitted_at, seq)
      VALUES (${randomUUID()}, ${quizSessionId}, ${publicationId}, ${studentId}, 'opt-a', true, 10, 500, now(), 1)
    `;

    await expect(
      sql`
        INSERT INTO answers (id, quiz_session_id, publication_id, student_id, selected_option_id, is_correct, points_awarded, response_time_ms, submitted_at, seq)
        VALUES (${randomUUID()}, ${quizSessionId}, ${publicationId}, ${studentId}, 'opt-a', true, 10, 500, now(), 2)
      `,
    ).rejects.toSatisfy(isUniqueViolation);
  });

  it('allows only one answer per (quiz_session_id, seq)', async () => {
    const deviceId = randomUUID();
    await insertDevice(sql, deviceId, 'hash');
    const quizSessionId = randomUUID();
    await insertQuizSession(sql, {
      id: quizSessionId,
      lectureSessionId: randomUUID(),
      deviceId,
      joinCode: randomUUID().slice(0, 6).toUpperCase(),
      state: 'open',
    });
    const publicationId = randomUUID();
    await insertPublication(sql, { id: publicationId, quizSessionId, questionId: randomUUID(), state: 'open' });
    const firstStudentId = randomUUID();
    const secondStudentId = randomUUID();
    await insertStudent(sql, firstStudentId, randomUUID().slice(0, 9));
    await insertStudent(sql, secondStudentId, randomUUID().slice(0, 9));

    await sql`
      INSERT INTO answers (id, quiz_session_id, publication_id, student_id, selected_option_id, is_correct, points_awarded, response_time_ms, submitted_at, seq)
      VALUES (${randomUUID()}, ${quizSessionId}, ${publicationId}, ${firstStudentId}, 'opt-a', true, 10, 500, now(), 7)
    `;

    await expect(
      sql`
        INSERT INTO answers (id, quiz_session_id, publication_id, student_id, selected_option_id, is_correct, points_awarded, response_time_ms, submitted_at, seq)
        VALUES (${randomUUID()}, ${quizSessionId}, ${publicationId}, ${secondStudentId}, 'opt-b', false, 0, 500, now(), 7)
      `,
    ).rejects.toSatisfy(isUniqueViolation);
  });

  it('two concurrent next_answer_seq increments return distinct, increasing values', async () => {
    const deviceId = randomUUID();
    await insertDevice(sql, deviceId, 'hash');
    const quizSessionId = randomUUID();
    await insertQuizSession(sql, {
      id: quizSessionId,
      lectureSessionId: randomUUID(),
      deviceId,
      joinCode: randomUUID().slice(0, 6).toUpperCase(),
      state: 'open',
    });

    const connectionA = postgres(pg.connectionString, { max: 1 });
    const connectionB = postgres(pg.connectionString, { max: 1 });
    try {
      const [resultA, resultB] = await Promise.all([
        connectionA`UPDATE quiz_sessions SET next_answer_seq = next_answer_seq + 1 WHERE id = ${quizSessionId} RETURNING next_answer_seq`,
        connectionB`UPDATE quiz_sessions SET next_answer_seq = next_answer_seq + 1 WHERE id = ${quizSessionId} RETURNING next_answer_seq`,
      ]);
      const values = [resultA[0]?.next_answer_seq, resultB[0]?.next_answer_seq].map(Number).sort((a, b) => a - b);
      expect(values).toEqual([1, 2]);
    } finally {
      await connectionA.end({ timeout: 5 });
      await connectionB.end({ timeout: 5 });
    }
  });

  it('hashes the same token differently each time, both verify, and a wrong token fails', async () => {
    const token = 'a'.repeat(32);
    const firstHash = await hashDeviceCredential(token);
    const secondHash = await hashDeviceCredential(token);
    expect(firstHash).not.toBe(secondHash);
    await expect(verifyDeviceCredential(firstHash, token)).resolves.toBe(true);
    await expect(verifyDeviceCredential(secondHash, token)).resolves.toBe(true);
    await expect(verifyDeviceCredential(firstHash, 'b'.repeat(32))).resolves.toBe(false);
  });

  it('stores only the credential hash in devices, never the raw token', async () => {
    const token = 'c'.repeat(32);
    const hash = await hashDeviceCredential(token);
    const deviceId = randomUUID();
    await insertDevice(sql, deviceId, hash);

    const rows = await sql`SELECT credential_hash FROM devices WHERE device_id = ${deviceId}`;
    expect(rows[0]?.credential_hash).toBe(hash);
    expect(rows[0]?.credential_hash).not.toContain(token);
  });
});
