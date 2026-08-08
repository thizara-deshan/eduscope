import { LayoutPresetPicker } from '../../channels/layout-preset-picker.js';
import { useIsStale, useRecordingState } from '../../store/selectors.js';
import { useMeetingChannel } from './use-meeting-channel.js';
import './session.css';

export interface MeetingChannelCardProps {
  readonly expanded: boolean;
  onExpandedChange(open: boolean): void;
}

function stateWord(state: string | undefined, reason: string | null | undefined): string {
  switch (state) {
    case 'on': return 'On';
    case 'starting': return reason ? 'Restarting…' : 'Starting…';
    case 'preflight': return 'Starting…';
    case 'stopping': return 'Turning off…';
    case 'failed': return reason ?? 'Failed to start.';
    case 'off':
    default:
      return 'Off';
  }
}

/**
 * S-08 — the one output channel the lecturer touches live. Toggle plus an
 * inline accordion with the meeting's three camera-only presets. Contract
 * C-4: enable/disable is only valid during an active session, exactly when
 * this card is visible.
 */
export function MeetingChannelCard({ expanded, onExpandedChange }: MeetingChannelCardProps): JSX.Element {
  const meeting = useMeetingChannel();
  const stale = useIsStale();
  const recordingState = useRecordingState();

  if (meeting.loading || !meeting.config) {
    return <section className="us-chcard" data-testid="meeting-channel-skeleton" />;
  }

  const state = meeting.status?.state;
  const reason = meeting.status?.reason ?? null;
  const isOn = state === 'on';
  const isFailed = state === 'failed';
  const isRestarting = state === 'starting' && Boolean(reason);
  const isPending = state === 'preflight' || state === 'starting' || state === 'stopping';
  const open = isOn && expanded;
  const switchDisabled = stale || meeting.togglePending || state === 'stopping';

  const handleToggle = () => {
    if (switchDisabled) return;
    meeting.toggle();
    onExpandedChange(!isOn);
  };

  return (
    <section
      className={`us-chcard${isOn ? ' us-chcard--on' : ''}${open ? ' us-chcard--open' : ''}${isFailed ? ' us-chcard--failed' : ''}`}
      data-testid="meeting-channel-card"
      data-state={state}
    >
      <div className="us-chcard__head">
        <span className={`us-chcard__icon${isOn ? ' us-chcard__icon--on' : ''}`} aria-hidden="true">🎦</span>
        <span className="us-chcard__meta">
          <span className="us-chcard__name">Live Meeting</span>
          <span
            className={`us-chcard__state${isFailed ? ' us-chcard__state--failed' : ''}${isRestarting ? ' us-chcard__state--restarting' : ''}`}
            data-testid="meeting-channel-state-word"
          >
            {isPending && <span className="us-chcard__spinner" aria-hidden="true" />}
            {stateWord(state, reason)}
          </span>
        </span>

        {isOn && (
          <button
            type="button"
            className="us-chcard__layouts"
            onClick={() => onExpandedChange(!expanded)}
            aria-expanded={expanded}
          >
            Layouts
          </button>
        )}

        <button
          type="button"
          role="switch"
          aria-checked={isOn}
          aria-label="Live Meeting"
          disabled={switchDisabled}
          onClick={handleToggle}
          className={`us-toggle${isOn ? ' us-toggle--on' : ''}${isFailed ? ' us-toggle--failed' : ''}`}
        >
          <span className="us-toggle__knob" />
        </button>
      </div>

      {recordingState === 'paused' && isOn && (
        <p className="us-chcard__pausednote" data-testid="meeting-still-on-paused">
          Still on while paused.
        </p>
      )}

      <div className={`us-mlayout${open ? ' us-mlayout--open' : ''}`}>
        <div className="us-mlayout__inner">
          <span className="us-mlayout__label">Meeting View Layout</span>
          <LayoutPresetPicker
            options={meeting.options}
            config={meeting.config}
            phase={meeting.presetPhase}
            problem={meeting.presetProblem}
            pendingPresetId={meeting.pendingPresetId}
            onSelect={meeting.selectPreset}
          />
        </div>
      </div>
    </section>
  );
}
