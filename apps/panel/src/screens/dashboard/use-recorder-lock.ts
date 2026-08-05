import type { RecordingStatePayload, User } from '@eduscope/shared';
import { useAuth } from '../../auth/auth-context.js';
import { useRecordingSession } from '../../store/selectors.js';

export type RecorderLock =
  | { readonly kind: 'idle' }
  | { readonly kind: 'owned' }
  | {
      readonly kind: 'locked';
      readonly ownerDisplayName: string | null;
      readonly title: string | null;
      readonly startedAt: string | null;
      readonly recordedDurationMs: number | null;
      readonly phase: 'starting' | 'live' | 'ending';
      readonly canTakeOver: boolean;
      readonly takenOverByDisplayName: string | null;
    }
  | {
      readonly kind: 'takenOver';
      readonly priorOwnerDisplayName: string | null;
      readonly at: string | null;
    }
  | {
      readonly kind: 'displaced';
      readonly byDisplayName: string | null;
      readonly at: string | null;
    };

const NON_TERMINAL = new Set<RecordingStatePayload['state']>([
  'starting', 'recording', 'paused', 'stopping', 'finalizing',
]);

function lockPhase(
  state: RecordingStatePayload['state'],
): 'starting' | 'live' | 'ending' {
  if (state === 'starting') return 'starting';
  if (state === 'stopping' || state === 'finalizing') return 'ending';
  return 'live';
}

export function foldRecorderLock(
  session: RecordingStatePayload | null,
  me: Pick<User, 'id' | 'role'> | null,
): RecorderLock {
  if (!session || !NON_TERMINAL.has(session.state)) return { kind: 'idle' };

  if (me && session.takeoverBy === me.id) {
    return {
      kind: 'takenOver',
      priorOwnerDisplayName: session.ownerDisplayName,
      at: session.takeoverAt,
    };
  }

  if (me && session.ownerUserId === me.id) {
    if (session.takeoverBy === null) return { kind: 'owned' };
    return {
      kind: 'displaced',
      byDisplayName: session.takeoverByDisplayName,
      at: session.takeoverAt,
    };
  }

  const phase = lockPhase(session.state);
  return {
    kind: 'locked',
    ownerDisplayName: session.ownerDisplayName,
    title: session.title,
    startedAt: session.startedAt,
    recordedDurationMs: session.recordedDurationMs,
    phase,
    canTakeOver: session.takeoverBy === null && me?.role === 'admin' && phase !== 'ending',
    takenOverByDisplayName: session.takeoverBy === null
      ? null
      : session.takeoverByDisplayName,
  };
}

export function useRecorderLock(): RecorderLock {
  const session = useRecordingSession();
  const auth = useAuth();
  return foldRecorderLock(session, auth.user);
}
