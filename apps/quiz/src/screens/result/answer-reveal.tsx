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
    <dl className="result-reveal">
      {!missed && (
        <>
          <dt>Your answer</dt>
          <dd>{ownText}</dd>
        </>
      )}
      <dt>Correct answer</dt>
      <dd>{correctText}</dd>
    </dl>
  );
}
