import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PANEL_EVENT_NAMES,
  zEventEnvelope,
  zPanelServerEvent,
  zPreviewClientMessage,
  zPreviewServerMessage,
} from '../src/schemas/events.js';

const catalog = readFileSync(
  resolve(__dirname, '../../../contracts/events.md'),
  'utf8',
);

/** §2 headings look like: `### 2.7 `audio.control` *(v0 addition)*` */
function contractEventNames(): string[] {
  return [...catalog.matchAll(/^### 2\.\d+ `([a-z.]+)`/gm)].map((m) => m[1]!);
}

describe('event catalog coverage', () => {
  const names = contractEventNames();

  it('reads 22 events out of contracts/events.md §2', () => {
    expect(names).toHaveLength(22);
    expect(names).toContain('recording.state');
    expect(names).toContain('firmware.state');
  });

  it('declares exactly the contract event names', () => {
    expect([...PANEL_EVENT_NAMES].sort()).toEqual([...names].sort());
  });

  it('has a union member for every event name', () => {
    const members = new Set(
      zPanelServerEvent.options.map((o) => o.shape.event.value as string),
    );
    const missing = names.filter((n) => !members.has(n));
    expect(missing, `no union member for: ${missing.join(', ')}`).toEqual([]);
  });

  it('validates an envelope with seq and an ISO instant', () => {
    const parsed = zEventEnvelope.parse({
      event: 'audio.levels',
      at: '2026-07-30T09:00:00+00:00',
      seq: 41,
      payload: { roleId: 'mic-lecturer', rms: 0.42 },
    });
    expect(parsed.seq).toBe(41);
  });

  it('rejects an rms outside 0–1 (events.md §2.6)', () => {
    expect(() =>
      zPanelServerEvent.parse({
        event: 'audio.levels',
        payload: { roleId: 'mic-lecturer', rms: 1.7 },
      }),
    ).toThrow();
  });

  it('models the preview socket in both directions (events.md §3)', () => {
    expect(
      zPreviewClientMessage.parse({
        type: 'offer',
        negotiationId: '01JBQ8ZK3T7WBM5N2Q4XPRVC9D',
        roleId: 'lecturer-cam',
        sdp: 'v=0',
      }).type,
    ).toBe('offer');
    expect(
      zPreviewServerMessage.parse({
        type: 'error',
        negotiationId: '01JBQ8ZK3T7WBM5N2Q4XPRVC9D',
        code: 'source-offline',
        message: 'No signal',
      }).type,
    ).toBe('error');
  });

  it('accepts device.health event with publisherStates as a record (contracts/openapi.yaml DeviceHealth)', () => {
    const parsed = zPanelServerEvent.parse({
      event: 'device.health',
      payload: {
        captureCardState: 'present',
        publisherStates: {
          'lecturer-cam': { status: 'running', lastErrorCode: null, since: '2026-07-30T08:00:00Z' },
          'screen-share': { status: 'exited', lastErrorCode: 'connection-lost', since: '2026-07-30T08:30:00Z' },
        },
        ntpSynced: true,
        clockOffsetMs: null,
        diskHealth: 'good',
        lastBootAt: '2026-07-28T10:15:00Z',
      },
    });
    if (parsed.event !== 'device.health') {
      throw new Error(`expected device.health, got ${parsed.event}`);
    }
    expect(parsed.payload.publisherStates['lecturer-cam']?.status).toBe('running');
  });

  it('rejects studentIdNumber exceeding 32 chars (contracts/openapi.yaml AnswerProjection)', () => {
    expect(() =>
      zPanelServerEvent.parse({
        event: 'quiz.responses',
        payload: {
          publicationId: '01JBQ8ZK3T7WBM5N2Q4XPRVC9D',
          deltas: [
            {
              studentIdNumber: 'a'.repeat(33),
              displayName: 'Alice',
              selectedOptionId: '01JBQ8ZK3T7WBM5N2Q4XPRVC9D',
              isCorrect: true,
              responseTimeMs: 1000,
              submittedAt: '2026-07-30T09:00:00Z',
            },
          ],
          syncedAt: '2026-07-30T09:00:00Z',
          stale: false,
        },
      }),
    ).toThrow();
  });
});
