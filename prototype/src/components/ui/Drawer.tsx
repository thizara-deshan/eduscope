import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from './cn'

interface DrawerProps {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
  width?: number
}

/** Right-side slide-in panel used for the recording Setup. */
export function Drawer({ open, onClose, title, subtitle, children, width = 460 }: DrawerProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <div className={cn('us-drawer-root', open && 'us-drawer-root--open')} aria-hidden={!open}>
      <div className="us-drawer__scrim" onClick={onClose} />
      <aside
        className="us-drawer__panel"
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="us-drawer__head">
          <div>
            <h2 className="us-drawer__title">{title}</h2>
            {subtitle && <p className="us-drawer__subtitle">{subtitle}</p>}
          </div>
          <button className="us-icon-btn" onClick={onClose} aria-label="Close">
            <X size={24} />
          </button>
        </header>
        <div className="us-drawer__body">{children}</div>
      </aside>
    </div>
  )
}
