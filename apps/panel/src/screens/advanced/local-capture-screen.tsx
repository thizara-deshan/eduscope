import { LayoutPresetPicker } from '../../channels/layout-preset-picker.js';
import { LayoutPreview } from '../../channels/layout-preview.js';
import { useLocalCaptureLayout } from './use-local-capture-layout.js';
import './advanced.css';

const LOCAL_CAPTURE_RECONNECTING_NOTE = "Reconnecting — you can't change this right now.";

/**
 * S-26 — the always-on `local` channel's layout preset. There is no switch,
 * toggle callback, or disabled-looking always-on switch: `local.alwaysOn`
 * cannot be disabled (INV-CC-1), and nothing on this page may imply
 * otherwise.
 */
export function LocalCaptureScreen(): JSX.Element {
  const local = useLocalCaptureLayout();

  if (local.loading || !local.config) {
    return (
      <section className="us-adm__card" data-testid="screen" data-screen="S-26">
        <div data-testid="local-capture-skeleton" />
      </section>
    );
  }

  return (
    <section className="us-adm__card" data-testid="screen" data-screen="S-26">
      <div className="us-adm__streamhead">
        <div>
          <h2 className="us-adm__cardtitle">Local Capture Layout</h2>
          <p className="us-adm__note">
            Recorded to this device every session. Always on — choose how it&rsquo;s laid out.
          </p>
        </div>
        <span className="us-adm__alwayson">Always on</span>
      </div>

      <div className="us-adm__streamlayout">
        <div className="us-adm__streampreview">
          <span className="us-adm__field">
            <span>Layout preview{local.selectedPreset ? ` · ${local.selectedPreset.displayName}` : ''}</span>
          </span>
          {local.selectedPreset && <LayoutPreview preset={local.selectedPreset} large />}
        </div>
        <LayoutPresetPicker
          options={local.options}
          config={local.config}
          phase={local.phase}
          problem={local.problem}
          pendingPresetId={local.pendingPresetId}
          onSelect={local.select}
        />
      </div>
      {local.stale && (
        <p className="us-presetgrid__status" role="status">{LOCAL_CAPTURE_RECONNECTING_NOTE}</p>
      )}
    </section>
  );
}
