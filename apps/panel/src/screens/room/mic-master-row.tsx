import { useAudioControl } from '../../audio/use-audio-control.js';
import { ToggleSwitch } from '../../controls/toggle-switch.js';

const ROLE_ID = 'mic-lecturer' as const;

export function MicMasterRow(): JSX.Element {
  const audio = useAudioControl(ROLE_ID);
  const { control, state, disabledReason } = audio;
  const disabled = control === undefined || state === 'pending' || state === 'offline' || state === 'locked';
  const stateCopy = disabledReason ?? (state === 'live'
    ? 'Live'
    : state === 'muted'
      ? 'Muted'
      : state === 'pending'
        ? 'Applying…'
        : control?.muted
          ? "Still muted — the change didn't apply."
          : "Still live — the mute didn't apply.");

  return (
    <div className="us-micmaster" data-state={state}>
      <div className="us-micmaster__identity">
        <span className="us-micmaster__name">Lecturer Mic</span>
        <span className="us-micmaster__state" data-testid="mic-master-state" id="us-mic-master-state">
          {stateCopy}
        </span>
        {state === 'apply-failed' && control?.lastError ? (
          <span className="us-micmaster__error">{control.lastError}</span>
        ) : null}
      </div>
      <ToggleSwitch
        checked={control ? !control.muted : undefined}
        label="Lecturer Mic"
        describedBy="us-mic-master-state"
        disabled={disabled}
        failed={state === 'apply-failed'}
        onChange={(checked) => audio.setMuted(!checked)}
      />
    </div>
  );
}
