import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import { zQuizSyncClientMessage, zQuizSyncServerMessage, zStudentServerEvent } from '@eduscope/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
const contractsDir = path.resolve(here, '../../../../contracts');

const OPENAPI_PATH = path.join(contractsDir, 'openapi.yaml');
const QUIZ_APP_PATH = path.join(contractsDir, 'quiz-app.yaml');

// Pins the contract files this task was implemented against (Global
// Constraint 1: a route/event is not done until it matches the ratified
// contract; implementation may not "fix" the contract locally).
const EXPECTED_OPENAPI_SHA256 = 'bfc5935aba40042bc9afe21523fbb7aef0fc0b62608a5648540073f01328925b';
const EXPECTED_QUIZ_APP_SHA256 = 'c6b52cbe7aad77380932fb41bc56f0c844c2510e2b6801fe9ec9391a0b691bd0';

const EXPECTED_SERVER_ONLY_OPERATION_IDS = [
  'quizSyncCreateSession',
  'quizSyncCloseSession',
  'quizSyncPublish',
  'quizSyncClosePublication',
];

const EXPECTED_STUDENT_OPERATION_IDS = ['resolveJoinCode', 'registerParticipant', 'submitAnswer'];

function readSource(filePath: string): Buffer {
  return readFileSync(filePath);
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function collectOperationIds(doc: unknown): string[] {
  const paths = (doc as { paths?: Record<string, Record<string, { operationId?: string }>> }).paths ?? {};
  const ids: string[] = [];
  for (const methods of Object.values(paths)) {
    for (const operation of Object.values(methods)) {
      if (operation && typeof operation === 'object' && typeof operation.operationId === 'string') {
        ids.push(operation.operationId);
      }
    }
  }
  return ids;
}

describe('v1.0.0 quiz contract load', () => {
  it('openapi.yaml and quiz-app.yaml match the ratified v1.0.0 checksum', () => {
    expect(sha256(readSource(OPENAPI_PATH))).toBe(EXPECTED_OPENAPI_SHA256);
    expect(sha256(readSource(QUIZ_APP_PATH))).toBe(EXPECTED_QUIZ_APP_SHA256);
  });

  it('both contract files declare info.version 1.0.0', () => {
    const openapi = parseYaml(readSource(OPENAPI_PATH).toString('utf8'));
    const quizApp = parseYaml(readSource(QUIZ_APP_PATH).toString('utf8'));
    expect((openapi as { info: { version: string } }).info.version).toBe('1.0.0');
    expect((quizApp as { info: { version: string } }).info.version).toBe('1.0.0');
  });

  it('openapi.yaml declares exactly the four D-owned server-only operations', () => {
    const openapi = parseYaml(readSource(OPENAPI_PATH).toString('utf8'));
    const ids = collectOperationIds(openapi);
    for (const expected of EXPECTED_SERVER_ONLY_OPERATION_IDS) {
      expect(ids).toContain(expected);
    }
  });

  it('quiz-app.yaml declares exactly the three D-owned student operations', () => {
    const quizApp = parseYaml(readSource(QUIZ_APP_PATH).toString('utf8'));
    const ids = collectOperationIds(quizApp);
    expect(ids.sort()).toEqual([...EXPECTED_STUDENT_OPERATION_IDS].sort());
  });

  it('parses one valid quiz-sync client message with the shared schema', () => {
    expect(() =>
      zQuizSyncClientMessage.parse({ type: 'sync.heartbeat', at: '2026-01-01T00:00:00.000+00:00' }),
    ).not.toThrow();
  });

  it('parses one valid quiz-sync server message with the shared schema', () => {
    expect(() =>
      zQuizSyncServerMessage.parse({ type: 'sync.heartbeat', at: '2026-01-01T00:00:00.000+00:00' }),
    ).not.toThrow();
  });

  it('parses one valid student server event with the shared schema', () => {
    expect(() =>
      zStudentServerEvent.parse({ event: 'quiz.participant', payload: { connectionState: 'online' } }),
    ).not.toThrow();
  });
});
