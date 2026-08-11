import type { StudentQuizQuestionPayload } from '@eduscope/shared';
import type { ConnectionState } from '../../components/connection-strip.js';
import { AnswerOption } from './answer-option.js';
import { useSubmitAnswer } from './use-submit-answer.js';

/**
 * One stable region for waiting/answerable/rejected — never remounted per
 * question (no key on publicationId), so there is no per-question route or
 * flash between states.
 */
export function QuestionViewport({
  question,
  connectionState,
}: {
  question: StudentQuizQuestionPayload;
  connectionState: ConnectionState;
}) {
  const isLive = question.state === 'open' || question.state === 'closed';
  const { phase, selectedOptionId, submit } = useSubmitAnswer(
    isLive ? question.publicationId : null,
    isLive ? question.ownAnswerOptionId : null,
  );

  if (question.state === 'none') {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-surface/60 px-6 py-12 text-center">
        <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft text-2xl">
          ⏳
        </span>
        <p className="m-0 text-lg font-semibold text-text">Waiting for your lecturer&rsquo;s next question</p>
        <p className="m-0 text-base text-muted">Keep this tab open — the next question will appear here.</p>
      </div>
    );
  }

  const optionsDisabled =
    phase === 'submitting' || phase === 'locked' || phase === 'rejected-closed' || connectionState !== 'online';

  return (
    <div>
      <p className="mb-5 text-xl font-bold leading-snug tracking-tight text-text">{question.prompt}</p>
      {phase === 'rejected-closed' && (
        <p role="alert" className="mb-4 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-base font-medium text-danger">
          Question closed before your answer arrived.
        </p>
      )}
      {phase === 'retryable' && (
        <p role="alert" className="mb-4 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-base font-medium text-warning">
          That didn&rsquo;t go through. Tap an option to try again.
        </p>
      )}
      <div className="flex flex-col gap-3">
        {question.options.map((option) => (
          <AnswerOption
            key={option.id}
            option={option}
            selected={selectedOptionId === option.id}
            submitting={phase === 'submitting' && selectedOptionId === option.id}
            disabled={optionsDisabled}
            onSelect={submit}
          />
        ))}
      </div>
    </div>
  );
}
