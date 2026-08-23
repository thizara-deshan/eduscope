import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

export interface StoredQuizOption {
  id: string;
  label: 'A' | 'B' | 'C' | 'D';
  text: string;
}

export const devices = pgTable('devices', {
  deviceId: text('device_id').primaryKey(),
  credentialHash: text('credential_hash').notNull(),
  hallDisplayName: varchar('hall_display_name', { length: 128 }).notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
});

export const quizSessions = pgTable(
  'quiz_sessions',
  {
    id: text('id').primaryKey(),
    lectureSessionId: text('lecture_session_id').notNull(),
    deviceId: text('device_id')
      .notNull()
      .references(() => devices.deviceId),
    hallDisplayName: varchar('hall_display_name', { length: 128 }).notNull(),
    joinCode: varchar('join_code', { length: 8 }).notNull(),
    joinUrl: varchar('join_url', { length: 256 }).notNull(),
    state: varchar('state', { length: 16 }).notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true, mode: 'date' }).notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true, mode: 'date' }),
    nextAnswerSeq: bigint('next_answer_seq', { mode: 'number' }).notNull().default(0),
  },
  (t) => [
    uniqueIndex('one_open_quiz_session_per_lecture').on(t.lectureSessionId).where(sql`state='open'`),
    uniqueIndex('one_open_quiz_session_per_join_code').on(t.joinCode).where(sql`state='open'`),
    index('quiz_sessions_device_idx').on(t.deviceId),
    check('quiz_sessions_state_check', sql`state IN ('open','closed')`),
    check('quiz_sessions_next_answer_seq_check', sql`next_answer_seq >= 0`),
  ],
);

export const students = pgTable('students', {
  id: text('id').primaryKey(),
  studentIdNumber: varchar('student_id_number', { length: 32 }).notNull().unique(),
  fullName: varchar('full_name', { length: 128 }).notNull(),
  authMethod: varchar('auth_method', { length: 32 }).notNull(),
  ssoSubject: varchar('sso_subject', { length: 128 }),
  credentialRef: varchar('credential_ref', { length: 128 }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }).notNull(),
}, () => [check('students_auth_method_check', sql`auth_method IN ('self-registered','sso')`)]);

export const participants = pgTable(
  'participants',
  {
    id: text('id').primaryKey(),
    quizSessionId: text('quiz_session_id')
      .notNull()
      .references(() => quizSessions.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id),
    joinedAt: timestamp('joined_at', { withTimezone: true, mode: 'date' }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }).notNull(),
    connectionState: varchar('connection_state', { length: 16 }).notNull(),
  },
  (t) => [
    uniqueIndex('participants_quiz_session_id_student_id_key').on(t.quizSessionId, t.studentId),
    index('participants_session_idx').on(t.quizSessionId),
    check('participants_connection_state_check', sql`connection_state IN ('online','offline')`),
  ],
);

export const participantSessions = pgTable(
  'participant_sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    participantId: text('participant_id')
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id),
    issuedAt: timestamp('issued_at', { withTimezone: true, mode: 'date' }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [index('participant_sessions_participant_idx').on(t.participantId)],
);

export const publications = pgTable(
  'publications',
  {
    id: text('id').primaryKey(),
    quizSessionId: text('quiz_session_id')
      .notNull()
      .references(() => quizSessions.id, { onDelete: 'cascade' }),
    questionId: text('question_id').notNull(),
    prompt: text('prompt').notNull(),
    options: jsonb('options').$type<StoredQuizOption[]>().notNull(),
    correctOptionId: text('correct_option_id').notNull(),
    state: varchar('state', { length: 16 }).notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }).notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true, mode: 'date' }),
    closeReason: varchar('close_reason', { length: 32 }),
  },
  (t) => [
    uniqueIndex('one_open_publication_per_quiz_session').on(t.quizSessionId).where(sql`state='open'`),
    index('publications_session_time_idx').on(t.quizSessionId, t.publishedAt.desc()),
    check('publications_state_check', sql`state IN ('open','closed')`),
    check(
      'publications_close_reason_check',
      sql`close_reason IN ('next-question','session-ended','lecturer-closed')`,
    ),
  ],
);

export const answers = pgTable(
  'answers',
  {
    id: text('id').primaryKey(),
    quizSessionId: text('quiz_session_id')
      .notNull()
      .references(() => quizSessions.id, { onDelete: 'cascade' }),
    publicationId: text('publication_id')
      .notNull()
      .references(() => publications.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id),
    selectedOptionId: text('selected_option_id').notNull(),
    isCorrect: boolean('is_correct').notNull(),
    pointsAwarded: integer('points_awarded').notNull(),
    responseTimeMs: integer('response_time_ms').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true, mode: 'date' }).notNull(),
    seq: bigint('seq', { mode: 'number' }).notNull(),
  },
  (t) => [
    uniqueIndex('answers_publication_id_student_id_key').on(t.publicationId, t.studentId),
    uniqueIndex('answers_quiz_session_id_seq_key').on(t.quizSessionId, t.seq),
    index('answers_replay_idx').on(t.quizSessionId, t.seq),
    check('answers_points_awarded_check', sql`points_awarded IN (0,10)`),
    check('answers_response_time_ms_check', sql`response_time_ms >= 0`),
    check('answers_seq_check', sql`seq > 0`),
  ],
);
