import { useState } from 'react'
import {
  ArrowLeft,
  FileText,
  Film,
  HardDrive,
  RefreshCw,
  Settings,
  SlidersVertical,
  Tv,
  Users,
  Wifi,
} from 'lucide-react'
import type { Role } from '../../types'
import { cn } from '../ui/cn'
import { NetworkSettings } from './pages/NetworkSettings'
import { EncoderSettings } from './pages/EncoderSettings'
import { LocalStoragePage } from './pages/LocalStoragePage'
import { FirmwareUpdate } from './pages/FirmwareUpdate'
import { UserManagement } from './pages/UserManagement'
import { SystemLogs } from './pages/SystemLogs'
import { StreamingConfig } from './pages/StreamingConfig'
import { LocalCaptureLayout } from './pages/LocalCaptureLayout'

type CategoryId =
  | 'network'
  | 'encoder'
  | 'storage'
  | 'firmware'
  | 'users'
  | 'logs'
  | 'localcapture'
  | 'streaming'

// Sections a standard lecturer may reach — their own output layouts, nothing
// system-level. Admins see every category.
const USER_CATEGORIES: CategoryId[] = ['localcapture', 'streaming']

const CATEGORIES: { id: CategoryId; label: string; icon: typeof Wifi }[] = [
  { id: 'network', label: 'Network Settings', icon: Wifi },
  { id: 'encoder', label: 'Encoder Settings', icon: SlidersVertical },
  { id: 'storage', label: 'Local Storage', icon: HardDrive },
  { id: 'firmware', label: 'Firmware Update', icon: RefreshCw },
  { id: 'users', label: 'User Management', icon: Users },
  { id: 'logs', label: 'System Logs', icon: FileText },
  { id: 'localcapture', label: 'Local Capture Layout', icon: Film },
  { id: 'streaming', label: 'Streaming Configuration', icon: Tv },
]

const PAGES: Record<CategoryId, () => React.JSX.Element> = {
  network: NetworkSettings,
  encoder: EncoderSettings,
  storage: LocalStoragePage,
  firmware: FirmwareUpdate,
  users: UserManagement,
  logs: SystemLogs,
  localcapture: LocalCaptureLayout,
  streaming: StreamingConfig,
}

/**
 * The "Advanced" view. Admins get the full System Administration; lecturers
 * get a focused view with only their output layouts (Local Capture + Streaming),
 * nothing system-level. Local Capture Layout is available to both roles.
 */
export function AdminPage({ role, onBack }: { role: Role; onBack: () => void }) {
  const isAdmin = role === 'admin'
  const categories = isAdmin ? CATEGORIES : CATEGORIES.filter((c) => USER_CATEGORIES.includes(c.id))
  const [category, setCategory] = useState<CategoryId>(categories[0].id)
  const Page = PAGES[category]

  return (
    <div className="us-adm">
      <header className="us-adm__topbar">
        <span className="us-adm__title">
          <Settings size={20} />
          {isAdmin ? 'System Administration' : 'Advanced'}
        </span>
        <button className="us-adm__back" onClick={onBack}>
          <ArrowLeft size={17} />
          Back to Dashboard
        </button>
      </header>

      <div className="us-adm__layout">
        <nav className="us-adm__sidebar" aria-label="Administration categories">
          <span className="us-adm__navlabel">{isAdmin ? 'Categories' : 'Outputs'}</span>
          {categories.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={cn('us-adm__navitem', id === category && 'us-adm__navitem--active')}
              onClick={() => setCategory(id)}
              aria-current={id === category ? 'page' : undefined}
            >
              <Icon size={17} />
              {label}
            </button>
          ))}
        </nav>

        <main className="us-adm__content">
          <Page />
        </main>
      </div>
    </div>
  )
}
