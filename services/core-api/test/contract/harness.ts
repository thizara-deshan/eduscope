import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PANEL_EVENT_NAMES, PANEL_OPERATION_IDS, SERVER_SIDE_ONLY_OPERATION_IDS } from '@eduscope/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
const contractsDir = path.resolve(here, '../../../../contracts');

export function readOpenApiSource(): string {
  return readFileSync(path.join(contractsDir, 'openapi.yaml'), 'utf8');
}

export function readQuizAppSource(): string {
  return readFileSync(path.join(contractsDir, 'quiz-app.yaml'), 'utf8');
}

export function readEventsSource(): string {
  return readFileSync(path.join(contractsDir, 'events.md'), 'utf8');
}

/**
 * Extracts the `version:` value nested directly under a top-level `info:`
 * key in an OpenAPI YAML document, without pulling in a YAML parser dependency
 * this service otherwise has no use for.
 */
export function extractInfoVersion(source: string): string | null {
  const lines = source.split('\n').map((line) => line.replace(/\r$/, ''));
  const infoIndex = lines.findIndex((line) => line === 'info:');
  if (infoIndex === -1) return null;

  for (let i = infoIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (/^\S/.test(line)) break; // next top-level key ends the info: block
    const match = /^\s{2}version:\s*"?([^"\s]+)"?\s*$/.exec(line);
    if (match?.[1] !== undefined) return match[1];
  }
  return null;
}

const EXPECTED_VERSION = '1.0.0';
const EXPECTED_PANEL_OPERATION_COUNT = 79;
const EXPECTED_SERVER_SIDE_ONLY_OPERATION_COUNT = 4;
const EXPECTED_PANEL_EVENT_COUNT = 22;

/**
 * Asserts the three repository contract files agree on v1.0.0 and that the
 * shared operation/event catalogs still partition to the counts this task
 * pins down. Reused by every future `test/contract/*.contract.test.ts`.
 */
export function assertV1Contracts(): void {
  const openapiVersion = extractInfoVersion(readOpenApiSource());
  if (openapiVersion !== EXPECTED_VERSION) {
    throw new Error(
      `contracts/openapi.yaml info.version expected ${EXPECTED_VERSION}, got ${String(openapiVersion)}`,
    );
  }

  const quizAppVersion = extractInfoVersion(readQuizAppSource());
  if (quizAppVersion !== EXPECTED_VERSION) {
    throw new Error(
      `contracts/quiz-app.yaml info.version expected ${EXPECTED_VERSION}, got ${String(quizAppVersion)}`,
    );
  }

  const eventsSource = readEventsSource();
  if (!eventsSource.includes(`Contract **v${EXPECTED_VERSION}**`)) {
    throw new Error(`contracts/events.md missing "Contract **v${EXPECTED_VERSION}**" marker`);
  }

  if (PANEL_OPERATION_IDS.length !== EXPECTED_PANEL_OPERATION_COUNT) {
    throw new Error(
      `PANEL_OPERATION_IDS expected ${EXPECTED_PANEL_OPERATION_COUNT} entries, got ${PANEL_OPERATION_IDS.length}`,
    );
  }
  if (SERVER_SIDE_ONLY_OPERATION_IDS.length !== EXPECTED_SERVER_SIDE_ONLY_OPERATION_COUNT) {
    throw new Error(
      `SERVER_SIDE_ONLY_OPERATION_IDS expected ${EXPECTED_SERVER_SIDE_ONLY_OPERATION_COUNT} entries, got ${SERVER_SIDE_ONLY_OPERATION_IDS.length}`,
    );
  }
  if (PANEL_EVENT_NAMES.length !== EXPECTED_PANEL_EVENT_COUNT) {
    throw new Error(`PANEL_EVENT_NAMES expected ${EXPECTED_PANEL_EVENT_COUNT} entries, got ${PANEL_EVENT_NAMES.length}`);
  }
}

/** A minimal, contract-valid `recording.state` envelope for parse smoke tests. */
export const sampleEventEnvelope = {
  event: 'recording.state' as const,
  payload: {
    state: 'idle' as const,
    startReason: null,
    sessionId: null,
    title: null,
    ownerUserId: null,
    ownerDisplayName: null,
    startedAt: null,
    recordedDurationMs: null,
    segmentIndex: null,
    segmentCount: null,
    pauseCount: null,
    takeoverBy: null,
    takeoverAt: null,
    takeoverByDisplayName: null,
    errorCode: null,
    errorMessage: null,
  },
  at: '2026-08-18T00:00:00.000+00:00',
  seq: 0,
};
