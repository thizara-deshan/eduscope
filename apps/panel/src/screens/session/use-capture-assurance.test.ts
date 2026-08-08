import { describe, expect, it } from 'vitest';
import type {
  ChannelStatePayload, SourceRoleId, SourcesStatusPayload, SystemAlert,
} from '@eduscope/shared';
import {
  foldCaptureVerdict, STILL_RECORDING_SENTENCE, type CaptureAssuranceInput,
} from './use-capture-assurance.js';

const ROLE_STATES = ['online', 'degraded', 'offline', 'unknown'] as const;
const CHANNEL_STATES = ['on', 'starting', 'restarting', 'failed', 'off'] as const;
const PRESSURES = ['ok', 'warning', 'critical'] as const;

type RoleState = typeof ROLE_STATES[number];
type LogicalChannelState = typeof CHANNEL_STATES[number];
type Pressure = typeof PRESSURES[number];

const ROLE_TIER: Record<RoleState, 1 | 2 | 3 | 4> = {
  online: 1, unknown: 2, degraded: 3, offline: 4,
};
const CHANNEL_TIER: Record<LogicalChannelState, 1 | 3 | 4> = {
  on: 1, off: 1, starting: 3, restarting: 3, failed: 4,
};
const PRESSURE_TIER: Record<Pressure, 1 | 3 | 4> = {
  ok: 1, warning: 3, critical: 4,
};

function source(roleId: SourceRoleId, state: RoleState): SourcesStatusPayload {
  return {
    roleId, state, detail: null, inputId: null, since: '2026-08-05T10:00:00.000Z',
  };
}

function channel(state: LogicalChannelState): ChannelStatePayload {
  return {
    channelId: 'meeting',
    state: state === 'restarting' ? 'starting' : state,
    presetId: 'cams-fifty-fifty', ratioA: 50, ratioB: 50, reason: null,
  };
}

function restartingAlert(): SystemAlert {
  return {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAA', code: 'channel.restarting', severity: 'warning',
    category: 'Session', title: 'Live Meeting is reconnecting.', detail: null,
    raisedAt: '2026-08-05T10:00:00.000Z', clearedAt: null, clearedReason: null,
    acknowledgedBy: null, context: { channelId: 'meeting' },
    relatedEntity: { type: 'channel', id: 'meeting' },
  };
}

function build({
  role = 'online', channel: channelState = 'on', pressure = 'ok', micOffline = false,
  recording = 'recording', cold = false, stale = false,
}: {
  role?: RoleState;
  channel?: LogicalChannelState;
  pressure?: Pressure;
  micOffline?: boolean;
  recording?: CaptureAssuranceInput['recording'];
  cold?: boolean;
  stale?: boolean;
} = {}): CaptureAssuranceInput {
  return {
    sources: {
      presentation: source('presentation', role),
      ...(micOffline ? { 'mic-lecturer': source('mic-lecturer', 'offline') } : {}),
    },
    channels: { meeting: channel(channelState) },
    alerts: channelState === 'restarting'
      ? { '01ARZ3NDEKTSV4RRFFQ69G5FAA': restartingAlert() }
      : {},
    pressure,
    recording,
    stale,
    cold,
  };
}

function expectedTier(role: RoleState, channelState: LogicalChannelState, pressure: Pressure) {
  return Math.max(ROLE_TIER[role], CHANNEL_TIER[channelState], PRESSURE_TIER[pressure]);
}

describe('the fold is never greener than its worst input (S05-D-3)', () => {
  for (const role of ROLE_STATES) {
    for (const channelState of CHANNEL_STATES) {
      for (const pressure of PRESSURES) {
        it(`role=${role} channel=${channelState} pressure=${pressure}`, () => {
          const verdict = foldCaptureVerdict(build({ role, channel: channelState, pressure }));
          expect(verdict.tier).toBe(expectedTier(role, channelState, pressure));
          if (role === 'online' && pressure === 'ok' && channelState === 'starting') {
            expect(verdict.sentence).toBe('Live Meeting is starting.');
          }
          if (role === 'online' && pressure === 'ok' && channelState === 'restarting') {
            expect(verdict.sentence).toBe('Live Meeting is reconnecting.');
          }
        });
      }
    }
  }
});

it('ranks unknown ABOVE online: one stale role with everything else healthy is tier 2', () => {
  const verdict = foldCaptureVerdict(build({ role: 'unknown', channel: 'on', pressure: 'ok' }));
  expect(verdict.tier).toBe(2);
  expect(verdict.sentence).toBe('Checking the room…');
  expect(foldCaptureVerdict(build({ cold: true })).tier).toBe(2);
  expect(foldCaptureVerdict(build({ stale: true })).tier).toBe(2);
  expect(foldCaptureVerdict({ ...build(), pressure: null }).tier).toBe(2);
});

it('a dead mic always wins the tie', () => {
  const verdict = foldCaptureVerdict(build({
    role: 'offline', channel: 'failed', pressure: 'critical', micOffline: true,
  }));
  expect(verdict.subject).toBe('Microphone');
  expect(verdict.sentence).toContain('recording silence');
});

it('every tier-4 verdict carries the R-SRC-1 sentence while 1a is recording', () => {
  for (const role of ROLE_STATES) {
    for (const channelState of CHANNEL_STATES) {
      for (const pressure of PRESSURES) {
        const verdict = foldCaptureVerdict(build({
          role, channel: channelState, pressure, recording: 'recording',
        }));
        if (verdict.tier === 4) {
          expect(verdict.reassurance).toBe(STILL_RECORDING_SENTENCE);
        }
      }
    }
  }
});

it('paused and saving states replace the verdict sentence', () => {
  expect(foldCaptureVerdict(build({ recording: 'paused' })).sentence)
    .toBe('Paused — nothing is being recorded right now.');
  expect(foldCaptureVerdict(build({ recording: 'stopping' })).sentence)
    .toBe('Saving your lecture…');
  expect(foldCaptureVerdict(build({ recording: 'finalizing' })).sentence)
    .toBe('Saving your lecture…');
});
