import type { StudentQuizResultPayload } from '@eduscope/shared';
import { cn } from '../../lib/utils.js';

const THEME = {
  correct: { card: 'border-success/30 bg-success-soft', label: 'text-success', icon: '✓' },
  incorrect: { card: 'border-danger/30 bg-danger-soft', label: 'text-danger', icon: '✕' },
  missed: { card: 'border-border bg-surface', label: 'text-muted', icon: '—' },
} as const;

export function ResultVerdict({ result }: { result: StudentQuizResultPayload }) {
  const missed = result.selectedOptionId === null;
  const kind = missed ? 'missed' : result.isCorrect ? 'correct' : 'incorrect';
  const label = missed ? 'No answer received' : result.isCorrect ? 'Correct!' : 'Not quite';
  const theme = THEME[kind];

  return (
    <div className={cn('flex flex-col items-center gap-3 rounded-2xl border px-6 py-8 text-center', theme.card)}>
      <span
        aria-hidden="true"
        className={cn('flex h-14 w-14 items-center justify-center rounded-full bg-surface text-2xl font-bold shadow-sm', theme.label)}
      >
        {theme.icon}
      </span>
      <p className={cn('m-0 text-3xl font-extrabold tracking-tight', theme.label)}>{label}</p>
      {!missed && (
        <p className="m-0 inline-flex items-center rounded-full bg-surface px-3 py-1 text-lg font-bold text-text shadow-sm">
          +{result.pointsAwarded}
        </p>
      )}
    </div>
  );
}
