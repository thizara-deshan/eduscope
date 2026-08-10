'use client';

import { useQuizConnectionState } from '../../store/selectors.js';
import { useQuizStore } from '../../store/quiz-store.js';
import { QuizMobileShell } from '../../components/quiz-mobile-shell.js';
import { QuizLiveHeader } from './quiz-live-header.js';
import { QuestionViewport } from './question-viewport.js';
import { ResultScreen } from '../result/result-screen.js';
import { EndedScreen } from '../ended/ended-screen.js';
import './live.css';

const WAITING = { state: 'none' as const };

/**
 * S-39/S-40/S-41 are state branches of ONE route (W7-D-3) — never navigated
 * between. Precedence: a stored `quiz.session-not-found` connect problem or
 * a closed session both supersede everything as S-41; a current result is
 * S-40; otherwise S-39.
 */
export function QuizSessionScreen() {
  const connectionState = useQuizConnectionState();
  const session = useQuizStore((s) => s.session);
  const question = useQuizStore((s) => s.question);
  const result = useQuizStore((s) => s.result);
  const connectProblem = useQuizStore((s) => s.connectProblem);

  if (connectProblem?.code === 'quiz.session-not-found' || session?.state === 'closed') {
    return (
      <EndedScreen
        session={session?.state === 'closed' ? session : null}
        connectProblem={connectProblem}
        connectionState={connectionState}
      />
    );
  }

  if (result !== null) {
    return <ResultScreen result={result} connectionState={connectionState} />;
  }

  return (
    <QuizMobileShell screenId="S-39" connectionState={connectionState}>
      <QuizLiveHeader connectionState={connectionState} />
      <QuestionViewport question={question ?? WAITING} connectionState={connectionState} />
    </QuizMobileShell>
  );
}
