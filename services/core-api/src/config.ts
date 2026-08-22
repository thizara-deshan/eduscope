import { z } from 'zod';

export interface CoreConfig {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  dbPath: string;
  recordingsRoot: string;
  runtimeDir: string;
  provisioningPath: string;
  helperSocketPath: string;
  pipelineManagerBaseUrl: string;
  internalBearer: string;
  jwtSecret: string;
  secretboxKey: string;
  accessTokenTtlSec: number;
  refreshTokenTtlSec: number;
  /** AD-7 product-log rotation policy (design/core-api.md §12) — a deployment value, never product-visible config. */
  logMaxRows: number;
  logMaxAgeDays: number;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const MIN_PRODUCTION_SECRET_LENGTH = 32;

const rawEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CORE_API_HOST: z.string().min(1).default('127.0.0.1'),
  CORE_API_PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  CORE_API_DB_PATH: z.string().min(1).default('/var/lib/eduscope/core.db'),
  CORE_API_RECORDINGS_ROOT: z.string().min(1).default('/media/eduscope'),
  CORE_API_RUNTIME_DIR: z.string().min(1).default('/run/eduscope'),
  CORE_API_PROVISIONING_PATH: z.string().min(1).default('/etc/eduscope/provisioning.json'),
  CORE_API_HELPER_SOCKET: z.string().min(1).default('/run/eduscope/helper.sock'),
  CORE_API_PM_BASE_URL: z.string().url().default('http://127.0.0.1:8091'),
  CORE_API_INTERNAL_BEARER: z.string().default('dev-internal-bearer'),
  CORE_API_JWT_SECRET: z.string().default('dev-jwt-secret'),
  CORE_API_SECRETBOX_KEY: z.string().default('dev-secretbox-key'),
  CORE_API_ACCESS_TTL_SEC: z.coerce.number().int().positive().default(600),
  CORE_API_REFRESH_TTL_SEC: z.coerce.number().int().positive().default(2_592_000),
  EDUSCOPE_CORE_LOG_MAX_ROWS: z.coerce.number().int().positive().default(50_000),
  EDUSCOPE_CORE_LOG_MAX_AGE_DAYS: z.coerce.number().int().positive().default(90),
});

/** Validates and shapes process env into `CoreConfig`. Throws on an invalid or unsafe value. */
export function loadConfig(env: Record<string, string | undefined>): CoreConfig {
  const raw = rawEnvSchema.parse(env);

  if (!LOOPBACK_HOSTS.has(raw.CORE_API_HOST)) {
    throw new Error(
      `CORE_API_HOST must be a loopback address (127.0.0.1, localhost, ::1); got "${raw.CORE_API_HOST}"`,
    );
  }

  if (raw.NODE_ENV === 'production') {
    const secrets: Array<[string, string]> = [
      ['CORE_API_INTERNAL_BEARER', raw.CORE_API_INTERNAL_BEARER],
      ['CORE_API_JWT_SECRET', raw.CORE_API_JWT_SECRET],
      ['CORE_API_SECRETBOX_KEY', raw.CORE_API_SECRETBOX_KEY],
    ];
    for (const [name, value] of secrets) {
      if (value.length < MIN_PRODUCTION_SECRET_LENGTH) {
        throw new Error(`${name} must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in production`);
      }
    }
  }

  return {
    nodeEnv: raw.NODE_ENV,
    host: raw.CORE_API_HOST,
    port: raw.CORE_API_PORT,
    dbPath: raw.CORE_API_DB_PATH,
    recordingsRoot: raw.CORE_API_RECORDINGS_ROOT,
    runtimeDir: raw.CORE_API_RUNTIME_DIR,
    provisioningPath: raw.CORE_API_PROVISIONING_PATH,
    helperSocketPath: raw.CORE_API_HELPER_SOCKET,
    pipelineManagerBaseUrl: raw.CORE_API_PM_BASE_URL,
    internalBearer: raw.CORE_API_INTERNAL_BEARER,
    jwtSecret: raw.CORE_API_JWT_SECRET,
    secretboxKey: raw.CORE_API_SECRETBOX_KEY,
    accessTokenTtlSec: raw.CORE_API_ACCESS_TTL_SEC,
    refreshTokenTtlSec: raw.CORE_API_REFRESH_TTL_SEC,
    logMaxRows: raw.EDUSCOPE_CORE_LOG_MAX_ROWS,
    logMaxAgeDays: raw.EDUSCOPE_CORE_LOG_MAX_AGE_DAYS,
  };
}
