import type { StudentQuizOption, StudentQuizResultPayload } from '@eduscope/shared';

function optionText(options: readonly StudentQuizOption[], id: string | null): string | undefined {
  return id === null ? undefined : options.find((o) => o.id === id)?.text;
}

/** Cold-renders from the self-contained `quiz.result` payload only — never S-39's question memory. */
export function AnswerReveal({ result }: { result: StudentQuizResultPayload }) {
  const missed = result.selectedOptionId === null;
  const ownText = optionText(result.question.options, result.selectedOptionId);
  const correctText = optionText(result.question.options, result.correctOptionId);

  return (
    <dl className="m-0 flex flex-col gap-2.5 rounded-2xl border border-border bg-surface p-5 shadow-sm">
      {!missed && (
        <div className="flex items-center justify-between gap-4">
          <dt className="text-base text-muted">Your answer</dt>
          <dd className="m-0 text-right text-base font-semibold text-text">{ownText}</dd>
        </div>
      )}
      <div className="flex items-center justify-between gap-4">
        <dt className="text-base text-muted">Correct answer</dt>
        <dd className="m-0 flex items-center gap-1.5 text-right text-base font-semibold text-success">
          <span aria-hidden="true">✓</span>
          {correctText}
        </dd>
      </div>
    </dl>
  );
}
