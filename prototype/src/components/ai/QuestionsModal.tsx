import { useState } from 'react'
import { Check, Plus, RefreshCw, Send, Sparkles, Trash2 } from 'lucide-react'
import { useQuestions } from '../../context/QuestionContext'
import { Modal } from '../ui/Modal'
import { AddQuestionDialog } from './AddQuestionDialog'
import { cn } from '../ui/cn'

const letters = ['A', 'B', 'C', 'D', 'E']

interface QuestionsModalProps {
  open: boolean
  onClose: () => void
}

/**
 * The generated-questions workspace: regenerate the AI set, pick a question to
 * preview its options, send the selected one to the projector, or hand-write a
 * new one. Questions live only here now (not inline in the AI Studio card).
 */
export function QuestionsModal({ open, onClose }: QuestionsModalProps) {
  const { currentBatch, generateNow, generating, sendToProjector, discardQuestion } = useQuestions()
  const [selectedId, setSelectedId] = useState<string>('')
  const [addOpen, setAddOpen] = useState(false)

  // Keep selection valid as the batch changes (send/discard/regenerate).
  const selected = currentBatch.find((q) => q.id === selectedId) ?? currentBatch[0]

  const send = () => {
    if (selected) sendToProjector(selected)
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Generated Questions"
        subtitle="Pick one and send it to the projector, or add your own"
        footer={
          <>
            <button className="us-textbtn" onClick={() => setAddOpen(true)}>
              <Plus size={18} /> Add Question
            </button>
            <button className="us-qmodal__send" onClick={send} disabled={!selected}>
              <Send size={18} /> Send to Projector
            </button>
          </>
        }
      >
        <div className="us-qmodal">
          <div className="us-qmodal__toolbar">
            <span className="us-qmodal__count">
              {currentBatch.length} {currentBatch.length === 1 ? 'question' : 'questions'} ready
            </span>
            <button className="us-textbtn" onClick={generateNow} disabled={generating}>
              <RefreshCw size={16} className={generating ? 'us-spin' : undefined} />
              {generating ? 'Regenerating…' : 'Regenerate Questions'}
            </button>
          </div>

          {currentBatch.length === 0 ? (
            <div className="us-empty">
              <Sparkles size={40} className="us-empty__icon" />
              <p className="us-empty__title">No questions right now</p>
              <p className="us-empty__hint">Regenerate a set or add your own to get started.</p>
            </div>
          ) : (
            <div className="us-qmodal__list">
              {currentBatch.map((q, i) => {
                const active = selected?.id === q.id
                return (
                  <div key={q.id} className={cn('us-qrow', active && 'us-qrow--active')}>
                    <button
                      type="button"
                      className="us-qrow__head"
                      onClick={() => setSelectedId(q.id)}
                      aria-pressed={active}
                    >
                      <span className={cn('us-qrow__radio', active && 'us-qrow__radio--on')}>
                        {active && <Check size={14} />}
                      </span>
                      <span className="us-qrow__num">{i + 1}</span>
                      <span className="us-qrow__prompt">{q.prompt}</span>
                      {q.custom && <span className="us-qcard__custom">Yours</span>}
                    </button>

                    {active && (
                      <div className="us-qrow__body">
                        <ul className="us-qcard__options">
                          {q.options.map((opt, oi) => {
                            const isCorrect = q.correctIndex === oi
                            return (
                              <li
                                key={oi}
                                className={cn('us-qopt', isCorrect && 'us-qopt--correct')}
                              >
                                <span className="us-qopt__letter">
                                  {isCorrect ? <Check size={16} /> : letters[oi]}
                                </span>
                                <span className="us-qopt__text">{opt}</span>
                              </li>
                            )
                          })}
                        </ul>
                        <button
                          className="us-textbtn us-textbtn--danger us-qrow__discard"
                          onClick={() => discardQuestion(q.id)}
                        >
                          <Trash2 size={17} /> Discard
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </Modal>

      <AddQuestionDialog open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  )
}
