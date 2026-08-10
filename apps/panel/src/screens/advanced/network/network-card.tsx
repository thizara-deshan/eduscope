import { useState } from 'react';
import type { NetworkConfig, NetworkConfigUpdate } from '@eduscope/shared';
import { IpInput } from './ip-input.js';
import { isValidIpv4 } from './ip-validate.js';

interface NetworkCardProps {
  readonly config: NetworkConfig;
  readonly applying: boolean;
  readonly onApply: (patch: NetworkConfigUpdate) => void;
  readonly disabled: boolean;
}

/** S-28 — one LAN or vLAN card: dirty marker, Apply, apply-failed readback, self-lockout warning on the LAN address. */
export function NetworkCard({ config, applying, onApply, disabled }: NetworkCardProps): JSX.Element {
  const [ipv4Address, setIpv4Address] = useState(config.ipv4Address ?? '');
  const [gateway, setGateway] = useState(config.gateway ?? '');

  const dirty = ipv4Address !== (config.ipv4Address ?? '') || gateway !== (config.gateway ?? '');
  const addressValid = ipv4Address === '' || isValidIpv4(ipv4Address);
  const gatewayValid = gateway === '' || isValidIpv4(gateway);
  const valid = addressValid && gatewayValid;
  const isLan = config.kind === 'lan';

  const apply = () => {
    if (!valid || disabled) return;
    onApply({ ipv4Address: ipv4Address || null, gateway: gateway || null });
  };

  return (
    <section className="us-adm__card us-network__card" aria-label={`${config.interfaceName} (${config.kind})`}>
      <div className="us-network__cardhead">
        <h2 className="us-device__eyebrow">{config.kind === 'lan' ? 'LAN' : 'vLAN'} — {config.interfaceName}</h2>
        {dirty ? <span className="us-network__dirty">dirty</span> : null}
      </div>
      <div className="us-device__field">
        <span className="us-device__label">Address mode</span>
        <span className="us-device__value">{config.addressMode}</span>
      </div>
      {config.addressMode === 'static' ? (
        <>
          <div className="us-device__field">
            <span className="us-device__label">IPv4 address</span>
            <IpInput label="IPv4 address" value={ipv4Address} onChange={setIpv4Address} disabled={disabled} />
          </div>
          <div className="us-device__field">
            <span className="us-device__label">Gateway</span>
            <IpInput label="Gateway" value={gateway} onChange={setGateway} disabled={disabled} />
          </div>
          {!valid ? <p className="us-device__missing">Enter a valid IPv4 address.</p> : null}
          {isLan && dirty ? (
            <p className="us-network__warning">
              Changing the LAN address can disconnect this panel from the network it is reachable on.
            </p>
          ) : null}
        </>
      ) : null}
      {config.lastApplyError ? <p className="us-device__missing">{config.lastApplyError}</p> : null}
      {config.appliedAt ? (
        <p className="us-adm__note">applied {new Date(config.appliedAt).toLocaleString()}</p>
      ) : null}
      <button
        type="button"
        className="us-adm__primary"
        onClick={apply}
        disabled={!dirty || !valid || applying || disabled}
      >
        {applying ? 'Applying…' : 'Apply'}
      </button>
    </section>
  );
}
