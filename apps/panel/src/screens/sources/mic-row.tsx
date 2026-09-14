import { useAudioControl } from '../../audio/use-audio-control.js';
import type { SourceRoleId } from '@eduscope/shared';
import { ToggleSwitch } from '../../controls/toggle-switch.js';
import { LevelMeter } from './level-meter.js';
import './sources.css';

export function MicRow({ roleId, displayName }: { readonly roleId: SourceRoleId; readonly displayName: string }): JSX.Element {
  const audio = useAudioControl(roleId);
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
  const stateId = `us-${roleId}-state`;

  return (
    <section className="us-srcmic" data-testid="mic-row" data-role={roleId} data-state={state} aria-label={`${displayName} controls`}>
      <div className="us-srcmic__identity">
        <span className="us-srcmic__name">{displayName}</span>
        <span className="us-srcmic__state" data-testid="mic-state" id={stateId}>{stateCopy}</span>
        {state === 'apply-failed' && control?.lastError ? (
          <span className="us-srcmic__error">{control.lastError}</span>
        ) : null}
      </div>
      <LevelMeter roleId={roleId} displayName={displayName} active={state !== 'offline'} />
      <div className="us-srcmic__gain" aria-label={`${displayName} gain`}>
        <button
          type="button"
          className="us-stepper"
          aria-label={`Decrease ${displayName} level`}
          disabled={disabled || gain === undefined || gain <= 0}
          onClick={() => audio.setGain(Math.max(0, (gain ?? 0) - 5))}
        >−</button>
        <span className="us-srcmic__pct">{gain === undefined ? '—' : `${gain}%`}</span>
        <button
          type="button"
          className="us-stepper"
          aria-label={`Increase ${displayName} level`}
          disabled={disabled || gain === undefined || gain >= 100}
          onClick={() => audio.setGain(Math.min(100, (gain ?? 0) + 5))}
        >+</button>
      </div>
      <ToggleSwitch
        checked={control ? !control.muted : undefined}
        label={displayName}
        describedBy={stateId}
        disabled={disabled}
        failed={state === 'apply-failed'}
        onChange={(checked) => audio.setMuted(!checked)}
      />
    </section>
  );
}
