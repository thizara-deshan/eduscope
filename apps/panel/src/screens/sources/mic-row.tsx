import { useAudioControl } from '../../audio/use-audio-control.js';
import { ToggleSwitch } from '../../controls/toggle-switch.js';
import { LevelMeter } from './level-meter.js';
import './sources.css';

const ROLE_ID = 'mic-lecturer' as const;

export function MicRow(): JSX.Element {
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
  const gain = control?.gain;

  return (
    <section className="us-srcmic" data-testid="mic-row" data-state={state} aria-label="Lecturer microphone controls">
      <div className="us-srcmic__identity">
        <span className="us-srcmic__name">Lecturer Mic</span>
        <span className="us-srcmic__state" data-testid="mic-state" id="us-mic-state">{stateCopy}</span>
        {state === 'apply-failed' && control?.lastError ? (
          <span className="us-srcmic__error">{control.lastError}</span>
        ) : null}
      </div>
      <LevelMeter roleId={ROLE_ID} />
      <div className="us-srcmic__gain" aria-label="Lecturer Mic gain">
        <button
          type="button"
          className="us-stepper"
          aria-label="Decrease Lecturer Mic level"
          disabled={disabled || gain === undefined || gain <= 0}
          onClick={() => audio.setGain(Math.max(0, (gain ?? 0) - 5))}
        >−</button>
        <span className="us-srcmic__pct">{gain === undefined ? '—' : `${gain}%`}</span>
        <button
          type="button"
          className="us-stepper"
          aria-label="Increase Lecturer Mic level"
          disabled={disabled || gain === undefined || gain >= 100}
          onClick={() => audio.setGain(Math.min(100, (gain ?? 0) + 5))}
        >+</button>
      </div>
      <ToggleSwitch
        checked={control ? !control.muted : undefined}
        label="Lecturer Mic"
        describedBy="us-mic-state"
        disabled={disabled}
        failed={state === 'apply-failed'}
        onChange={(checked) => audio.setMuted(!checked)}
      />
    </section>
  );
}
