import { useRef } from 'react';
import { useOverlays } from '../../overlays/overlay-host.js';
import { useQuizSession } from '../../ai/use-quiz-session.js';
import { QuizJoinModal } from './quiz-join-modal.js';
import '../../ai/ai.css';

/**
 * S-20: the chip is the entire steady-state footprint of the quiz join
 * surface (S20-D-1) — it carries all of Machine 4a legibly, issues no
 * command, and is tappable only in `open`/`failed` (S20-D-2). Mounted at the
 * S-13 header's trailing edge.
 */
export function QuizJoinChip() {
  const quiz = useQuizSession();
  const overlays = useOverlays();
  const chipRef = useRef<HTMLButtonElement>(null);

  if (quiz.loading) {
    return (
      <div
        className="us-quizchip us-quizchip--skeleton"
        data-testid="quiz-join-chip"
        data-state="loading"
        aria-hidden="true"
      />
    );
  }

  if (quiz.state === 'absent' || quiz.state === 'closed') return null;

  const openModal = () => {
    const id = overlays.open(
      <QuizJoinModal
        onClose={() => {
          overlays.close(id);
          chipRef.current?.focus();
        }}
      />,
    );
  };

  const tappable = quiz.state === 'open' || quiz.state === 'failed';
  const label = quiz.state === 'requesting'
    ? 'Quiz · starting…'
    : quiz.state === 'failed'
      ? 'Quiz unavailable'
      : `Quiz · ${quiz.joinedCount} joined`;
  const ariaLabel = quiz.state === 'failed'
    ? 'Quiz unavailable. Opens details.'
    : quiz.state === 'requesting'
      ? 'Quiz starting.'
      : `Quiz join. ${quiz.joinedCount} joined. Opens join code and QR.`;

  return (
    <button
      ref={chipRef}
      type="button"
      className={`us-quizchip us-quizchip--${quiz.state}${quiz.syncState === 'stale' ? ' us-quizchip--stale' : ''}`}
      data-testid="quiz-join-chip"
      data-state={quiz.state}
      data-stale={quiz.syncState === 'stale' || undefined}
      aria-haspopup="dialog"
      aria-label={ariaLabel}
      disabled={!tappable}
      onClick={tappable ? openModal : undefined}
    >
      {label}
      {quiz.state === 'open' && quiz.syncState === 'stale' ? (
        <span className="us-quizchip__stale" aria-hidden="true">⚠</span>
      ) : null}
    </button>
  );
}
