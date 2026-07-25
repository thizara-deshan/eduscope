import { Check, X } from 'lucide-react'
import type { SentQuestion, Student, StudentResponse } from '../../types'
import { useQuestions } from '../../context/QuestionContext'
import { Modal } from '../ui/Modal'
import { cn } from '../ui/cn'

interface StudentDetailDialogProps {
  student: Student | null
  onClose: () => void
}

/** Per-student breakdown: every question they answered, marked right/wrong. */
export function StudentDetailDialog({ student, onClose }: StudentDetailDialogProps) {
  const { sent, responsesByQuestion } = useQuestions()

  const answered: { q: SentQuestion; r: StudentResponse }[] = []
  if (student) {
    for (const q of sent) {
      const r = responsesByQuestion[q.id]?.find((x) => x.studentId === student.id)
      if (r) answered.push({ q, r })
    }
  }
  const correct = answered.filter((a) => a.r.correct).length

  return (
    <Modal
      open={student !== null}
      onClose={onClose}
      title={student?.name ?? ''}
      subtitle={
        answered.length
          ? `${correct}/${answered.length} correct this session`
          : 'No answers yet'
      }
    >
      {answered.length === 0 ? (
        <p className="us-adm__note">This student hasn’t answered any sent questions yet.</p>
      ) : (
        <ul className="us-sdlist">
          {answered.map(({ q, r }) => (
            <li key={q.id} className={cn('us-sdrow', r.correct ? 'us-sdrow--ok' : 'us-sdrow--no')}>
              <span className="us-sdrow__mark">
                {r.correct ? <Check size={16} /> : <X size={16} />}
              </span>
              <div className="us-sdrow__body">
                <span className="us-sdrow__prompt">{q.prompt}</span>
                <span className="us-sdrow__answer">
                  Answered: <strong>{q.options[r.optionIndex]}</strong>
                  {!r.correct && (
                    <span className="us-sdrow__correct"> · Correct: {q.options[q.correctIndex]}</span>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
