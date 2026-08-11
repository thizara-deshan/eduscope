import type { StudentQuizSessionPayload } from '@eduscope/shared';

type Participated = Extract<StudentQuizSessionPayload, { participationState: 'participated' }>;

/** Final score/rank/answered count only — own values, no class leaderboard. */
export function FinalOwnSummary({ session }: { session: Participated }) {
  return (
    <dl className="m-0 mt-6 grid grid-cols-3 gap-3">
      <div className="flex flex-col gap-1 rounded-2xl border border-border bg-surface p-4 shadow-sm">
        <dt className="text-xs font-medium uppercase tracking-wide text-muted">Final score</dt>
        <dd className="m-0 text-2xl font-extrabold tracking-tight text-text">{session.finalScore}</dd>
      </div>
      <div className="flex flex-col gap-1 rounded-2xl border border-border bg-surface p-4 shadow-sm">
        <dt className="text-xs font-medium uppercase tracking-wide text-muted">Final rank</dt>
        <dd className="m-0 text-2xl font-extrabold tracking-tight text-primary">#{session.finalRank}</dd>
      </div>
      <div className="flex flex-col gap-1 rounded-2xl border border-border bg-surface p-4 shadow-sm">
        <dt className="text-xs font-medium uppercase tracking-wide text-muted">Answered</dt>
        <dd className="m-0 text-2xl font-extrabold tracking-tight text-text">{session.answeredCount}</dd>
      </div>
    </dl>
  );
}
