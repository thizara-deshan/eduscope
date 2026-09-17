import { useState } from 'react';
import type { CameraCard } from './use-camera-bindings.js';
import { useOskField } from '../../../keyboard/use-keyboard.js';

interface CameraIpCardProps {
  readonly camera: CameraCard;
  readonly saving: boolean;
  readonly onSave: (inputId: string, address: string) => void;
  readonly disabled: boolean;
}

/** S-28 — CAM 1/CAM 2 address; Save re-probes the role (tile unknown -> online/offline). */
export function CameraIpCard({ camera, saving, onSave, disabled }: CameraIpCardProps): JSX.Element {
  const [address, setAddress] = useState(camera.address);
  const addressInput = useOskField({ value: address, onChange: setAddress });
  const dirty = address !== camera.address;
  const valid = address.trim().length > 0;

  return (
    <section className="us-adm__card us-network__card" aria-label={`${camera.roleId} camera`} data-testid={`camera-${camera.roleId}`}>
      <div className="us-network__cardhead">
        <h2 className="us-device__eyebrow">{camera.roleId}</h2>
        <span className="us-device__value">{camera.status?.state ?? 'unknown'}</span>
      </div>
      <div className="us-device__field">
        <span className="us-device__label">Address</span>
        <input
          type="text"
          inputMode="text"
          className="us-network__camera-address"
          aria-label="Camera address"
          value={address}
          disabled={disabled}
          onChange={(event) => setAddress(event.target.value)}
          {...addressInput}
        />
      </div>
      {!valid ? <p className="us-device__missing">Enter a camera address.</p> : null}
      <button
        type="button"
        className="us-adm__primary"
        disabled={!dirty || !valid || saving || disabled}
        onClick={() => onSave(camera.inputId, address)}
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </section>
  );
}
