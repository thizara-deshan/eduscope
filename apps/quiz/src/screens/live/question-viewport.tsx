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
      <div className="quiz-live__waiting">
        <p>Waiting for your lecturer&rsquo;s next question</p>
        <p className="quiz-live__hint">Keep this tab open — the next question will appear here.</p>
      </div>
    );
  }

  const optionsDisabled =
    phase === 'submitting' || phase === 'locked' || phase === 'rejected-closed' || connectionState !== 'online';

  return (
    <div className="quiz-live__question">
      <p className="quiz-live__prompt">{question.prompt}</p>
      {phase === 'rejected-closed' && (
        <p role="alert" className="quiz-live__rejected">
          Question closed before your answer arrived.
        </p>
      )}
      {phase === 'retryable' && (
        <p role="alert" className="quiz-live__retry">
          That didn&rsquo;t go through. Tap an option to try again.
        </p>
      )}
      <div className="quiz-live__options">
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
