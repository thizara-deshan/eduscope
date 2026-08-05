import { describe, expect, it } from 'vitest';
import type { RecordingStatePayload, User } from '@eduscope/shared';
import { foldRecorderLock, type RecorderLock } from './use-recorder-lock.js';

const OWNER_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const OTHER_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAA';
const ADMIN_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAB';
const TAKER_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAC';
const THIRD_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAD';

const VIEWERS = {
  owner: { id: OWNER_ID, role: 'lecturer' },
  'other-lecturer': { id: OTHER_ID, role: 'lecturer' },
  admin: { id: ADMIN_ID, role: 'admin' },
  'admin-who-took-over': { id: TAKER_ID, role: 'admin' },
} as const satisfies Record<string, Pick<User, 'id' | 'role'>>;

const STATES = [
  'idle', 'starting', 'recording', 'paused',
  'stopping', 'finalizing', 'completed', 'error',
] as const;
const TAKEOVERS = ['null', 'me', 'other'] as const;
const NON_TERMINAL = new Set(['starting', 'recording', 'paused', 'stopping', 'finalizing']);

function session(
  state: typeof STATES[number],
  takeover: typeof TAKEOVERS[number],
  me: Pick<User, 'id' | 'role'>,
): RecordingStatePayload {
  return {
    state, startReason: 'initial', sessionId: OWNER_ID, title: 'Data Structures',
    ownerUserId: OWNER_ID, ownerDisplayName: 'A. Perera',
    startedAt: state === 'starting' ? null : '2026-08-05T10:00:00.000Z',
    recordedDurationMs: 125_000, segmentIndex: 1, segmentCount: 1, pauseCount: 0,
    takeoverBy: takeover === 'null' ? null : takeover === 'me' ? me.id : THIRD_ID,
    takeoverAt: takeover === 'null' ? null : '2026-08-05T10:12:00.000Z',
    takeoverByDisplayName: takeover === 'null' ? null : takeover === 'me' ? 'Current viewer' : 'R. Fernando',
    errorCode: null, errorMessage: null,
  };
}

function expected(
  state: typeof STATES[number],
  takeover: typeof TAKEOVERS[number],
  me: Pick<User, 'id' | 'role'>,
): Pick<RecorderLock, 'kind'> & { canTakeOver?: boolean } {
  if (!NON_TERMINAL.has(state)) return { kind: 'idle' };
  const isOwner = me.id === OWNER_ID;
  if (takeover === 'me') return { kind: 'takenOver' };
  if (isOwner) return takeover === 'null' ? { kind: 'owned' } : { kind: 'displaced' };
  const ending = state === 'stopping' || state === 'finalizing';
  return {
    kind: 'locked',
    canTakeOver: takeover === 'null' && me.role === 'admin' && !ending,
  };
}

describe('foldRecorderLock exhaustive authority table', () => {
  for (const [viewerName, me] of Object.entries(VIEWERS)) {
    for (const state of STATES) {
      for (const takeover of TAKEOVERS) {
        it(`viewer=${viewerName} state=${state} takeoverBy=${takeover}`, () => {
          const verdict = foldRecorderLock(session(state, takeover, me), me);
          const wanted = expected(state, takeover, me);
          expect(verdict.kind).toBe(wanted.kind);
          if (verdict.kind === 'locked') {
            expect(verdict.canTakeOver).toBe(wanted.canTakeOver);
          }
        });
      }
    }
  }
});

it('foldRecorderLock(null, me) is idle', () => {
  expect(foldRecorderLock(null, VIEWERS.owner)).toEqual({ kind: 'idle' });
});

it('terminal states are always idle regardless of takeoverBy', () => {
  for (const state of ['idle', 'completed', 'error'] as const) {
    for (const takeover of TAKEOVERS) {
      expect(foldRecorderLock(session(state, takeover, VIEWERS.admin), VIEWERS.admin))
        .toEqual({ kind: 'idle' });
    }
  }
});

it('an other-lecturer viewer never receives takeover authority', () => {
  const me = VIEWERS['other-lecturer'];
  for (const state of STATES) {
    for (const takeover of TAKEOVERS) {
      const verdict = foldRecorderLock(session(state, takeover, me), me);
      if (verdict.kind === 'locked') expect(verdict.canTakeOver).toBe(false);
    }
  }
});

it('takenOver preserves the prior owner attribution and never names me', () => {
  const verdict = foldRecorderLock(session('recording', 'me', VIEWERS['admin-who-took-over']), VIEWERS['admin-who-took-over']);
  expect(verdict).toEqual({
    kind: 'takenOver',
    priorOwnerDisplayName: 'A. Perera',
    at: '2026-08-05T10:12:00.000Z',
  });
  expect(verdict.kind === 'takenOver' && verdict.priorOwnerDisplayName).not.toBe('Current viewer');
});
