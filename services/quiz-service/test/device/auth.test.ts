import { ulid } from 'ulidx';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { hashDeviceCredential } from '../../src/device/credentials.js';
import { SystemClock } from '../../src/lib/clock.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { startTestPostgres, type TestPostgres } from '../helpers/postgres.js';

const ENABLED_TOKEN = 'enabled-device-token-32-bytes-long!';
const DISABLED_TOKEN = 'disabled-device-token-32-bytes-lon!';

interface TestLog {
  level: 'warn';
  args: unknown[];
}

describe('device bearer authentication', () => {
  let pg: TestPostgres;
  let app: FastifyInstance;
  let enabledDeviceId: string;
  let warnLogs: TestLog[];

  beforeAll(async () => {
    pg = await startTestPostgres();
    const config = loadConfig({ NODE_ENV: 'test', QUIZ_SERVICE_DATABASE_URL: pg.connectionString });
    app = await buildApp({ config, clock: new SystemClock(), ids: new UlidGenerator() });

    enabledDeviceId = ulid();
    const disabledDeviceId = ulid();
    await app.sql`
      INSERT INTO devices (device_id, credential_hash, hall_display_name, enabled, created_at)
      VALUES (${enabledDeviceId}, ${await hashDeviceCredential(ENABLED_TOKEN)}, 'Lecture Hall 1', true, now())
    `;
    await app.sql`
      INSERT INTO devices (device_id, credential_hash, hall_display_name, enabled, created_at)
      VALUES (${disabledDeviceId}, ${await hashDeviceCredential(DISABLED_TOKEN)}, 'Lecture Hall 2', false, now())
    `;

    warnLogs = [];
    // Fastify gives every request its own child logger instance, so the
    // capture must patch `request.log`, not the shared `app.log`.
    app.addHook('onRequest', async (request) => {
      const originalWarn = request.log.warn.bind(request.log);
      request.log.warn = ((...args: unknown[]) => {
        warnLogs.push({ level: 'warn', args });
        return originalWarn(...(args as Parameters<typeof originalWarn>));
      }) as typeof request.log.warn;
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it('rejects a missing bearer header', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/device/v1/quiz-sessions',
      payload: { lectureSessionId: ulid(), deviceId: enabledDeviceId, hallDisplayName: 'Hall' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toEqual({ status: 401, code: 'not-authorized', title: 'Device authentication failed' });
  });

  it('rejects a wrong bearer token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/device/v1/quiz-sessions',
      headers: { authorization: 'Bearer wrong-token-that-does-not-match' },
      payload: { lectureSessionId: ulid(), deviceId: enabledDeviceId, hallDisplayName: 'Hall' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ status: 401, code: 'not-authorized', title: 'Device authentication failed' });
  });

  it('rejects a disabled device even with its correct token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/device/v1/quiz-sessions',
      headers: { authorization: `Bearer ${DISABLED_TOKEN}` },
      payload: { lectureSessionId: ulid(), deviceId: enabledDeviceId, hallDisplayName: 'Hall' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('accepts a correct, enabled bearer and never echoes the token in the response', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/device/v1/quiz-sessions',
      headers: { authorization: `Bearer ${ENABLED_TOKEN}` },
      payload: { lectureSessionId: ulid(), deviceId: enabledDeviceId, hallDisplayName: 'Hall' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.body).not.toContain(ENABLED_TOKEN);
  });

  it('logs no warning when x-eduscope-contract is absent', async () => {
    warnLogs.length = 0;
    await app.inject({
      method: 'POST',
      url: '/device/v1/quiz-sessions',
      headers: { authorization: `Bearer ${ENABLED_TOKEN}` },
      payload: { lectureSessionId: ulid(), deviceId: enabledDeviceId, hallDisplayName: 'Hall' },
    });
    expect(warnLogs).toHaveLength(0);
  });

  it('logs no warning when x-eduscope-contract matches 1.0', async () => {
    warnLogs.length = 0;
    await app.inject({
      method: 'POST',
      url: '/device/v1/quiz-sessions',
      headers: { authorization: `Bearer ${ENABLED_TOKEN}`, 'x-eduscope-contract': '1.0' },
      payload: { lectureSessionId: ulid(), deviceId: enabledDeviceId, hallDisplayName: 'Hall' },
    });
    expect(warnLogs).toHaveLength(0);
  });

  it('logs exactly one warning, but still succeeds, when x-eduscope-contract mismatches', async () => {
    warnLogs.length = 0;
    const response = await app.inject({
      method: 'POST',
      url: '/device/v1/quiz-sessions',
      headers: { authorization: `Bearer ${ENABLED_TOKEN}`, 'x-eduscope-contract': '2.0' },
      payload: { lectureSessionId: ulid(), deviceId: enabledDeviceId, hallDisplayName: 'Hall' },
    });
    expect(response.statusCode).toBe(201);
    expect(warnLogs).toHaveLength(1);
    const [logged] = warnLogs;
    const [meta, message] = logged!.args as [Record<string, unknown>, string];
    expect(message).toMatch(/contract version mismatch/i);
    expect(meta).toMatchObject({
      deviceId: enabledDeviceId,
      method: 'POST',
      received: '2.0',
      expected: '1.0',
    });
  });
});
