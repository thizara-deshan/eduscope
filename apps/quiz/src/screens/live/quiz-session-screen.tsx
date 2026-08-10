'use client';

import { QuizMobileShell } from '../../components/quiz-mobile-shell.js';
import { useQuizConnectionState } from '../../store/selectors.js';
import { useQuizStore } from '../../store/quiz-store.js';
import { QuizLiveHeader } from './quiz-live-header.js';
import { QuestionViewport } from './question-viewport.js';
import './live.css';

const WAITING = { state: 'none' as const };

/**
 * S-39/S-40/S-41 are state branches of ONE route (W7-D-3) — never navigated
 * between. Precedence: a stored `quiz.session-not-found` connect problem or
 * a closed session both supersede everything as S-41; a current result is
 * S-40; otherwise S-39. Task 7 replaces the S-40/S-41 placeholders below
 * with the real `ResultScreen`/`EndedScreen`, without touching this file's
 * precedence logic.
 */
export function QuizSessionScreen() {
  const connectionState = useQuizConnectionState();
  const session = useQuizStore((s) => s.session);
  const question = useQuizStore((s) => s.question);
  const result = useQuizStore((s) => s.result);
  const connectProblem = useQuizStore((s) => s.connectProblem);

  if (connectProblem?.code === 'quiz.session-not-found') {
    return (
      <QuizMobileShell screenId="S-41" connectionState={connectionState}>
        <h1>This quiz link is no longer valid</h1>
      </QuizMobileShell>
    );
  }

  if (session?.state === 'closed') {
    return (
      <QuizMobileShell screenId="S-41" connectionState={connectionState}>
        <h1>Quiz ended</h1>
      </QuizMobileShell>
    );
  }

  if (result !== null) {
    return (
      <QuizMobileShell screenId="S-40" connectionState={connectionState}>
        <h1>Result</h1>
      </QuizMobileShell>
    );
  }

  return (
    <QuizMobileShell screenId="S-39" connectionState={connectionState}>
      <QuizLiveHeader connectionState={connectionState} />
      <QuestionViewport question={question ?? WAITING} connectionState={connectionState} />
    </QuizMobileShell>
  );
}
