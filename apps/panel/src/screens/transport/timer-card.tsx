import { useRef, useState } from 'react';
import type { RecordingStatePayload } from '@eduscope/shared';
import { useAuth } from '../../auth/auth-context.js';
import { useTicker } from '../../hooks/use-ticker.js';
import { useOverlays } from '../../overlays/overlay-host.js';
import {
  useIsStale, useLastSegment, useRecordingSession, useRecordingState,
} from '../../store/selectors.js';
import { useTransport } from './use-transport.js';
import { StopRecordingConfirm } from './stop-recording-confirm.js';
import './transport.css';

export function elapsedMs(
  session: Pick<RecordingStatePayload, 'state' | 'startedAt' | 'recordedDurationMs'>,
  now: number,
): number {
  const recorded = session.recordedDurationMs ?? 0;
  if (session.state !== 'recording' || session.startedAt === null) return recorded;
  const started = Date.parse(session.startedAt);
  return Number.isFinite(started) ? recorded + Math.max(0, now - started) : recorded;
}

export function formatElapsed(milliseconds: number): string {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1_000);
  const hours = String(Math.floor(seconds / 3_600)).padStart(2, '0');
  const minutes = String(Math.floor((seconds % 3_600) / 60)).padStart(2, '0');
  const remainder = String(seconds % 60).padStart(2, '0');
  return `${hours}:${minutes}:${remainder}`;
}

export function TimerCard({ defaultCollapsed = false }: { readonly defaultCollapsed?: boolean }) {
  const session = useRecordingSession();
  const recordingState = useRecordingState();
  const lastSegment = useLastSegment();
  const stale = useIsStale();
  const auth = useAuth();
  const transport = useTransport();
  const overlays = useOverlays();
  const now = useTicker(1_000);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const stopButtonRef = useRef<HTMLButtonElement>(null);
  const stopOverlayOpenRef = useRef(false);

  const starting = recordingState === 'starting' && session?.startedAt === null;
  const saving = recordingState === 'stopping' || recordingState === 'finalizing';
  const paused = recordingState === 'paused';
  const hasTransportAuthority = Boolean(
    auth.user?.id
      && (auth.user.id === session?.ownerUserId || auth.user.id === session?.takeoverBy),
  );
  const commandableState = recordingState === 'recording' || recordingState === 'paused';
  const digits = starting
    ? 'Starting…'
    : formatElapsed(session ? elapsedMs(session, now) : 0);

  const requestStop = () => {
    if (stopOverlayOpenRef.current) return;
    stopOverlayOpenRef.current = true;
    let overlayId = -1;

    const close = (restoreFocus: boolean) => {
      overlays.close(overlayId);
      stopOverlayOpenRef.current = false;
      if (restoreFocus) queueMicrotask(() => stopButtonRef.current?.focus());
    };

    overlayId = overlays.open(
      <StopRecordingConfirm
        disabled={!transport.canCommand || !commandableState || transport.pending !== null}
        onCancel={() => close(true)}
        onConfirm={() => {
          if (!stopOverlayOpenRef.current) return;
          close(false);
          transport.run('stop');
        }}
      />,
      { dismissible: true },
    );
  };

  return (
    <section
      className={`us-timercard${collapsed ? ' us-timercard--collapsed' : ''}${stale ? ' us-timercard--stale' : ''}`}
      id="recording-transport"
      tabIndex={-1}
      data-testid="timer-card"
      data-stale={stale || undefined}
    >
      <button
        type="button"
        className="us-timercard__chev"
        onClick={() => setCollapsed((value) => !value)}
        aria-label={collapsed ? 'Expand timer' : 'Collapse timer'}
      >
        {collapsed ? '⌄' : '⌃'}
      </button>
      <div
        className={`us-timercard__digits${collapsed ? ' us-timercard__digits--small' : ''}`}
        aria-label="Recording duration"
        aria-live="off"
      >
        {digits}
      </div>
      {!collapsed && paused ? <span className="us-timercard__pausednote">Recording paused</span> : null}
      {!collapsed && saving ? <span className="us-timercard__saving">Saving…</span> : null}
      {!collapsed && lastSegment?.endReason === 'crash' ? (
        <span className="us-timercard__seam">Recording continued after a brief interruption.</span>
      ) : null}
      {!collapsed && stale ? <span className="us-timercard__stalenote">Connection is stale</span> : null}
      {!collapsed && transport.failure ? (
        <span className="us-timercard__failure" role="alert">{transport.failure}</span>
      ) : null}
      {!collapsed && hasTransportAuthority ? (
        <div className="us-timercard__actions">
          <button
            type="button"
            className="us-timercard__pause"
            disabled={!transport.canCommand || !commandableState || transport.pending !== null}
            onClick={() => transport.run(paused ? 'resume' : 'pause')}
          >
            {transport.pending === 'pause'
              ? 'Pausing…'
              : transport.pending === 'resume'
                ? 'Resuming…'
                : paused ? 'Resume' : 'Pause'}
          </button>
          <button
            ref={stopButtonRef}
            type="button"
            className="us-timercard__stop"
            disabled={!transport.canCommand || !commandableState || transport.pending === 'stop'}
            onClick={requestStop}
          >
            {transport.pending === 'stop' ? 'Stopping…' : 'Stop'}
          </button>
        </div>
      ) : null}
    </section>
  );
}
