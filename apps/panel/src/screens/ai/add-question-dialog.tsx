import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useAddQuestion } from '../../ai/use-add-question.js';
import { useOskField } from '../../keyboard/use-keyboard.js';
import '../../ai/ai.css';

const LETTERS = ['A', 'B', 'C', 'D'] as const;

function ChoiceField({
  index, value, correct, removable, onChange, onMarkCorrect, onRemove,
}: {
  readonly index: number;
  readonly value: string;
  readonly correct: boolean;
  readonly removable: boolean;
  onChange(value: string): void;
  onMarkCorrect(): void;
  onRemove(): void;
}) {
  const letter = LETTERS[index]!;
  const binding = useOskField({ value, onChange });

  return (
    <div className="us-addq__choice">
      <button
        type="button"
        className={`us-addq__letter${correct ? ' us-addq__letter--correct' : ''}`}
        aria-pressed={correct}
        aria-label={correct ? `Choice ${letter} is the correct answer` : `Mark choice ${letter} as correct`}
        onClick={onMarkCorrect}
      >
        {correct ? '✓' : letter}
      </button>
      <input
        className="us-addq__input"
        value={value}
        placeholder={`Choice ${letter}`}
        aria-label={`Choice ${letter}`}
        onChange={(event) => onChange(event.target.value)}
        onFocus={binding.onFocus}
        onBlur={binding.onBlur}
        data-osk={binding['data-osk']}
      />
      {removable ? (
        <button type="button" className="us-addq__remove" aria-label={`Remove choice ${letter}`} onClick={onRemove}>
          ✕
        </button>
      ) : null}
    </div>
  );
}

/**
 * S-15: prompt + 2–4 choices, tap-a-letter correct answer (among filled
 * choices), saved questions get the "Yours" chip and survive auto-generation
 * (INV-Q-3). Portals light — `OverlayHost` mounts outside `.us-assistant`'s
 * dark scope even though it opens from S-14 (which itself opened from S-13).
 */
export function AddQuestionDialog({ onClose }: { readonly onClose: () => void }) {
  const add = useAddQuestion(onClose);
  const promptBinding = useOskField({ value: add.prompt, onChange: add.setPrompt });
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => closeRef.current?.focus(), []);

  const trapFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
        className="us-modal__panel us-addq"
        role="dialog"
        aria-modal="true"
        aria-label="Add your own question"
        data-testid="add-question-dialog"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={trapFocus}
      >
        <header className="us-addq__head">
          <h2>Add your own question</h2>
          <button ref={closeRef} type="button" className="us-addq__close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="us-addq__body">
          <label className="us-addq__field">
            <span className="us-addq__label">Question</span>
            <textarea
              className="us-addq__prompt"
              rows={2}
              placeholder="Type your question…"
              aria-label="Question"
              value={add.prompt}
              onChange={(event) => add.setPrompt(event.target.value)}
              onFocus={promptBinding.onFocus}
              onBlur={promptBinding.onBlur}
              data-osk={promptBinding['data-osk']}
            />
          </label>

          <div className="us-addq__field">
            <span className="us-addq__label">
              Choices <em>— tap a letter to mark the correct answer</em>
            </span>
            <div className="us-addq__choices">
              {add.choices.map((choice, i) => (
                <ChoiceField
                  key={i}
                  index={i}
                  value={choice}
                  correct={i === add.correctIndex}
                  removable={add.canRemoveChoice}
                  onChange={(value) => add.setChoice(i, value)}
                  onMarkCorrect={() => add.setCorrectIndex(i)}
                  onRemove={() => add.removeChoice(i)}
                />
              ))}
            </div>
            {add.canAddChoice ? (
              <button type="button" className="us-addq__add" onClick={add.addChoice}>
                + Add choice
              </button>
            ) : null}
          </div>

          {!add.valid ? (
            <p className="us-addq__invalid" data-testid="add-question-invalid-reason">{add.invalidReason}</p>
          ) : null}
          {add.problem !== null ? (
            <p className="us-addq__problem" role="alert" data-testid="add-question-problem">{add.problem}</p>
          ) : null}
        </div>

        <footer className="us-addq__foot">
          <button type="button" className="us-addq__cancel" onClick={onClose} disabled={add.saving}>
            Cancel
          </button>
          <button
            type="button"
            className="us-addq__save"
            onClick={add.save}
            disabled={!add.valid || add.saving}
          >
            {add.saving ? 'Saving…' : 'Save Question'}
          </button>
        </footer>
      </div>
    </div>
  );
}
