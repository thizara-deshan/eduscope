import { useState } from 'react';
import type { CameraCard } from './use-camera-bindings.js';
import { IpInput } from './ip-input.js';
import { isValidIpv4 } from './ip-validate.js';

interface CameraIpCardProps {
  readonly camera: CameraCard;
  readonly saving: boolean;
  readonly onSave: (inputId: string, address: string) => void;
  readonly disabled: boolean;
}

/** S-28 — CAM 1/CAM 2 address; Save re-probes the role (tile unknown -> online/offline). */
export function CameraIpCard({ camera, saving, onSave, disabled }: CameraIpCardProps): JSX.Element {
  const [address, setAddress] = useState(camera.address);
  const dirty = address !== camera.address;
  const valid = isValidIpv4(address);

  return (
    <section className="us-adm__card us-network__card" aria-label={`${camera.roleId} camera`} data-testid={`camera-${camera.roleId}`}>
      <div className="us-network__cardhead">
        <h2 className="us-device__eyebrow">{camera.roleId}</h2>
        <span className="us-device__value">{camera.status?.state ?? 'unknown'}</span>
      </div>
      <div className="us-device__field">
        <span className="us-device__label">Address</span>
        <IpInput label="Camera address" value={address} onChange={setAddress} disabled={disabled} />
      </div>
      {!valid ? <p className="us-device__missing">Enter a valid IPv4 address.</p> : null}
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
