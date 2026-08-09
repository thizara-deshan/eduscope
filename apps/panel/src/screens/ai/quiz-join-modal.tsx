import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useTicker } from '../../hooks/use-ticker.js';
import { QuizQr } from '../../ai/quiz-qr.js';
import { useQuizSession } from '../../ai/use-quiz-session.js';
import '../../ai/ai.css';

const QR_SIZE = 240;

function formatFreshness(updatedAt: string | null, now: number): string {
  if (updatedAt === null) return 'just now';
  const elapsedSec = Math.max(0, Math.floor((now - Date.parse(updatedAt)) / 1_000));
  if (elapsedSec < 30) return 'just now';
  if (elapsedSec < 60) return `${elapsedSec}s ago`;
  const minutes = Math.floor(elapsedSec / 60);
  return `${minutes} min ago`;
}

/**
 * S-20 §2.3–§2.5: the 680 px join modal. No Retry anywhere — the panel owns
 * no session-mint operation and Machine 4a recovers automatically (C-4,
 * S20-D-2); `failed` renders exactly one interactive control, the close ✕
 * (anti-placebo, §13).
 */
export function QuizJoinModal({ onClose }: { readonly onClose: () => void }) {
  const quiz = useQuizSession();
  const now = useTicker(1_000);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => closeRef.current?.focus(), []);

  const trapFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="us-modal__scrim us-quizmodal__scrim" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        className="us-modal__panel us-quizmodal"
        role="dialog"
        aria-modal="true"
        aria-label="Quiz join"
        data-testid="quiz-join-modal"
        data-state={quiz.state}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={trapFocus}
      >
        <header className="us-quizmodal__head">
          <h2>Quiz join</h2>
          <button
            ref={closeRef}
            type="button"
            className="us-quizmodal__close"
            aria-label="Close"
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <div className="us-quizmodal__body">
          {quiz.state === 'failed' ? (
            <div className="us-quizmodal__failed" role="alert" data-testid="quiz-join-failed">
              <p className="us-quizmodal__failhead">Quiz unavailable — questions can&apos;t be sent.</p>
              <p>
                This device can&apos;t reach the quiz server, so there&apos;s no session for students to
                join, and Send to Projector stays off until it reconnects.
              </p>
              <p className="us-quizmodal__status">Reconnecting automatically…</p>
            </div>
          ) : quiz.state === 'requesting' || quiz.loading ? (
            <p className="us-quizmodal__status" data-testid="quiz-join-starting">Quiz · starting…</p>
          ) : (
            <>
              <p>Students can scan this code, or join at the address below.</p>
              {quiz.joinUrl !== null ? (
                <div className="us-quizmodal__qrframe">
                  <QuizQr value={quiz.joinUrl} size={QR_SIZE} />
                </div>
              ) : null}
              <div className="us-quizmodal__code">
                <span className="us-quizmodal__codelabel">Join code</span>
                <span className="us-quizmodal__codevalue" data-testid="quiz-join-code">{quiz.joinCode}</span>
              </div>
              <p className="us-quizmodal__url" data-testid="quiz-join-url">{quiz.joinUrl}</p>

              <footer className="us-quizmodal__footer">
                <span data-testid="quiz-join-count">
                  <span aria-hidden="true">●</span> {quiz.joinedCount} joined
                  {quiz.syncState === 'stale' ? <span className="us-quizmodal__stalenote"> · may be out of date</span> : null}
                </span>
                <span className="us-quizmodal__freshness" data-testid="quiz-join-freshness">
                  {quiz.syncState === 'stale' ? `last synced ${formatFreshness(quiz.updatedAt, now)}` : `updated ${formatFreshness(quiz.updatedAt, now)}`}
                </span>
              </footer>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
