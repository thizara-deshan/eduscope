import { useState } from 'react'
import { Check, Plus, Save, Trash2 } from 'lucide-react'
import { useQuestions } from '../../context/QuestionContext'
import { Modal } from '../ui/Modal'
import { cn } from '../ui/cn'

const MAX_CHOICES = 4
const letters = ['A', 'B', 'C', 'D']

interface AddQuestionDialogProps {
  open: boolean
  onClose: () => void
}

/**
 * Lecturer writes their own MCQ: question text, 2–4 choices, tap a letter to
 * mark the correct answer. Saved questions join the Generated list and flow
 * to the projector exactly like AI ones.
 */
export function AddQuestionDialog({ open, onClose }: AddQuestionDialogProps) {
  const { addQuestion } = useQuestions()
  const [prompt, setPrompt] = useState('')
  const [choices, setChoices] = useState<string[]>(['', ''])
  const [correctIndex, setCorrectIndex] = useState(0)

  const valid = prompt.trim() !== '' && choices.length >= 2 && choices.every((c) => c.trim() !== '')

  const reset = () => {
    setPrompt('')
    setChoices(['', ''])
    setCorrectIndex(0)
  }

  const save = () => {
    if (!valid) return
    addQuestion({
      prompt: prompt.trim(),
      options: choices.map((c) => c.trim()),
      correctIndex,
    })
    reset()
    onClose()
  }

  const setChoice = (i: number, value: string) =>
    setChoices((cs) => cs.map((c, ci) => (ci === i ? value : c)))

  const removeChoice = (i: number) => {
    setChoices((cs) => cs.filter((_, ci) => ci !== i))
    setCorrectIndex((prev) => (i === prev ? 0 : i < prev ? prev - 1 : prev))
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add your own question"
      subtitle="It joins the Generated list and can be sent to the projector like any other"
      footer={
        <>
          <button className="us-textbtn" onClick={onClose}>
            Cancel
          </button>
          <button className="us-addq__save" onClick={save} disabled={!valid}>
            <Save size={17} />
            Save Question
          </button>
        </>
      }
    >
      <div className="us-addq">
        <label className="us-addq__field">
          <span className="us-addq__label">Question</span>
          <textarea
            className="us-input"
            rows={2}
            placeholder="Type your question…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </label>

        <div className="us-addq__field">
          <span className="us-addq__label">
            Choices <em className="us-addq__hint">— tap a letter to mark the correct answer</em>
          </span>
          <div className="us-addq__choices">
            {choices.map((choice, i) => (
              <div key={i} className="us-addq__choice">
                <button
                  type="button"
                  className={cn('us-addq__letter', i === correctIndex && 'us-addq__letter--correct')}
                  onClick={() => setCorrectIndex(i)}
                  aria-label={
                    i === correctIndex ? `Choice ${letters[i]} is the correct answer` : `Mark choice ${letters[i]} as correct`
                  }
                >
                  {i === correctIndex ? <Check size={17} /> : letters[i]}
                </button>
                <input
                  className="us-input"
                  placeholder={`Choice ${letters[i]}`}
                  value={choice}
                  onChange={(e) => setChoice(i, e.target.value)}
                />
                {choices.length > 2 && (
                  <button
                    type="button"
                    className="us-icon-btn"
                    onClick={() => removeChoice(i)}
                    aria-label={`Remove choice ${letters[i]}`}
                  >
                    <Trash2 size={18} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {choices.length < MAX_CHOICES && (
            <button type="button" className="us-addq__add" onClick={() => setChoices((cs) => [...cs, ''])}>
              <Plus size={17} />
              Add choice
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
