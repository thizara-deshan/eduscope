import { useState } from 'react'
import { CheckCircle2, Sparkles } from 'lucide-react'
import { useQuestions } from '../../context/QuestionContext'
import { GenerateControls } from './CountdownToNext'
import { QuestionsModal } from './QuestionsModal'

/**
 * Eduscope AI Studio — the slim left panel that only drives generation.
 * The actual questions live in the modal (opened via Generate or Review);
 * a green "ready" banner appears whenever a drafted set is waiting.
 */
export function QuestionAssistant() {
  const { currentBatch, generateNow } = useQuestions()
  const [modalOpen, setModalOpen] = useState(false)
  const ready = currentBatch.length

  return (
    <section className="us-assistant us-studio">
      <header className="us-assistant__head">
        <div className="us-assistant__titlewrap">
          <span className="us-assistant__badge">
            <Sparkles size={18} />
          </span>
          <div>
            <h1 className="us-assistant__title">Eduscope AI Studio</h1>
            <p className="us-assistant__sub">Turn your lecture into instant classroom questions</p>
          </div>
        </div>
      </header>

      <div className="us-studio__body">
        <GenerateControls
          onGenerateNow={() => {
            generateNow()
            setModalOpen(true)
          }}
        />

        {ready > 0 && (
          <div className="us-readybanner">
            <span className="us-readybanner__icon">
              <CheckCircle2 size={22} />
            </span>
            <div className="us-readybanner__text">
              <span className="us-readybanner__title">A new set is ready</span>
              <span className="us-readybanner__sub">
                {ready} {ready === 1 ? 'question' : 'questions'} drafted from your lecture
              </span>
            </div>
            <button className="us-readybanner__btn" onClick={() => setModalOpen(true)}>
              Review Questions
            </button>
          </div>
        )}
      </div>

      <QuestionsModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </section>
  )
}
