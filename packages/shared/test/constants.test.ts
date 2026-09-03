import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PANEL_OPERATION_IDS,
  SERVER_SIDE_ONLY_OPERATION_IDS,
  TIMERS,
  WS_RECONNECT_BACKOFF_MS,
} from '../src/index.js';

const spec = readFileSync(
  resolve(__dirname, '../../../contracts/openapi.yaml'),
  'utf8',
);

const contractOperationIds = () =>
  [...spec.matchAll(/^\s+operationId:\s*(\w+)\s*$/gm)].map((m) => m[1]!);

describe('constants', () => {
  it('carries the state-machines §9 timer values in milliseconds', () => {
    expect(TIMERS['T-START-CONFIRM']).toBe(5_000);
    expect(TIMERS['T-STOP-EOS']).toBe(8_000);
    expect(TIMERS['T-CMD-RESOLVE']).toBe(10_000);
    expect(TIMERS['T-WS-STALE']).toBe(10_000);
    expect(TIMERS['T-COUNTDOWN-RESYNC']).toBe(15_000);
    expect(TIMERS['T-LLM-REQUEST']).toBe(45_000);
    expect(TIMERS['T-QUIZ-SYNC-FAIL']).toBe(60_000);
  });

  it('uses the §9 reconnect ladder capped at 10 s', () => {
    expect(WS_RECONNECT_BACKOFF_MS).toEqual([500, 1_000, 2_000, 4_000, 8_000, 10_000]);
  });

  it('partitions every contract operation into panel-facing or server-side', () => {
    const all = contractOperationIds();
    expect(all.length).toBe(83);
    const declared = [...PANEL_OPERATION_IDS, ...SERVER_SIDE_ONLY_OPERATION_IDS];
    expect([...declared].sort()).toEqual([...all].sort());
  });

  it('excludes exactly the four quiz-sync operations', () => {
    expect([...SERVER_SIDE_ONLY_OPERATION_IDS].sort()).toEqual([
      'quizSyncClosePublication',
      'quizSyncCloseSession',
      'quizSyncCreateSession',
      'quizSyncPublish',
    ]);
    expect(PANEL_OPERATION_IDS).toHaveLength(79);
  });
});
