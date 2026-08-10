import type { FirmwareUpdate } from '@eduscope/shared';

interface FirmwareLifecycleProps {
  readonly firmware: FirmwareUpdate;
  readonly onCheck: () => void;
  readonly onApply: () => void;
  readonly checking: boolean;
  readonly applying: boolean;
  readonly disabled: boolean;
}

/** S-31 — the ten-state linear lifecycle mapped to its panel; done/failed/signature-failed are loud and distinct. */
export function FirmwareLifecycle({ firmware, onCheck, onApply, checking, applying, disabled }: FirmwareLifecycleProps): JSX.Element {
  const { state, availableVersion, currentVersion, signatureVerified, lastError, rollbackVersion } = firmware;

  return (
    <section className="us-adm__card us-firmware__card" aria-label="Firmware">
      <div className="us-device__field">
        <span className="us-device__label">Current version</span>
        <span className="us-device__value">{currentVersion}</span>
      </div>

      {state === 'idle' && availableVersion === null ? (
        <div className="us-device__field" data-testid="firmware-up-to-date">
          <span className="us-device__value">
            <span className="us-device__dot us-device__dot--on" aria-hidden="true" />
            Up to date
          </span>
          <button type="button" className="us-adm__secondary" disabled={checking || disabled} onClick={onCheck}>
            {checking ? 'Checking…' : 'Check for updates'}
          </button>
        </div>
      ) : null}

      {state === 'idle' && availableVersion !== null ? (
        <div className="us-device__field" data-testid="firmware-update-available">
          <span className="us-device__value">Update available: {availableVersion}</span>
          <button type="button" className="us-adm__primary" disabled={applying || disabled} onClick={onApply}>
            {applying ? 'Applying…' : 'Apply update'}
          </button>
        </div>
      ) : null}

      {state === 'checking' ? (
        <p className="us-adm__note" data-testid="firmware-checking">Checking for updates…</p>
      ) : null}

      {state === 'downloading' ? (
        <p className="us-adm__note" data-testid="firmware-downloading">Downloading {availableVersion}…</p>
      ) : null}

      {state === 'verifying' ? (
        <p className="us-adm__note" data-testid="firmware-verifying">Verifying signature…</p>
      ) : null}

      {state === 'applying' ? (
        <p className="us-adm__note" data-testid="firmware-applying">Applying update…</p>
      ) : null}

      {state === 'done' ? (
        <p className="us-firmware__unmissable" data-testid="firmware-done">
          Update installed. Do not power off — a reboot is required to finish.
        </p>
      ) : null}

      {state === 'failed' && signatureVerified === false ? (
        <p className="us-firmware__unmissable" data-testid="firmware-signature-failed">
          Signature verification failed — this update was not applied. {lastError}
        </p>
      ) : null}

      {state === 'failed' && signatureVerified !== false ? (
        <p className="us-firmware__unmissable" data-testid="firmware-failed">
          Update failed. {lastError}
        </p>
      ) : null}

      {state === 'rolled-back' ? (
        <p className="us-firmware__unmissable" data-testid="firmware-rolled-back">
          Rolled back to {rollbackVersion}. {lastError}
        </p>
      ) : null}
    </section>
  );
}
