import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { pathToFileURL } from 'node:url';
import { PANEL_OPERATION_IDS } from '@eduscope/shared';
import { startCorePeer, type PeerProcess } from './core-peer.js';
import { startQuizPeer, type QuizPeerReady } from './quiz-peer.js';

export const REAL_STACK_ACCOUNTS = {
  lecturer: { username: 'e06-lecturer', password: 'E06LecturerPass1!' },
  admin: { username: 'e06-admin', password: 'E06AdminPassphrase1!' },
  reset: { username: 'e06-reset', password: 'E06ResetPassphrase1!' },
  disabled: { username: 'e06-disabled', password: 'E06DisabledPassphrase1!' },
} as const;

export const REAL_STACK_CAPABILITIES = {
  panelOperations: PANEL_OPERATION_IDS.length,
  studentOperations: 3,
  panelSockets: 2,
  studentSockets: 1,
} as const;

export interface RealStackDescriptor {
  readonly coreBaseUrl: string;
  readonly quizBaseUrl: string;
  readonly quizTlsBaseUrl: string;
  readonly controls: { readonly core: string; readonly quiz: string };
  readonly fixtureIds: {
    readonly lecturerUsername: string;
    readonly adminUsername: string;
    readonly resetUsername: string;
    readonly disabledUsername: string;
    readonly deviceId: string;
    readonly quizSessionId: string;
    readonly joinCode: string;
  };
}

export interface RealStackHandle {
  readonly descriptor: RealStackDescriptor;
  readonly capabilities: typeof REAL_STACK_CAPABILITIES;
  readonly coreBaseUrl: string;
  readonly quizBaseUrl: string;
  control<T = unknown>(action: string, input?: unknown): Promise<T>;
  close(): Promise<void>;
}

function postControl<T>(url: string, body: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const outgoing = request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.once('error', reject);
      response.once('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if ((response.statusCode ?? 500) >= 400) {
          reject(new Error(`real-stack control returned ${String(response.statusCode)}: ${raw}`));
          return;
        }
        try {
          resolve(JSON.parse(raw) as T);
        } catch (error) {
          reject(error);
        }
      });
    });
    outgoing.once('error', reject);
    outgoing.end(payload);
  });
}

function createHandle(
  descriptor: RealStackDescriptor,
  close: () => Promise<void>,
): RealStackHandle {
  return {
    descriptor,
    capabilities: REAL_STACK_CAPABILITIES,
    coreBaseUrl: descriptor.coreBaseUrl,
    quizBaseUrl: descriptor.quizBaseUrl,
    async control<T>(action: string, input?: unknown): Promise<T> {
      const group = action.startsWith('quiz.') ? 'quiz' : 'core';
      return postControl<T>(descriptor.controls[group], { action, input });
    },
    close,
  };
}

export async function startRealStack(): Promise<RealStackHandle> {
  const nonce = randomUUID();
  const deviceId = '01K4A8E0600000000000000001';
  const deviceBearer = `e06-device-${nonce}`;
  const internalBearer = `e06-internal-${nonce}`;

  let quiz: PeerProcess<QuizPeerReady> | undefined;
  let core: Awaited<ReturnType<typeof startCorePeer>> | undefined;
  try {
    quiz = await startQuizPeer({
      E06_QUIZ_DEVICE_ID: deviceId,
      E06_QUIZ_DEVICE_BEARER: deviceBearer,
      E06_QUIZ_COOKIE_SECRET: `e06-cookie-${nonce}`,
    });
    core = await startCorePeer({
      E06_QUIZ_BASE_URL: quiz.ready.baseUrl,
      E06_QUIZ_DEVICE_ID: deviceId,
      E06_QUIZ_DEVICE_BEARER: deviceBearer,
      E06_INTERNAL_BEARER: internalBearer,
      E06_JWT_SECRET: `e06-jwt-${nonce}`,
      E06_SECRETBOX_KEY: `e06-secretbox-${nonce}`,
      E06_LECTURER_PASSWORD: REAL_STACK_ACCOUNTS.lecturer.password,
      E06_ADMIN_PASSWORD: REAL_STACK_ACCOUNTS.admin.password,
      E06_RESET_PASSWORD: REAL_STACK_ACCOUNTS.reset.password,
      E06_DISABLED_PASSWORD: REAL_STACK_ACCOUNTS.disabled.password,
    });

    const descriptor: RealStackDescriptor = {
      coreBaseUrl: `${core.ready.baseUrl}/api/v1`,
      quizBaseUrl: quiz.ready.baseUrl,
      quizTlsBaseUrl: quiz.ready.tlsBaseUrl,
      controls: { core: core.ready.controlUrl, quiz: quiz.ready.controlUrl },
      fixtureIds: { ...core.ready.fixtureIds, ...quiz.ready.fixtureIds },
    };
    return createHandle(descriptor, async () => {
      await core?.close();
      await quiz?.close();
    });
  } catch (error) {
    await core?.close();
    await quiz?.close();
    throw error;
  }
}

export async function acquireRealStack(): Promise<RealStackHandle> {
  const encoded = process.env.EDUSCOPE_REAL_STACK_DESCRIPTOR;
  if (!encoded) return startRealStack();
  const descriptor = JSON.parse(encoded) as RealStackDescriptor;
  return createHandle(descriptor, async () => undefined);
}

function shape(value: unknown, key = ''): unknown {
  if (/state$|^source$|^label$/i.test(key)) return `<${key || 'value'}>`;
  if (value === null) return null;
  if (Array.isArray(value)) {
    return { collection: value.length === 0 ? 'empty' : 'non-empty', item: value[0] === undefined ? null : shape(value[0]) };
  }
  if (typeof value !== 'object') {
    if (/state|role|status|kind|source|enabled|disabled|mustReset/i.test(key)) return value;
    return `<${typeof value}>`;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([name]) => !/^(id|.*Id|.*At|.*Url|.*Token|nextCursor)$/i.test(name))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, child]) => [name, shape(child, name)]),
  );
}

/** Removes generated ids/instants and collapses collection cardinality for semantic parity checks. */
export function normalizeParityValue(value: unknown): unknown {
  return shape(value);
}

async function main(): Promise<void> {
  const stack = await startRealStack();
  process.stdout.write(`${JSON.stringify({ type: 'ready', descriptor: stack.descriptor })}\n`);
  let closing: Promise<void> | null = null;
  const close = (): Promise<void> => closing ??= stack.close();
  process.once('SIGINT', () => void close().then(() => process.exit(0)));
  process.once('SIGTERM', () => void close().then(() => process.exit(0)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error: unknown) => {
    process.stdout.write(`${JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : String(error) })}\n`);
    process.exitCode = 1;
  });
}
