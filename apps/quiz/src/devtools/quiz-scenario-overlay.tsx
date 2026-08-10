import { useCallback, useRef, useState } from 'react';
import { listScenarios, type StudentQuizTransitionId } from '@eduscope/api-client';
import { useQuizScenarioControls } from '../client/quiz-client-provider.js';
import './quiz-scenario-overlay.css';

const LONG_PRESS_MS = 2_000;

const TRANSITIONS: ReadonlyArray<{ id: StudentQuizTransitionId; label: string }> = [
  { id: 'student.connection.offline', label: 'Go offline' },
  { id: 'student.connection.restore', label: 'Restore connection' },
  { id: 'student.question.none', label: 'Question: none' },
  { id: 'student.question.open-2', label: 'Question: open (2 options)' },
  { id: 'student.question.open-3', label: 'Question: open (3 options)' },
  { id: 'student.question.open-4', label: 'Question: open (4 options)' },
  { id: 'student.question.close-missed', label: 'Question: close (missed)' },
  { id: 'student.result.correct-current', label: 'Result: correct, rank current' },
  { id: 'student.result.incorrect-pending', label: 'Result: incorrect, rank pending' },
  { id: 'student.result.rank-current', label: 'Result: rank now current' },
  { id: 'student.session.prepare-close-participated', label: 'Session: prepare close (participated)' },
  { id: 'student.session.close-participated', label: 'Session: close (participated)' },
  { id: 'student.session.close-none', label: 'Session: close (never answered)' },
];

/** Pointer-only; no hover, no keyboard shortcut — this is a touch device. */
function useLongPress(ms: number, onTrigger: () => void) {
  const timer = useRef<number | null>(null);

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const start = useCallback(() => {
    cancel();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      onTrigger();
    }, ms);
  }, [cancel, ms, onTrigger]);

  return {
    onPointerDown: start,
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
  };
}

/**
 * The quiz scenario dev overlay (frontend-conventions §4). Reachable only by
 * a 2s long-press on an invisible corner target — a visible debug button on
 * a student's phone is a support call waiting to happen. Lists only catalog
 * entries with a `studentQuiz` field; the forced-transition buttons are
 * dev-only mock controls (W7-D-4), never a contract event.
 */
export function QuizScenarioOverlay() {
  const { scenario, switchScenario, forceStudentTransition } = useQuizScenarioControls();
  const [open, setOpen] = useState(false);
  const longPress = useLongPress(LONG_PRESS_MS, () => setOpen(true));

  const scripts = listScenarios().filter((script) => script.studentQuiz);

  return (
    <>
      <button
        type="button"
        data-testid="quiz-scenario-hotspot"
        className="quiz-devhotspot"
        aria-label="Developer scenarios (press and hold)"
        {...longPress}
      />
      {open && (
        <div className="quiz-devoverlay" role="dialog" aria-label="Scenario switcher">
          <header className="quiz-devoverlay__head">
            <h2>Scenario</h2>
            <span data-testid="quiz-active-scenario">{scenario}</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close scenarios">
              Close
            </button>
          </header>
          <ul className="quiz-devoverlay__list">
            {scripts.map((script) => (
              <li key={script.name}>
                <label className="quiz-devoverlay__option">
                  <input
                    type="radio"
                    name="quiz-scenario"
                    value={script.name}
                    checked={scenario === script.name}
                    onChange={() => switchScenario(script.name)}
                    aria-label={script.name}
                  />
                  <span className="quiz-devoverlay__name">{script.name}</span>
                  <span className="quiz-devoverlay__desc">{script.description}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="quiz-devoverlay__transitions">
            {TRANSITIONS.map(({ id, label }) => (
              <button key={id} type="button" data-testid={`quiz-force-${id}`} onClick={() => forceStudentTransition(id)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
