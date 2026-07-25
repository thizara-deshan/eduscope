import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}

/**
 * Centered dialog. Portals into `.us-panel` so it always overlays the whole
 * kiosk panel (and escapes the assistant's dark token scope), while staying
 * anchored to the panel rather than the browser viewport.
 */
export function Modal({ open, onClose, title, subtitle, children, footer }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const host = document.querySelector('.us-panel')
  if (!open || !host) return null

  return createPortal(
    <div className="us-modal-root" role="dialog" aria-modal="true" aria-label={title}>
      <div className="us-modal__scrim" onClick={onClose} />
      <div className="us-modal__panel">
        <header className="us-modal__head">
          <div>
            <h2 className="us-modal__title">{title}</h2>
            {subtitle && <p className="us-modal__subtitle">{subtitle}</p>}
          </div>
          <button className="us-icon-btn" onClick={onClose} aria-label="Close">
            <X size={24} />
          </button>
        </header>
        <div className="us-modal__body">{children}</div>
        {footer && <footer className="us-modal__foot">{footer}</footer>}
      </div>
    </div>,
    host,
  )
}
