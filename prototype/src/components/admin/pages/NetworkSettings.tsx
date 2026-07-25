import { NETWORK_DEFAULTS } from '../../../mock/admin'

function IpConfigCard({ title, defaults }: { title: string; defaults: { ip: string; subnet: string; gateway: string; dns: string } }) {
  return (
    <section className="us-adm__card">
      <h2 className="us-adm__cardtitle">{title}</h2>
      <div className="us-adm__grid2">
        <label className="us-adm__field">
          <span>IPv4/IPv6 Address</span>
          <input className="us-input" defaultValue={defaults.ip} />
        </label>
        <label className="us-adm__field">
          <span>Subnet Mask</span>
          <input className="us-input" defaultValue={defaults.subnet} />
        </label>
        <label className="us-adm__field">
          <span>Default Gateway</span>
          <input className="us-input" defaultValue={defaults.gateway} />
        </label>
        <label className="us-adm__field">
          <span>DNS Server</span>
          <input className="us-input" defaultValue={defaults.dns} />
        </label>
      </div>
      <button className="us-adm__primary">Save Network Config</button>
    </section>
  )
}

export function NetworkSettings() {
  return (
    <>
      <IpConfigCard title="Device IP Configuration (LAN)" defaults={NETWORK_DEFAULTS.lan} />
      <IpConfigCard title="Device IP Configuration (vLAN)" defaults={NETWORK_DEFAULTS.vlan} />
      <section className="us-adm__card">
        <h2 className="us-adm__cardtitle">Camera IP Configuration</h2>
        <div className="us-adm__grid2">
          <label className="us-adm__field">
            <span>CAM 1 Address</span>
            <input className="us-input" defaultValue={NETWORK_DEFAULTS.cameras.cam1} />
          </label>
          <label className="us-adm__field">
            <span>CAM 2 Address</span>
            <input className="us-input" defaultValue={NETWORK_DEFAULTS.cameras.cam2} />
          </label>
        </div>
        <button className="us-adm__primary">Save Camera Config</button>
      </section>
    </>
  )
}
