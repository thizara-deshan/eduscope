import { useState } from 'react'
import { GraduationCap, LogIn, ShieldCheck } from 'lucide-react'
import type { Role } from '../types'
import { cn } from './ui/cn'
import logoDark from '/eduscopeLogoDark.jpeg'

interface LoginPageProps {
  onLogin: (role: Role) => void
}

/**
 * Simulated sign-in: the credentials are decorative (any value works),
 * only the chosen role matters — admins get System Administration access.
 */
export function LoginPage({ onLogin }: LoginPageProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('lecturer')

  return (
    <div className="us-login">
      <form
        className="us-login__card"
        onSubmit={(e) => {
          e.preventDefault()
          onLogin(role)
        }}
      >
        <div className="us-login__band">
          <img src={logoDark} alt="Eduscope" className="us-login__logo" />
        </div>

        <div className="us-login__body">
          <h1 className="us-login__title">Welcome back</h1>
          <p className="us-login__sub">Sign in to your recording panel</p>

          <label className="us-login__field">
            <span>Username</span>
            <input
              className="us-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              autoComplete="username"
            />
          </label>

          <label className="us-login__field">
            <span>Password</span>
            <input
              className="us-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              autoComplete="current-password"
            />
          </label>

          <span className="us-login__rolelabel">Log in as</span>
          <div className="us-login__roles">
            <button
              type="button"
              aria-pressed={role === 'lecturer'}
              className={cn('us-login__role', role === 'lecturer' && 'us-login__role--active')}
              onClick={() => setRole('lecturer')}
            >
              <GraduationCap size={20} />
              Lecturer
            </button>
            <button
              type="button"
              aria-pressed={role === 'admin'}
              className={cn('us-login__role', role === 'admin' && 'us-login__role--active')}
              onClick={() => setRole('admin')}
            >
              <ShieldCheck size={20} />
              Administrator
            </button>
          </div>

          <button type="submit" className="us-login__submit">
            <LogIn size={18} />
            Log In
          </button>
        </div>
      </form>
    </div>
  )
}
