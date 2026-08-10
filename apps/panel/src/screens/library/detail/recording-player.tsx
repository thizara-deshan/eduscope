import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { Recording, RecordingFile } from '@eduscope/shared';
import { useAuth } from '../../../auth/auth-context.js';
import { useClient } from '../../../client/client-provider.js';
import './detail.css';

function timecode(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * S-22 §2.1/C-1 — custom touch controls over the authenticated Range route.
 * `src` is an object URL built from the client's `Blob` — never a hand-
 * assembled URL (frontend-conventions §1). `file missing` (C-6) is a distinct,
 * named state from a media transport error on a present file.
 */
export function RecordingPlayer({
  recordingId,
  file,
}: {
  readonly recordingId: Recording['id'];
  readonly file: RecordingFile;
}): JSX.Element {
  const client = useClient();
  const { role } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<'forbidden' | 'playback-failed' | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (file.state === 'missing') return;
    let url: string | null = null;
    let cancelled = false;
    setLoadError(null);
    client.getRecordingMedia(recordingId, file.id).then((blob) => {
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      setSrc(url);
    }).catch((error: unknown) => {
      if (cancelled) return;
      const status = (error as { problem?: { status?: number } })?.problem?.status;
      setLoadError(status === 403 ? 'forbidden' : 'playback-failed');
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [client, recordingId, file.id, file.state]);

  if (file.state === 'missing') {
    return (
      <div className="us-detail__player us-detail__player--message">
        <p>This file is no longer on the device. Its upload needs attention.</p>
        {role === 'admin' ? <Link to="/advanced/uploads">Go to Upload Queue</Link> : null}
      </div>
    );
  }

  if (loadError === 'forbidden') {
    return (
      <div className="us-detail__player us-detail__player--message">
        <p>You don&apos;t have access to this recording.</p>
      </div>
    );
  }

  if (loadError === 'playback-failed') {
    return (
      <div className="us-detail__player us-detail__player--message">
        <p>Playback stopped.</p>
        <button type="button" onClick={() => setLoadError(null)}>Try again</button>
      </div>
    );
  }

  return (
    <div className="us-detail__player">
      {src ? (
        <video
          ref={videoRef}
          src={src}
          aria-label="Recording video"
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onDurationChange={(e) => setDuration(e.currentTarget.duration)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onError={() => setLoadError('playback-failed')}
        />
      ) : null}
      <div className="us-detail__controls">
        <button
          type="button"
          className="us-detail__play"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={() => {
            if (!videoRef.current) return;
            if (playing) videoRef.current.pause(); else void videoRef.current.play();
          }}
        >
          {playing ? '⏸' : '▷'}
        </button>
        <button
          type="button"
          className="us-detail__skip"
          aria-label="Back 10 seconds"
          onClick={() => { if (videoRef.current) videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10); }}
        >
          ⟲10
        </button>
        <button
          type="button"
          className="us-detail__skip"
          aria-label="Forward 10 seconds"
          onClick={() => { if (videoRef.current) videoRef.current.currentTime = Math.min(duration, videoRef.current.currentTime + 10); }}
        >
          ⟳10
        </button>
        <input
          type="range"
          className="us-detail__scrub"
          role="slider"
          min={0}
          max={duration || 0}
          value={currentTime}
          aria-label="Seek"
          aria-valuetext={timecode(currentTime)}
          onChange={(e) => { if (videoRef.current) videoRef.current.currentTime = Number(e.target.value); }}
        />
        <button
          type="button"
          className="us-detail__mute"
          aria-label="Mute"
          onClick={() => { if (videoRef.current) videoRef.current.muted = !videoRef.current.muted; }}
        >
          🔊
        </button>
        <button
          type="button"
          className="us-detail__fullscreen"
          aria-label="Fullscreen"
          onClick={() => { void videoRef.current?.requestFullscreen(); }}
        >
          ⤢
        </button>
      </div>
    </div>
  );
}
