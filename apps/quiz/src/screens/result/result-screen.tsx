import type { StudentQuizResultPayload } from '@eduscope/shared';
import { QuizMobileShell } from '../../components/quiz-mobile-shell.js';
import type { ConnectionState } from '../../components/connection-strip.js';
import { ResultVerdict } from './result-verdict.js';
import { AnswerReveal } from './answer-reveal.js';
import { OwnStanding } from './own-standing.js';
import { NextQuestionWait } from './next-question-wait.js';

/** S-40 Result. Renders from the self-contained `quiz.result` payload only. */
export function ResultScreen({
  result,
  connectionState,
}: {
  result: StudentQuizResultPayload;
  connectionState: ConnectionState;
}) {
  return (
    <QuizMobileShell screenId="S-40" connectionState={connectionState}>
      <div className="flex flex-col gap-5 pt-2">
        <ResultVerdict result={result} />
        <AnswerReveal result={result} />
        <OwnStanding result={result} />
        <NextQuestionWait />
      </div>
    </QuizMobileShell>
  );
}
