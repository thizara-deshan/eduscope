import * as https from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { SystemClock } from '../../src/lib/clock.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { startTestPostgres, type TestPostgres } from '../helpers/postgres.js';
import { startTlsProxy, TLS_TEST_CERT, type TlsProxy } from '../helpers/tls-proxy.js';

interface TlsResponse {
  status: number;
  body: string;
}

function fetchThroughTls(port: number, urlPath: string): Promise<TlsResponse> {
  return new Promise((resolvePromise, reject) => {
    const req = https.request(
      { hostname: '127.0.0.1', port, path: urlPath, ca: TLS_TEST_CERT, servername: 'localhost' },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf8');
        });
        res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('quiz-service server foundation', () => {
  let pg: TestPostgres;
  let app: FastifyInstance;
  let proxy: TlsProxy;

  beforeAll(async () => {
    pg = await startTestPostgres();
    const config = loadConfig({
      NODE_ENV: 'test',
      QUIZ_SERVICE_DATABASE_URL: pg.connectionString,
      QUIZ_SERVICE_HOST: '127.0.0.1',
    });
    app = await buildApp({
      config,
      clock: new SystemClock(),
      ids: new UlidGenerator(),
      pageHandler: (_req: IncomingMessage, res: ServerResponse) => {
        res.statusCode = 200;
        res.setHeader('content-type', 'text/plain');
        res.end('next-page');
      },
    });
    await app.listen({ host: '127.0.0.1', port: 0 });

    const address = app.server.address();
    if (address === null || typeof address === 'string') throw new Error('quiz-service failed to bind');
    proxy = await startTlsProxy(address.port);
  }, 60_000);

  afterAll(async () => {
    await proxy?.close();
    await app?.close();
    await pg?.stop();
  });

  it('binds the Node listener to loopback only, never a public interface', () => {
    const address = app.server.address();
    if (address === null || typeof address === 'string') throw new Error('quiz-service has no address');
    expect(address.address).toBe('127.0.0.1');
  });

  it('serves /healthz through the HTTPS proxy', async () => {
    const response = await fetchThroughTls(proxy.port, '/healthz');
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: 'ok', contractVersion: '1.0.0' });
  });

  it('hands an unmatched route to the injected Next page handler through the HTTPS proxy', async () => {
    const response = await fetchThroughTls(proxy.port, '/j/ABC123');
    expect(response.status).toBe(200);
    expect(response.body).toBe('next-page');
  });
});
