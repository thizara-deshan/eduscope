import type { StudentQuizResultPayload } from '@eduscope/shared';

/** Own values only — no class list, no other-student identity. */
export function OwnStanding({ result }: { result: StudentQuizResultPayload }) {
  return (
    <dl className="result-standing">
      <dt>Score</dt>
      <dd>{result.runningScore}</dd>
      <dt>Your rank</dt>
      <dd>{result.rankState === 'pending' ? 'Updating…' : `#${result.ownRank}`}</dd>
    </dl>
  );
}
