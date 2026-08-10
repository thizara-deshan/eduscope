import { FirmwareLifecycle } from './firmware-lifecycle.js';
import { useFirmware } from './use-firmware.js';
import { useIsStale } from '../../../store/selectors.js';
import './firmware.css';

/** S-31 — firmware check/apply lifecycle; refused-while-recording (409). */
export function FirmwareScreen(): JSX.Element {
  const { firmware, loading, check, apply, refusedWhileRecording } = useFirmware();
  const stale = useIsStale();

  if (loading || !firmware) {
    return (
      <section className="us-adm__card" data-testid="screen" data-screen="S-31" aria-busy="true">
        <h1>Firmware Update</h1>
        <div className="us-device__skeleton" data-testid="firmware-skeleton" />
      </section>
    );
  }

  const busy = firmware.state === 'checking' || firmware.state === 'downloading'
    || firmware.state === 'verifying' || firmware.state === 'applying';

  return (
    <div className="us-firmware" data-testid="screen" data-screen="S-31">
      <h1>Firmware Update</h1>
      <FirmwareLifecycle
        firmware={firmware}
        onCheck={check}
        onApply={apply}
        checking={firmware.state === 'checking'}
        applying={busy}
        disabled={stale}
      />
      {refusedWhileRecording ? (
        <p className="us-device__missing" data-testid="firmware-refused">{refusedWhileRecording}</p>
      ) : null}
    </div>
  );
}
