import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { LogEntry } from '@eduscope/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { logEntries } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { FakeClock } from '../fakes/clock.js';

const NOW = new Date('2026-08-23T00:00:00.000Z');
const BEARER = 'internal-logs-test-bearer';

interface TestApp {
  app: FastifyInstance;
  dir: string;
}

async function startTestApp(): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-internal-logs-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'internal-logs-test-secret',
    CORE_API_RECORDINGS_ROOT: join(dir, 'recordings'),
    CORE_API_INTERNAL_BEARER: BEARER,
  });
  const clock = new FakeClock(NOW);
  const ids = new UlidGenerator();
  const app = await buildApp({ config, clock, ids });
  await app.lifecycle.start();
  return { app, dir };
}

async function stopTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close();
  rmSync(testApp.dir, { recursive: true, force: true });
}

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    level: 'WARN',
    category: 'System',
    service: 'ai',
    message: 'slide-service OCR fell back to null text',
    context: { subservice: 'slide' },
    ...overrides,
  };
}

describe('POST /internal/logs (C execution gate item 5, design/core-api.md §12)', () => {
  let testApp: TestApp;

  afterEach(async () => {
    await stopTestApp(testApp);
  });

  it('requires a bearer: missing, wrong-scheme, empty, and wrong tokens are all rejected 401', async () => {
    testApp = await startTestApp();

    const missing = await testApp.app.inject({ method: 'POST', url: '/internal/logs', payload: validPayload() });
    expect(missing.statusCode).toBe(401);

    const wrongScheme = await testApp.app.inject({
      method: 'POST',
      url: '/internal/logs',
      headers: { authorization: `Basic ${BEARER}` },
      payload: validPayload(),
    });
    expect(wrongScheme.statusCode).toBe(401);

    const empty = await testApp.app.inject({
      method: 'POST',
      url: '/internal/logs',
      headers: { authorization: 'Bearer ' },
      payload: validPayload(),
    });
    expect(empty.statusCode).toBe(401);

    const wrongToken = await testApp.app.inject({
      method: 'POST',
      url: '/internal/logs',
      headers: { authorization: 'Bearer not-the-right-token' },
      payload: validPayload(),
    });
    expect(wrongToken.statusCode).toBe(401);

    expect(testApp.app.db.select().from(logEntries).all()).toHaveLength(0);
  });

  it('rejects a non-loopback remote address even with a correct bearer', async () => {
    testApp = await startTestApp();

    const response = await testApp.app.inject({
      method: 'POST',
      url: '/internal/logs',
      remoteAddress: '203.0.113.7',
      headers: { authorization: `Bearer ${BEARER}` },
      payload: validPayload(),
    });

    expect(response.statusCode).toBe(403);
    expect(testApp.app.db.select().from(logEntries).all()).toHaveLength(0);
  });

  it('writes a curated row through LogStore with service=ai and context.subservice, and bridges it onto the bus', async () => {
    testApp = await startTestApp();
    const busEvents: LogEntry[] = [];
    testApp.app.bus.subscribe('log.entry', (entry) => busEvents.push(entry));

    const response = await testApp.app.inject({
      method: 'POST',
      url: '/internal/logs',
      headers: { authorization: `Bearer ${BEARER}` },
      payload: validPayload({ context: { subservice: 'slide', slideCount: 3 } }),
    });

    expect(response.statusCode).toBe(201);
    const rows = testApp.app.db.select().from(logEntries).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ service: 'ai', level: 'WARN', category: 'System' });
    expect(rows[0]!.context).toMatchObject({ subservice: 'slide', slideCount: 3 });
    expect(busEvents).toHaveLength(1);
    expect(busEvents[0]).toMatchObject({ service: 'ai' });
  });

  it('rejects secret-shaped context keys (token/secret/password/prompt/transcript/llmEndpoint) without writing a row', async () => {
    testApp = await startTestApp();

    for (const key of ['token', 'apiSecret', 'password', 'prompt', 'transcriptText', 'llmEndpoint']) {
      const response = await testApp.app.inject({
        method: 'POST',
        url: '/internal/logs',
        headers: { authorization: `Bearer ${BEARER}` },
        payload: validPayload({ context: { subservice: 'question', [key]: 'should not be stored' } }),
      });
      expect(response.statusCode).toBe(422);
    }

    expect(testApp.app.db.select().from(logEntries).all()).toHaveLength(0);
  });
});
