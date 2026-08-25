import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export interface QuizConfig {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  databaseUrl: string;
  publicOrigin: string;
  cookieSecret: string;
  participantSessionTtlSec: number;
  nextAppDir: string;
  logLevel: string;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const MIN_PRODUCTION_COOKIE_SECRET_LENGTH = 32;

const DEFAULT_NEXT_APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../apps/quiz');

const rawEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  QUIZ_SERVICE_HOST: z.string().min(1).default('127.0.0.1'),
  QUIZ_SERVICE_PORT: z.coerce.number().int().min(1).max(65535).default(7300),
  QUIZ_SERVICE_DATABASE_URL: z.string().min(1).default('postgres://127.0.0.1:5432/eduscope_quiz'),
  QUIZ_SERVICE_PUBLIC_ORIGIN: z.string().min(1).default('http://127.0.0.1:7300'),
  QUIZ_SERVICE_COOKIE_SECRET: z.string().min(1).default('dev-quiz-cookie-secret-not-for-production'),
  QUIZ_SERVICE_PARTICIPANT_SESSION_TTL_SEC: z.coerce.number().int().positive().default(86_400),
  QUIZ_SERVICE_NEXT_APP_DIR: z.string().min(1).default(DEFAULT_NEXT_APP_DIR),
  QUIZ_SERVICE_LOG_LEVEL: z.string().min(1).default('info'),
});

/** Validates and shapes process env into `QuizConfig`. Throws on an invalid or unsafe value. */
export function loadConfig(env: Record<string, string | undefined>): QuizConfig {
  const raw = rawEnvSchema.parse(env);

  if (raw.NODE_ENV === 'production') {
    if (!LOOPBACK_HOSTS.has(raw.QUIZ_SERVICE_HOST)) {
      throw new Error(
        `QUIZ_SERVICE_HOST must be a loopback address (127.0.0.1, localhost, ::1) in production; got "${raw.QUIZ_SERVICE_HOST}"`,
      );
    }
    if (!raw.QUIZ_SERVICE_PUBLIC_ORIGIN.startsWith('https://')) {
      throw new Error('QUIZ_SERVICE_PUBLIC_ORIGIN must be an https:// URL in production');
    }
    if (raw.QUIZ_SERVICE_COOKIE_SECRET.length < MIN_PRODUCTION_COOKIE_SECRET_LENGTH) {
      throw new Error(
        `QUIZ_SERVICE_COOKIE_SECRET must be at least ${MIN_PRODUCTION_COOKIE_SECRET_LENGTH} characters in production`,
      );
    }
  }

  return {
    nodeEnv: raw.NODE_ENV,
    host: raw.QUIZ_SERVICE_HOST,
    port: raw.QUIZ_SERVICE_PORT,
    databaseUrl: raw.QUIZ_SERVICE_DATABASE_URL,
    publicOrigin: raw.QUIZ_SERVICE_PUBLIC_ORIGIN,
    cookieSecret: raw.QUIZ_SERVICE_COOKIE_SECRET,
    participantSessionTtlSec: raw.QUIZ_SERVICE_PARTICIPANT_SESSION_TTL_SEC,
    nextAppDir: raw.QUIZ_SERVICE_NEXT_APP_DIR,
    logLevel: raw.QUIZ_SERVICE_LOG_LEVEL,
  };
}
