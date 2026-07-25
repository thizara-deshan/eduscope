import { STORAGE_INFO } from '../../../mock/admin'

export function LocalStoragePage() {
  return (
    <section className="us-adm__card">
      <h2 className="us-adm__cardtitle">Local Storage Configuration</h2>

      <div className="us-adm__statbar">
        <div className="us-adm__stat">
          <span className="us-adm__statlabel">Total Capacity</span>
          <span className="us-adm__statvalue">{STORAGE_INFO.totalCapacity}</span>
        </div>
        <div className="us-adm__stat">
          <span className="us-adm__statlabel">Available Free Space</span>
          <span className="us-adm__statvalue us-adm__statvalue--good">{STORAGE_INFO.freeSpace}</span>
        </div>
        <div className="us-adm__stat">
          <span className="us-adm__statlabel">Disk Health</span>
          <span className="us-adm__statvalue us-adm__statvalue--good">{STORAGE_INFO.diskHealth}</span>
        </div>
      </div>

      <label className="us-adm__field">
        <span>Assign New Drive</span>
        <div className="us-adm__inline">
          <input className="us-input" placeholder="New Hard Disk ID (e.g. sdb1)" />
          <button className="us-adm__secondary">Mount Drive</button>
        </div>
      </label>

      <div className="us-adm__danger">
        <span className="us-adm__dangertitle">Danger zone</span>
        <p className="us-adm__dangertext">
          Formatting will permanently erase all local lecture recording databases.
        </p>
        <button className="us-adm__dangerbtn">Format Local Storage</button>
      </div>
    </section>
  )
}
