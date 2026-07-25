import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { FIRMWARE_VERSION } from '../../../mock/admin'

export function FirmwareUpdate() {
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState('')

  const check = () => {
    setChecking(true)
    setResult('')
    window.setTimeout(() => {
      setChecking(false)
      setResult('You are up to date — no new firmware available.')
    }, 1200)
  }

  return (
    <section className="us-adm__card">
      <h2 className="us-adm__cardtitle">Firmware &amp; System Update</h2>
      <div className="us-adm__firmware">
        <p className="us-adm__firmversion">
          Current Version: <strong>{FIRMWARE_VERSION}</strong>
        </p>
        <p className="us-adm__firmnote">
          Updates include performance updates, encoder patches and dynamic checks.
        </p>
        <button className="us-adm__primary" onClick={check} disabled={checking}>
          <RefreshCw size={16} className={checking ? 'us-spin' : undefined} />
          {checking ? 'Checking…' : 'Check for Updates'}
        </button>
        {result && <p className="us-adm__firmresult">{result}</p>}
      </div>
    </section>
  )
}
