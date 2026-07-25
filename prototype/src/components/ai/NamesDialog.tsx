import { Check, X } from 'lucide-react'
import type { Student } from '../../types'
import { Modal } from '../ui/Modal'
import { cn } from '../ui/cn'

export type NamesTone = 'neutral' | 'correct' | 'incorrect'

interface NamesDialogProps {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  tone: NamesTone
  students: Student[]
}

/** Small modal listing the students that fall into a given category. */
export function NamesDialog({ open, onClose, title, subtitle, tone, students }: NamesDialogProps) {
  return (
    <Modal open={open} onClose={onClose} title={title} subtitle={subtitle}>
      {students.length === 0 ? (
        <p className="us-adm__note">No students in this group.</p>
      ) : (
        <ul className="us-nameslist">
          {students.map((s) => (
            <li key={s.id} className={cn('us-namerow', `us-namerow--${tone}`)}>
              <span className="us-avatar us-avatar--sm">{s.initials}</span>
              <span className="us-namerow__name">{s.name}</span>
              {tone === 'correct' && <Check size={17} className="us-namerow__mark" />}
              {tone === 'incorrect' && <X size={17} className="us-namerow__mark" />}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
