import { useEffect, useState } from 'react'
import { LogOut } from 'lucide-react'
import { clockParts } from '../utils/format'
import logoDark from '/eduscopeLogoDark.jpeg'

function HeaderClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const { date, time } = clockParts(now)
  return (
    <div className="us-clock" aria-label={`Current time ${time}`}>
      <span className="us-clock__time">{time}</span>
      <span className="us-clock__date">{date}</span>
    </div>
  )
}

/** Dark app bar: brand, centered live clock, Logout. */
export function Header({ onLogout }: { onLogout: () => void }) {
  return (
    <header className="us-header">
      <div className="us-header__brand">
        <img src={logoDark} alt="Eduscope" className="us-header__logo" />
        <span className="us-header__divider" />
       
      </div>

      <HeaderClock />

      <button className="us-logout" type="button" onClick={onLogout}>
        <LogOut size={18} />
        Logout
      </button>
    </header>
  )
}
