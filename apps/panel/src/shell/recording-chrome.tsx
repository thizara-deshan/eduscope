import { useEffect, useRef, useState } from 'react';
import { useRecordingSession, useRecordingState } from '../store/selectors.js';
import './shell.css';

const SAVED_TOAST_MS = 3_000;

/**
 * The device's recording state, not the screen's — mounted on EVERY route,
 * including the two auth routes (Task 16 keeps this true under U-2 too: a
 * stale connection retains whatever frame was already showing).
 */
export function RecordingChrome(): JSX.Element | null {
  const state = useRecordingState();
  const session = useRecordingSession();
  const [showSaved, setShowSaved] = useState(false);
  const wasCompleted = useRef(false);

  useEffect(() => {
    if (state === 'completed' && !wasCompleted.current) {
      wasCompleted.current = true;
      setShowSaved(true);
      const timer = setTimeout(() => setShowSaved(false), SAVED_TOAST_MS);
      return () => clearTimeout(timer);
    }
    if (state !== 'completed') wasCompleted.current = false;
    return undefined;
  }, [state]);

  if (state === 'idle') return null;

  // B-12: a failed start must never read as recording — no frame at all here.
  if (state === 'error') {
    return (
      <div className="us-rec-error" data-testid="recording-error">
        {session?.errorMessage ?? 'The recording could not continue. Try again.'}
      </div>
    );
  }

  if (state === 'completed') {
    if (!showSaved) return null;
    return (
      <div className="us-rec-saved" data-testid="recording-saved">
        Saved
      </div>
    );
  }

  const saving = state === 'stopping' || state === 'finalizing';
  const frameClass = [
    'us-recframe',
    state === 'paused' && 'us-recframe--paused',
    saving && 'us-recframe--saving',
  ]
    .filter(Boolean)
    .join(' ');
  const notchClass = [
    'us-recnotch',
    state === 'paused' && 'us-recnotch--paused',
    saving && 'us-recnotch--saving',
  ]
    .filter(Boolean)
    .join(' ');
  const caption = state === 'paused' ? 'PAUSED' : saving ? 'SAVING…' : 'RECORDING';
  const subCaption =
    state === 'stopping' ? 'Closing the recording' : state === 'finalizing' ? 'Finishing the file' : null;

  return (
    <>
      <div className={frameClass} data-testid="recording-frame" />
      <div className={notchClass} data-testid="recording-notch">
        {state === 'recording' && <span className="us-recnotch__dot" aria-hidden="true" />}
        <span>{caption}</span>
        {subCaption && <span className="us-recnotch__sub">{subCaption}</span>}
      </div>
    </>
  );
}
