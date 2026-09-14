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
