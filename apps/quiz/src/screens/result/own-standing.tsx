import type { StudentQuizResultPayload } from '@eduscope/shared';

/** Own values only — no class list, no other-student identity. */
export function OwnStanding({ result }: { result: StudentQuizResultPayload }) {
  return (
    <dl className="m-0 grid grid-cols-2 gap-3">
      <div className="flex flex-col gap-1 rounded-2xl border border-border bg-surface p-4 shadow-sm">
        <dt className="text-sm font-medium uppercase tracking-wide text-muted">Score</dt>
        <dd className="m-0 text-3xl font-extrabold tracking-tight text-text">{result.runningScore}</dd>
      </div>
      <div className="flex flex-col gap-1 rounded-2xl border border-border bg-surface p-4 shadow-sm">
        <dt className="text-sm font-medium uppercase tracking-wide text-muted">Your rank</dt>
        <dd className="m-0 text-3xl font-extrabold tracking-tight text-primary">
          {result.rankState === 'pending' ? 'Updating…' : `#${result.ownRank}`}
        </dd>
      </div>
    </dl>
  );
}
