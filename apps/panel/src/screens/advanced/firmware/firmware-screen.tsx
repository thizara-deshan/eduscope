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
      <section className="us-firmware" data-testid="screen" data-screen="S-31" aria-busy="true">
        <header className="us-adm__pagehead">
          <div>
            <h1>Firmware Update</h1>
            <p className="us-adm__pagecopy">Check the installed version and safely apply verified device updates.</p>
          </div>
        </header>
        <div className="us-device__skeleton" data-testid="firmware-skeleton" />
      </section>
    );
  }

  const busy = firmware.state === 'checking' || firmware.state === 'downloading'
    || firmware.state === 'verifying' || firmware.state === 'applying';

  return (
    <div className="us-firmware" data-testid="screen" data-screen="S-31">
      <header className="us-adm__pagehead">
        <div>
          <h1>Firmware Update</h1>
          <p className="us-adm__pagecopy">Check the installed version and safely apply verified device updates.</p>
        </div>
      </header>
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
