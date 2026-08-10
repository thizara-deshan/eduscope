import { useEffect, useState } from 'react';
import type { EncodingProfileUpdate } from '@eduscope/shared';
import { BitrateStepper } from './bitrate-stepper.js';
import { CapabilitySelect } from './capability-select.js';
import { useEncoderSettings } from './use-encoder-settings.js';
import { useIsStale } from '../../../store/selectors.js';
import './encoder.css';

/** S-29 — capability-gated options only (B-56); save-rejected (422); persistent applies-next-session notice. */
export function EncoderScreen(): JSX.Element {
  const { profile, capabilities, loading, save, saving, rejectedField } = useEncoderSettings();
  const stale = useIsStale();

  const [videoBitrateKbps, setVideoBitrateKbps] = useState<number | null>(null);
  const [framerate, setFramerate] = useState<number | null>(null);
  const [gop, setGop] = useState<number | null>(null);
  const [rateControl, setRateControl] = useState<'cbr' | 'vbr' | null>(null);
  const [audioBitrateKbps, setAudioBitrateKbps] = useState<number | null>(null);

  useEffect(() => {
    if (!profile) return;
    setVideoBitrateKbps((v) => v ?? profile.videoBitrateKbps);
    setFramerate((v) => v ?? profile.framerate);
    setGop((v) => v ?? profile.gop);
    setRateControl((v) => v ?? profile.rateControl);
    setAudioBitrateKbps((v) => v ?? profile.audioBitrateKbps);
  }, [profile]);

  if (loading || !profile || !capabilities) {
    return (
      <section className="us-adm__card" data-testid="screen" data-screen="S-29" aria-busy="true">
        <h1>Encoder Settings</h1>
        <div className="us-device__skeleton" data-testid="encoder-skeleton" />
      </section>
    );
  }

  const dirty = videoBitrateKbps !== profile.videoBitrateKbps
    || framerate !== profile.framerate
    || gop !== profile.gop
    || rateControl !== profile.rateControl
    || audioBitrateKbps !== profile.audioBitrateKbps;

  const handleSave = () => {
    const patch: EncodingProfileUpdate = {};
    if (videoBitrateKbps !== null && videoBitrateKbps !== profile.videoBitrateKbps) patch.videoBitrateKbps = videoBitrateKbps;
    if (framerate !== null && framerate !== profile.framerate) patch.framerate = framerate;
    if (gop !== null && gop !== profile.gop) patch.gop = gop;
    if (rateControl !== null && rateControl !== profile.rateControl) patch.rateControl = rateControl;
    if (audioBitrateKbps !== null && audioBitrateKbps !== profile.audioBitrateKbps) patch.audioBitrateKbps = audioBitrateKbps;
    save(patch);
  };

  return (
    <div className="us-encoder" data-testid="screen" data-screen="S-29">
      <h1>Encoder Settings</h1>
      <section className="us-adm__card us-encoder__card" aria-label="Encoder">
        <div className="us-device__field">
          <span className="us-device__label">Codec</span>
          <span className="us-device__value">{profile.codec}</span>
        </div>
        <div className="us-device__field">
          <span className="us-device__label">Container</span>
          <span className="us-device__value">{profile.container}</span>
        </div>
        <BitrateStepper
          value={videoBitrateKbps ?? profile.videoBitrateKbps}
          min={capabilities.videoBitrateKbps.min}
          max={capabilities.videoBitrateKbps.max}
          onChange={setVideoBitrateKbps}
          disabled={stale}
          invalid={rejectedField === 'videoBitrateKbps'}
        />
        {rejectedField === 'videoBitrateKbps' ? (
          <p className="us-device__missing">Bitrate is outside the encoder's capabilities.</p>
        ) : null}
        <CapabilitySelect
          label="Framerate"
          value={framerate ?? profile.framerate}
          options={capabilities.framerates}
          onChange={(v) => setFramerate(Number(v))}
          disabled={stale}
        />
        <CapabilitySelect
          label="GOP"
          value={gop ?? profile.gop}
          options={capabilities.gops}
          onChange={(v) => setGop(Number(v))}
          disabled={stale}
        />
        <CapabilitySelect
          label="Rate control"
          value={rateControl ?? profile.rateControl}
          options={capabilities.rateControls}
          onChange={(v) => setRateControl(v as 'cbr' | 'vbr')}
          disabled={stale}
        />
        <CapabilitySelect
          label="Audio bitrate"
          value={audioBitrateKbps ?? profile.audioBitrateKbps}
          options={capabilities.audioBitratesKbps}
          onChange={(v) => setAudioBitrateKbps(Number(v))}
          disabled={stale}
        />
        {dirty ? (
          <p className="us-adm__note">An encoder change never applies mid-lecture — it takes effect next session.</p>
        ) : null}
        <button
          type="button"
          className="us-adm__primary"
          disabled={!dirty || saving || stale}
          onClick={handleSave}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </section>
    </div>
  );
}
