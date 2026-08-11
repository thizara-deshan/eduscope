/** The dominant instruction on S-40 — store transitions replace the screen, never a timer. */
export function NextQuestionWait() {
  return (
    <p className="mt-2 flex items-center justify-center gap-2 text-lg font-semibold text-muted">
      <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-primary" />
      Waiting for the next question
    </p>
  );
}
