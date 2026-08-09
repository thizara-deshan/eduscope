import { useState } from 'react';
import type { Question } from '@eduscope/shared';
import { useOskField } from '../../keyboard/use-keyboard.js';
import type { QuestionsPendingKind } from '../../ai/use-questions.js';

export interface QuestionCardProps {
  readonly question: Question;
  readonly pendingId: string | null;
  readonly pendingKind: QuestionsPendingKind | null;
  readonly problem: string | null;
  readonly canSend: boolean;
  readonly sendRefusalReason: string | null;
  onEdit(id: string, patch: { prompt: string; options: { id: string; text: string; isCorrect: boolean }[] }): void;
  onDiscard(id: string): void;
  onSend(id: string): void;
}

/**
 * S-14 one MCQ row: collapsed by default, tap-a-letter correct selection
 * (not a radio column), a "Yours" chip for lecturer-authored rows. Editing
 * is offered on every row — including a `sent`/`closed` one — so the
 * immutable-edit 409 can actually be exercised and shown, not silently
 * hidden behind a disabled Edit button.
 */
export function QuestionCard({
  question, pendingId, pendingKind, problem, canSend, sendRefusalReason, onEdit, onDiscard, onSend,
}: QuestionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState(question.prompt);
  const [draftCorrectId, setDraftCorrectId] = useState(question.correctOptionId);
  const promptBinding = useOskField({ value: draftPrompt, onChange: setDraftPrompt });

  const isPending = pendingId === question.id;
  const isDraft = question.state === 'draft';

  const startEdit = () => {
    setDraftPrompt(question.prompt);
    setDraftCorrectId(question.correctOptionId);
    setEditing(true);
  };

  const saveEdit = () => {
    onEdit(question.id, {
      prompt: draftPrompt,
      options: question.options.map((o) => ({ id: o.id, text: o.text, isCorrect: o.id === draftCorrectId })),
    });
    setEditing(false);
  };

  return (
    <li className="us-qcard" data-testid={`question-card-${question.id}`} data-state={question.state}>
      <button
        type="button"
        className="us-qcard__head"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="us-qcard__prompt">{question.prompt || 'Untitled question'}</span>
        {question.provenance === 'lecturer-authored' ? (
          <span className="us-qcard__custom">Yours</span>
        ) : null}
      </button>

      {expanded ? (
        <div className="us-qcard__body">
          {editing ? (
            <>
              <input
                className="us-qcard__promptinput"
                value={draftPrompt}
                onChange={(event) => setDraftPrompt(event.target.value)}
                onFocus={promptBinding.onFocus}
                onBlur={promptBinding.onBlur}
                data-osk={promptBinding['data-osk']}
                aria-label="Edit prompt"
              />
              <div className="us-qcard__options" role="group" aria-label="Correct answer">
                {question.options.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className="us-qcard__optionbtn"
                    aria-pressed={draftCorrectId === option.id}
                    onClick={() => setDraftCorrectId(option.id)}
                  >
                    {option.label}. {option.text}
                  </button>
                ))}
              </div>
              <div className="us-qcard__editactions">
                <button type="button" onClick={() => setEditing(false)} disabled={isPending}>Cancel</button>
                <button type="button" onClick={saveEdit} disabled={isPending}>
                  {isPending && pendingKind === 'editing' ? 'Saving…' : 'Save'}
                </button>
              </div>
            </>
          ) : (
            <>
              <ul className="us-qcard__optionlist">
                {question.options.map((option) => (
                  <li
                    key={option.id}
                    className={option.id === question.correctOptionId ? 'us-qcard__option--correct' : ''}
                  >
                    {option.label}. {option.text}
                  </li>
                ))}
              </ul>
              <div className="us-qcard__actions">
                <button type="button" onClick={startEdit} disabled={isPending}>Edit</button>
                {isDraft ? (
                  <>
                    <button
                      type="button"
                      onClick={() => onDiscard(question.id)}
                      disabled={isPending}
                    >
                      {isPending && pendingKind === 'discarding' ? 'Discarding…' : 'Discard'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onSend(question.id)}
                      disabled={isPending || !canSend}
                      title={!canSend ? sendRefusalReason ?? undefined : undefined}
                    >
                      {isPending && pendingKind === 'sending' ? 'Sending…' : 'Send to Projector'}
                    </button>
                  </>
                ) : null}
              </div>
              {!canSend && isDraft ? (
                <p className="us-qcard__sendreason">{sendRefusalReason}</p>
              ) : null}
            </>
          )}
          {problem !== null ? (
            <p className="us-qcard__problem" role="alert" data-testid={`question-card-${question.id}-problem`}>
              {problem}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
