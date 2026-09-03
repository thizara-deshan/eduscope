import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PANEL_EVENT_NAMES, PANEL_OPERATION_IDS, SERVER_SIDE_ONLY_OPERATION_IDS,
} from '@eduscope/shared';
import { createVirtualClock } from '../src/mock/clock.js';
import { createMockClient } from '../src/mock/create-mock-client.js';
import { listScenarios } from '../src/mock/scenario/registry.js';

const spec = readFileSync(resolve(__dirname, '../../../contracts/openapi.yaml'), 'utf8');
const catalog = readFileSync(resolve(__dirname, '../../../contracts/events.md'), 'utf8');

const specOperationIds = () =>
  [...spec.matchAll(/^\s+operationId:\s*(\w+)\s*$/gm)].map((m) => m[1]!);
const specEventNames = () =>
  [...catalog.matchAll(/^### 2\.\d+ `([a-z.]+)`/gm)].map((m) => m[1]!);

describe('GATE 2 — contract coverage', () => {
  it('2a: the mock implements every panel-facing operation in the spec', () => {
    const all = specOperationIds();
    const excluded = new Set<string>(SERVER_SIDE_ONLY_OPERATION_IDS);
    const expected = all.filter((id) => !excluded.has(id));
    const client = createMockClient('happy') as unknown as Record<string, unknown>;

    expect(expected.length).toBe(79);
    const missing = expected.filter((id) => typeof client[id] !== 'function');
    expect(missing, `mock does not implement: ${missing.join(', ')}`).toEqual([]);
  });

  it('2b: the exclusion list is exactly the quiz-sync tag, nothing more', () => {
    const all = new Set(specOperationIds());
    for (const id of SERVER_SIDE_ONLY_OPERATION_IDS) {
      expect(all.has(id), `${id} is not in the spec at all`).toBe(true);
      expect(id.startsWith('quizSync'), `${id} is not a quiz-sync operation`).toBe(true);
    }
    expect(PANEL_OPERATION_IDS.length + SERVER_SIDE_ONLY_OPERATION_IDS.length).toBe(all.size);
  });

  it('2c: every catalogued event name is declared', () => {
    const missing = specEventNames().filter(
      (n) => !(PANEL_EVENT_NAMES as readonly string[]).includes(n),
    );
    expect(missing, `undeclared events: ${missing.join(', ')}`).toEqual([]);
  });

  it('2d: every operation returns without throwing an unexpected error', async () => {
    const client = createMockClient('happy', {
      clock: createVirtualClock('2026-07-30T09:00:00.000+00:00'),
    }) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;

    const unexpected: string[] = [];
    for (const id of PANEL_OPERATION_IDS) {
      try {
        await client[id]!('01JBQ8ZK3T7WBM5N2Q4XPRVC9D', {});
      } catch (e) {
        // ProblemError is a legitimate contract answer (403/404/409). Anything
        // else — a TypeError, an unhandled undefined — is a hole in the mock.
        if ((e as Error).name !== 'ProblemError') {
          unexpected.push(`${id}: ${(e as Error).name}: ${(e as Error).message}`);
        }
      }
    }
    expect(unexpected, `operations threw non-contract errors:\n${unexpected.join('\n')}`)
      .toEqual([]);
  });

  it('2e: every scenario keeps the mock contract-honest', async () => {
    for (const script of listScenarios()) {
      const client = createMockClient(script.name, {
        clock: createVirtualClock('2026-07-30T09:00:00.000+00:00'),
      });
      // The snapshot is emitted through zEventEnvelope.parse, so a schema
      // violation under any script throws here rather than in a screen.
      expect(() => client.events$.subscribe(() => {}), script.name).not.toThrow();
      await expect(client.getRecordingState(), script.name).resolves.toBeTruthy();
    }
  });
});
