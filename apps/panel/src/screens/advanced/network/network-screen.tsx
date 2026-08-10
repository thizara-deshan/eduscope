import { NetworkCard } from './network-card.js';
import { CameraIpCard } from './camera-ip-card.js';
import { useNetworkConfig } from './use-network-config.js';
import { useCameraBindings } from './use-camera-bindings.js';
import { useIsStale } from '../../../store/selectors.js';
import './network.css';

/** S-28 — LAN + vLAN + camera-IP cards; 202 + row-readback apply; no Wi-Fi field (structural). */
export function NetworkScreen(): JSX.Element {
  const { configs, loading, apply, applyingId } = useNetworkConfig();
  const { cameras, loading: camerasLoading, saveAddress, savingId } = useCameraBindings();
  const stale = useIsStale();

  if (loading || camerasLoading) {
    return (
      <section className="us-adm__card" data-testid="screen" data-screen="S-28" aria-busy="true">
        <h1>Network Settings</h1>
        <div className="us-device__skeleton" data-testid="network-skeleton" />
      </section>
    );
  }

  return (
    <div className="us-network" data-testid="screen" data-screen="S-28">
      <h1>Network Settings</h1>
      {(configs ?? []).map((config) => (
        <NetworkCard
          key={config.id}
          config={config}
          applying={applyingId === config.id}
          onApply={(patch) => apply(config.id, patch)}
          disabled={stale}
        />
      ))}
      {cameras.map((camera) => (
        <CameraIpCard
          key={camera.roleId}
          camera={camera}
          saving={savingId === camera.inputId}
          onSave={saveAddress}
          disabled={stale}
        />
      ))}
    </div>
  );
}
