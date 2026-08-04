import { useChannelStatus, useRecordingState } from '../store/selectors.js';
import './shell.css';

/**
 * SM-Q-4: a persistent, non-dismissible privacy guard. A lecturer who taps
 * Pause may believe everything stopped — this proves otherwise whenever the
 * recording is paused but an outbound channel (meeting/streaming) is still on.
 * `local` is deliberately excluded: it is the device's own file capture, not
 * something visible to another person.
 */
export function StreamingWhilePaused(): JSX.Element | null {
  const recordingState = useRecordingState();
  const meeting = useChannelStatus('meeting');
  const streaming = useChannelStatus('streaming');

  const anyOutboundOn = meeting?.state === 'on' || streaming?.state === 'on';
  if (recordingState !== 'paused' || !anyOutboundOn) return null;

  return (
    <div className="us-streamingpaused" data-testid="streaming-while-paused">
      Still streaming while paused
    </div>
  );
}
