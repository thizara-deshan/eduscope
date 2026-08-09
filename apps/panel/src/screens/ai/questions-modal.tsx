import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useQuestions } from '../../ai/use-questions.js';
import { QuestionCard } from './question-card.js';
import '../../ai/ai.css';

/**
 * S-14: the 680 px questions review modal — `empty`/`loading`/`populated`
 * bodies, a single-column accordion of `QuestionCard`s (collapsed by
 * default), Regenerate (= `generateNow`), and Add Question (S-15, wired by
 * Task 6).
 */
export function QuestionsModal({ onClose }: { readonly onClose: () => void }) {
  const q = useQuestions();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => closeRef.current?.focus(), []);

  const trapFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="us-modal__scrim" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        className="us-modal__panel us-qmodal"
        role="dialog"
        aria-modal="true"
        aria-label="Questions"
        data-testid="questions-modal"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={trapFocus}
      >
        <header className="us-qmodal__head">
          <h2>Questions</h2>
          <button ref={closeRef} type="button" className="us-qmodal__close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="us-qmodal__body">
          {q.generating ? (
            <p className="us-qmodal__status" data-testid="questions-modal-generating">Generating…</p>
          ) : q.loading ? (
            <div className="us-qmodal__skeleton" data-testid="questions-modal-loading" aria-label="Loading questions" />
          ) : q.questions.length === 0 ? (
            <p className="us-empty" data-testid="questions-modal-empty">No questions right now</p>
          ) : (
            <ul className="us-qmodal__list">
              {q.questions.map((question) => (
                <QuestionCard
                  key={question.id}
                  question={question}
                  pendingId={q.pendingId}
                  pendingKind={q.pendingKind}
                  problem={q.problemByQuestionId[question.id] ?? null}
                  canSend={q.canSend}
                  sendRefusalReason={q.sendRefusalReason}
                  onEdit={q.editQuestion}
                  onDiscard={q.discardQuestion}
                  onSend={q.sendToProjector}
                />
              ))}
            </ul>
          )}
        </div>

        <footer className="us-qmodal__foot">
          {/* Opens S-15 (Task 6). */}
          <button type="button" className="us-qmodal__addbtn">Add Question</button>
          <button
            type="button"
            className="us-qmodal__regenbtn"
            disabled={q.generating}
            onClick={q.regenerate}
          >
            {q.generating ? 'Regenerating…' : 'Regenerate'}
          </button>
        </footer>
      </div>
    </div>
  );
}
