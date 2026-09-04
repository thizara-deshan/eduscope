import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { RouteOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PANEL_OPERATION_IDS, SERVER_SIDE_ONLY_OPERATION_IDS, zProblem } from '@eduscope/shared';

interface CapturedRoute {
  method: string[];
  path: string;
  operationId?: string;
}

const capturedRoutes: CapturedRoute[] = [];

vi.mock('fastify', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fastify')>();
  return {
    ...actual,
    default: (...args: unknown[]) => {
      const createFastify = actual.default as unknown as (...factoryArgs: unknown[]) => ReturnType<typeof actual.default>;
      const app = createFastify(...args);
      app.addHook('onRoute', (route: RouteOptions) => {
        const methods = Array.isArray(route.method) ? route.method : [route.method];
        capturedRoutes.push({
          method: methods.map(String),
          path: route.url,
          ...(route.config?.operationId ? { operationId: route.config.operationId } : {}),
        });
      });
      return app;
    },
  };
});

const { buildApp } = await import('../../src/app.js');
const { loadConfig } = await import('../../src/config.js');

interface ContractOperation {
  id: string;
  method: string;
  path: string;
}

function parseOperations(source: string): ContractOperation[] {
  const operations: ContractOperation[] = [];
  let path = '';
  let method = '';
  for (const line of source.split(/\r?\n/)) {
    const pathMatch = /^  (\/[^:]+):\s*$/.exec(line);
    if (pathMatch) {
      path = pathMatch[1]!;
      method = '';
      continue;
    }
    const methodMatch = /^    (get|post|put|patch|delete):\s*$/.exec(line);
    if (methodMatch) {
      method = methodMatch[1]!.toUpperCase();
      continue;
    }
    const operationMatch = /^      operationId:\s*(\w+)\s*$/.exec(line);
    if (operationMatch && path && method) operations.push({ id: operationMatch[1]!, method, path });
  }
  return operations;
}

function normalizeFastifyPath(path: string): string {
  return path.replace(/^\/api\/v1/, '').replace(/:([A-Za-z][A-Za-z0-9_]*)/g, '{$1}');
}

const root = resolve(import.meta.dirname, '../../../..');
const openapi = readFileSync(join(root, 'contracts/openapi.yaml'), 'utf8');
const allContractOperations = parseOperations(openapi);
const serverOnly = new Set<string>(SERVER_SIDE_ONLY_OPERATION_IDS);
const panelOperations = allContractOperations.filter(({ id }) => !serverOnly.has(id));

let app: Awaited<ReturnType<typeof buildApp>>;
let dir: string;
let pm: import('../fakes/pipeline-manager.js').FakePipelineManager;
let token: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'core-api-b38-operations-'));
  const { FakePipelineManager } = await import('../fakes/pipeline-manager.js');
  pm = new FakePipelineManager({ bearerToken: 'b38-operation-gate-internal-bearer' });
  const pmBaseUrl = await pm.listen();
  app = await buildApp({
    config: loadConfig({
      NODE_ENV: 'test',
      CORE_API_DB_PATH: join(dir, 'core.db'),
      CORE_API_JWT_SECRET: 'b38-operation-gate-jwt-secret-value',
      CORE_API_RECORDINGS_ROOT: join(dir, 'recordings'),
      CORE_API_RUNTIME_DIR: join(dir, 'runtime'),
      CORE_API_PROVISIONING_PATH: join(dir, 'provisioning.json'),
      CORE_API_INTERNAL_BEARER: 'b38-operation-gate-internal-bearer',
      CORE_API_PM_BASE_URL: pmBaseUrl,
    }),
  });
  await app.ready();
  await app.lifecycle.start();
  const { users } = await import('../../src/db/schema.js');
  const { hashPassword } = await import('../../src/modules/auth/passwords.js');
  const userId = app.ids.next(app.clock.now());
  await app.db.insert(users).values({
    id: userId,
    username: 'gate-lecturer',
    displayName: 'Gate Lecturer',
    role: 'lecturer',
    source: 'local',
    passwordHash: await hashPassword('GatePassphrase1!'),
    mustResetPassword: false,
    disabled: false,
    createdAt: app.clock.now().toISOString(),
  }).run();
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'gate-lecturer', password: 'GatePassphrase1!', client: 'panel' },
  });
  token = (login.json() as { tokens: { accessToken: string } }).tokens.accessToken;
});

afterAll(async () => {
  if (app) await app.close();
  if (pm) await pm.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('B-38 exact REST ownership gate', () => {
  it('partitions exactly 79 B-owned and four server-only operations', () => {
    expect(allContractOperations).toHaveLength(83);
    expect(panelOperations).toHaveLength(79);
    expect(panelOperations.map(({ id }) => id).sort()).toEqual([...PANEL_OPERATION_IDS].sort());
  });

  it('registers every B operation exactly once with the contract method and path', () => {
    const actual = capturedRoutes.flatMap((route) => route.operationId
      ? route.method
        .filter((method) => method !== 'HEAD')
        .map((method) => ({ id: route.operationId!, method, path: normalizeFastifyPath(route.path) }))
      : []);
    expect(actual.sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [...panelOperations].sort((a, b) => a.id.localeCompare(b.id)),
    );
  });

  it('has no extra public HTTP surface beyond health, two WS upgrades, and contract routes', () => {
    const allowed = new Set(panelOperations.map(({ method, path }) => `${method} /api/v1${path}`));
    allowed.add('GET /healthz');
    allowed.add('GET /api/v1/ws');
    allowed.add('GET /api/v1/ws/preview');

    const extras = capturedRoutes.filter((route) => !route.path.startsWith('/internal/')).flatMap((route) => route.method
      .filter((method) => method !== 'HEAD')
      .map((method) => `${method} /api/v1${normalizeFastifyPath(route.path)}`))
      .map((entry) => entry.replace(' /api/v1/healthz', ' /healthz'))
      .filter((entry) => !allowed.has(entry));
    expect(extras).toEqual([]);
  });

  it('keeps a runnable success/Problem contract fixture for every operation', () => {
    const contractDir = join(root, 'services/core-api/test/contract');
    const fixtureSource = readdirSync(contractDir)
      .filter((name) => name.endsWith('.contract.test.ts'))
      .map((name) => readFileSync(join(contractDir, name), 'utf8'))
      .join('\n');
    const missing = panelOperations
      .map(({ id }) => id)
      .filter((id) => id !== 'getSourcePreview' && !fixtureSource.includes(id));
    expect(missing, `operations without an existing executable contract fixture: ${missing.join(', ')}`).toEqual([]);
  });

  it('executes getSourcePreview success and every declared Problem response', async () => {
    const unauthenticated = await app.inject({ method: 'GET', url: '/api/v1/sources/presentation/preview.jpg' });
    expect(unauthenticated.statusCode).toBe(401);
    expect(zProblem.safeParse(unauthenticated.json()).success).toBe(true);

    vi.spyOn(app.pmClient, 'getJpegThumbnail').mockResolvedValueOnce(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]));
    const success = await app.inject({
      method: 'GET',
      url: '/api/v1/sources/presentation/preview.jpg',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(success.statusCode).toBe(200);
    expect(success.headers['content-type']).toContain('image/jpeg');
    expect(success.headers['cache-control']).toBe('no-store');

    const refused = await app.inject({
      method: 'GET',
      url: '/api/v1/sources/mic-room/preview.jpg',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(refused.statusCode).toBe(404);
    expect(zProblem.safeParse(refused.json()).success).toBe(true);
  });
});
