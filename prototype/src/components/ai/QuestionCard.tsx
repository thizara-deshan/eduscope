import { useState } from 'react'
import { Check, ChevronDown, ListChecks, Pencil, Send, Trash2, X } from 'lucide-react'
import type { MCQQuestion } from '../../types'
import { useQuestions } from '../../context/QuestionContext'
import { cn } from '../ui/cn'

interface QuestionCardProps {
  question: MCQQuestion
  index: number
  defaultOpen?: boolean
}

const letters = ['A', 'B', 'C', 'D', 'E']

export function QuestionCard({ question, index, defaultOpen = false }: QuestionCardProps) {
  const { updateQuestion, discardQuestion, sendToProjector } = useQuestions()
  const [open, setOpen] = useState(defaultOpen)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<MCQQuestion>(question)

  const startEdit = () => {
    setDraft(question)
    setEditing(true)
    setOpen(true)
  }
  const cancelEdit = () => setEditing(false)
  const saveEdit = () => {
    updateQuestion(question.id, {
      prompt: draft.prompt,
      options: draft.options,
      correctIndex: draft.correctIndex,
    })
    setEditing(false)
  }

  const setOption = (i: number, value: string) => {
    setDraft((d) => ({ ...d, options: d.options.map((o, oi) => (oi === i ? value : o)) }))
  }

  return (
    <article className={cn('us-qcard', open && 'us-qcard--open', editing && 'us-qcard--editing')}>
      <button
        type="button"
        className="us-qcard__header"
        onClick={() => !editing && setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="us-qcard__num">{index + 1}</span>
        <span className="us-qcard__prompt">{question.prompt}</span>
        {question.custom && <span className="us-qcard__custom">Yours</span>}
        <span className="us-qcard__chip">
          <ListChecks size={14} />
          {question.options.length}
        </span>
        <ChevronDown size={20} className="us-qcard__chev" />
      </button>

      {open && (
        <div className="us-qcard__body">
          {editing && (
            <textarea
              className="us-qcard__prompt-input"
              value={draft.prompt}
              onChange={(e) => setDraft((d) => ({ ...d, prompt: e.target.value }))}
              rows={2}
            />
          )}

          <ul className="us-qcard__options">
            {(editing ? draft : question).options.map((opt, i) => {
              const isCorrect = (editing ? draft.correctIndex : question.correctIndex) === i
              return (
                <li key={i} className={cn('us-qopt', isCorrect && 'us-qopt--correct')}>
                  <button
                    type="button"
                    className="us-qopt__letter"
                    onClick={() => editing && setDraft((d) => ({ ...d, correctIndex: i }))}
                    disabled={!editing}
                    aria-label={isCorrect ? 'Correct answer' : 'Mark as correct answer'}
                  >
                    {isCorrect ? <Check size={16} /> : letters[i]}
                  </button>
                  {editing ? (
                    <input
                      className="us-qopt__input"
                      value={opt}
                      onChange={(e) => setOption(i, e.target.value)}
                    />
                  ) : (
                    <span className="us-qopt__text">{opt}</span>
                  )}
                </li>
              )
            })}
          </ul>

          <div className="us-qcard__actions">
            {editing ? (
              <>
                <button className="us-textbtn" onClick={cancelEdit}>
                  <X size={18} /> Cancel
                </button>
                <button className="us-textbtn us-textbtn--accent" onClick={saveEdit}>
                  <Check size={18} /> Save changes
                </button>
              </>
            ) : (
              <>
                <button className="us-textbtn" onClick={startEdit}>
                  <Pencil size={17} /> Edit
                </button>
                <button
                  className="us-textbtn us-textbtn--danger"
                  onClick={() => discardQuestion(question.id)}
                >
                  <Trash2 size={17} /> Discard
                </button>
                <button className="us-sendbtn" onClick={() => sendToProjector(question)}>
                  <Send size={18} />
                  <span>Send to Projector</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </article>
  )
}
