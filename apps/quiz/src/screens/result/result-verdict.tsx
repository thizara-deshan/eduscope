import type { StudentQuizResultPayload } from '@eduscope/shared';

export function ResultVerdict({ result }: { result: StudentQuizResultPayload }) {
  const missed = result.selectedOptionId === null;
  const kind = missed ? 'missed' : result.isCorrect ? 'correct' : 'incorrect';
  const label = missed ? 'No answer received' : result.isCorrect ? 'Correct!' : 'Not quite';

  return (
    <div className={`result-verdict result-verdict--${kind}`}>
      <p className="result-verdict__label">{label}</p>
      {!missed && <p className="result-verdict__points">+{result.pointsAwarded}</p>}
    </div>
  );
}
