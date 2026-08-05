import type { ReactNode } from 'react';
import type { RecordingStatePayload } from '@eduscope/shared';
import { useTicker } from '../../hooks/use-ticker.js';
import { elapsedMs, formatElapsed } from '../transport/timer-card.js';
import './dashboard.css';

export interface LockCardProps {
  readonly ownerDisplayName: string | null;
  readonly title: string | null;
  readonly startedAt: string | null;
  readonly recordedDurationMs: number | null;
  readonly recordingState: RecordingStatePayload['state'];
  readonly phase: 'starting' | 'live' | 'ending';
  readonly note: string;
  readonly stale: boolean;
  readonly action?: ReactNode;
}

function startedTime(startedAt: string): string {
  const match = /T(\d{2}:\d{2})/.exec(startedAt);
  return match?.[1] ?? startedAt;
}

export function LockCard({
  ownerDisplayName,
  title,
  startedAt,
  recordedDurationMs,
  recordingState,
  phase,
  note,
  stale,
  action,
}: LockCardProps): JSX.Element {
  const now = useTicker(1_000);
  const eyebrow = phase === 'ending'
    ? 'SAVING'
    : recordingState === 'paused' ? 'RECORDING PAUSED' : 'RECORDING IN PROGRESS';
  const digits = phase === 'starting' && startedAt === null
    ? 'Starting…'
    : formatElapsed(elapsedMs({ state: recordingState, startedAt, recordedDurationMs }, now));
  const caption = phase === 'ending'
    ? 'Saving…'
    : startedAt ? `started ${startedTime(startedAt)}` : '';

  return (
    <section
      className={`us-lockcard${stale ? ' us-lockcard--stale' : ''}`}
      data-testid="lock-card"
      data-stale={stale || undefined}
      aria-label="Recording controlled by another user"
    >
      <div className="us-lockcard__eyebrow">{eyebrow}</div>
      <h1 className="us-lockcard__owner">{ownerDisplayName ?? 'Another lecturer'}</h1>
      <div className="us-lockcard__title">{title ?? 'Untitled lecture'}</div>
      <div className="us-lockcard__elapsed" data-testid="lock-elapsed">{digits}</div>
      <div className="us-lockcard__caption" data-testid="lock-caption">{caption}</div>
      <p className="us-lockcard__note">{note}</p>
      {stale ? (
        <p className="us-lockcard__offline">Not connected — this may be out of date.</p>
      ) : null}
      {action ? <div className="us-lockcard__action">{action}</div> : null}
    </section>
  );
}
