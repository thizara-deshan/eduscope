export type ConnectionState = 'online' | 'reconnecting' | 'offline';

const COPY: Record<Exclude<ConnectionState, 'online'>, string> = {
  reconnecting: 'Reconnecting…',
  offline: 'You are offline. Reconnecting…',
};

/** Textual connectivity status only — no spinner-only or color-only signal. */
export function ConnectionStrip({ state }: { state: ConnectionState }) {
  if (state === 'online') return null;

  return (
    <div className="quiz-shell__connection" role="status" aria-live="polite">
      {COPY[state]}
    </div>
  );
}
