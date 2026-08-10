import type { DeviceProvisioning } from '@eduscope/shared';
import { CopyId } from './copy-id.js';

interface IdentityCardProps {
  readonly provisioning: DeviceProvisioning;
  readonly missing: string[];
}

/** S-36 §2.1/§2.2 — DeviceProvisioning read view; copy-to-clipboard ids; missing required fields flagged inline (C-1, C-6). */
export function IdentityCard({ provisioning, missing }: IdentityCardProps): JSX.Element {
  const isMissing = (label: string) => missing.includes(label);

  return (
    <section className="us-adm__card us-device__card" aria-label="Identity">
      <h2 className="us-device__eyebrow">Identity</h2>
      <div className="us-device__field">
        <span className="us-device__label">Device ID</span>
        <span className="us-device__value us-device__value--mono">
          {provisioning.deviceId}
          <CopyId value={provisioning.deviceId} label="device ID" />
        </span>
      </div>
      <div className="us-device__field">
        <span className="us-device__label">Serial number</span>
        <span className="us-device__value us-device__value--mono">
          {provisioning.serialNumber ?? 'not recorded'}
          {provisioning.serialNumber ? <CopyId value={provisioning.serialNumber} label="serial number" /> : null}
        </span>
      </div>
      <div className="us-device__field">
        <span className="us-device__label">Institute profile</span>
        <span className="us-device__value">{provisioning.instituteProfileId}</span>
      </div>
      <div className="us-device__field">
        <span className="us-device__label">Hall</span>
        {isMissing('Hall code') ? (
          <span className="us-device__missing">— not set (required)</span>
        ) : (
          <span className="us-device__value us-device__value--mono">
            {provisioning.hallCode} · {provisioning.hallDisplayName}
            <CopyId value={provisioning.hallCode} label="hall code" />
          </span>
        )}
      </div>
      <div className="us-device__field">
        <span className="us-device__label">Title pattern</span>
        <span className="us-device__value">{provisioning.titlePattern}</span>
      </div>
      <div className="us-device__field">
        <span className="us-device__label">Expected storage</span>
        {isMissing('Expected storage volume') || !provisioning.expectedStorageVolumeUuid ? (
          <span className="us-device__missing">— not set (required)</span>
        ) : (
          <span className="us-device__value us-device__value--mono">
            {provisioning.expectedStorageVolumeUuid}
            <CopyId value={provisioning.expectedStorageVolumeUuid} label="expected storage volume" />
          </span>
        )}
      </div>
      <div className="us-device__field">
        <span className="us-device__label">Provisioned</span>
        <span className="us-device__value">
          {new Date(provisioning.provisionedAt).toLocaleString()}
          {provisioning.provisionedBy ? ` · by ${provisioning.provisionedBy}` : ''}
        </span>
      </div>
    </section>
  );
}
