import type { StudentQuizSessionPayload } from '@eduscope/shared';

type Participated = Extract<StudentQuizSessionPayload, { participationState: 'participated' }>;

/** Final score/rank/answered count only — own values, no class leaderboard. */
export function FinalOwnSummary({ session }: { session: Participated }) {
  return (
    <dl className="ended-summary">
      <dt>Final score</dt>
      <dd>{session.finalScore}</dd>
      <dt>Final rank</dt>
      <dd>#{session.finalRank}</dd>
      <dt>Questions answered</dt>
      <dd>{session.answeredCount}</dd>
    </dl>
  );
}
