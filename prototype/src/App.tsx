import { useState, type ReactNode } from 'react'
import { RecordingProvider, useRecording } from './context/RecordingContext'
import { QuestionProvider } from './context/QuestionContext'
import type { Role, SessionUser } from './types'
import { MOCK_USER } from './mock/session'
import { Header } from './components/Header'
import { LoginPage } from './components/LoginPage'
import { IdleHero } from './components/IdleHero'
import { TimerCard } from './components/TimerCard'
import { ChannelCard } from './components/ChannelCard'
import { QuestionAssistant } from './components/ai/QuestionAssistant'
import { InsightsPanel } from './components/ai/InsightsPanel'
import { SourcesPanel } from './components/sources/SourcesPanel'
import { RoomControlsPanel } from './components/room/RoomControlsPanel'
import { AdminPage } from './components/admin/AdminPage'
import { cn } from './components/ui/cn'
import './styles/app.css'

/**
 * Presentation stage for browser hosting: the app is a 13-inch kiosk panel
 * capped at 1280×800, flex-centered in the viewport on the grey backdrop.
 * On smaller windows it shrinks fluidly (width/height 100% + max constraints,
 * pure CSS — no scrollbars); it never grows past 1280×800.
 */
function Stage({ children }: { children: ReactNode }) {
  return (
    <div className="us-stage">
      <div className="us-panel">{children}</div>
      <p className="us-stage__caption">13-inch in-room touch panel · 1280 × 800</p>
    </div>
  )
}

function AppShell() {
  const { status, stop } = useRecording()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [view, setView] = useState<'dashboard' | 'admin'>('dashboard')
  // Meeting layout accordion and the right-side insight tabs compete for the
  // same vertical space, so only one can be open at a time.
  const [meetingLayoutsOpen, setMeetingLayoutsOpen] = useState(false)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [controlsOpen, setControlsOpen] = useState(false)

  // Simulated auth: any credentials work, the chosen role drives access.
  if (!user) {
    return (
      <LoginPage
        onLogin={(role: Role) =>
          setUser({ role, name: role === 'admin' ? 'System Administrator' : MOCK_USER.name })
        }
      />
    )
  }

  const logout = () => {
    if (status !== 'idle') stop() // don't leave a session running behind the login screen
    setView('dashboard')
    setUser(null)
  }

  if (view === 'admin') {
    return <AdminPage role={user.role} onBack={() => setView('dashboard')} />
  }

  const live = status !== 'idle'
  const paused = status === 'paused'

  return (
    <div className="us-app">
      {/* "On air" frame: red border + notch while recording, amber when paused. */}
      {live && (
        <>
          <div className={cn('us-recframe', paused && 'us-recframe--paused')} aria-hidden="true" />
          <div className={cn('us-recnotch', paused && 'us-recnotch--paused')}>
            <span className="us-recnotch__dot" />
            {paused ? 'PAUSED' : 'RECORDING'}
          </div>
        </>
      )}

      <Header onLogout={logout} />

      <main className="us-main">
        {!live ? (
          <IdleHero name={user.name} />
        ) : (
          <div className="us-session">
            <QuestionAssistant />
            <aside className="us-sidebar">
              <TimerCard />
              <ChannelCard
                channelId="meeting"
                expanded={meetingLayoutsOpen}
                onExpandedChange={setMeetingLayoutsOpen}
              />
              <div
                className={cn('us-insightswrap', meetingLayoutsOpen && 'us-insightswrap--collapsed')}
              >
                <InsightsPanel />
              </div>
            </aside>
          </div>
        )}
      </main>

      <div className="us-bottombars">
        <SourcesPanel open={sourcesOpen} onToggle={() => setSourcesOpen((o) => !o)} />
        <RoomControlsPanel
          open={controlsOpen}
          onToggle={() => setControlsOpen((o) => !o)}
          showAdvanced
          onOpenAdvanced={() => setView('admin')}
        />
      </div>
    </div>
  )
}

export default function App() {
  return (
    <RecordingProvider>
      <QuestionProvider>
        <Stage>
          <AppShell />
        </Stage>
      </QuestionProvider>
    </RecordingProvider>
  )
}
