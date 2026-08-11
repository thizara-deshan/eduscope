export type ConnectionState = 'online' | 'reconnecting' | 'offline';

const COPY: Record<Exclude<ConnectionState, 'online'>, string> = {
  reconnecting: 'Reconnecting…',
  offline: 'You are offline. Reconnecting…',
};

/** Textual connectivity status only — no spinner-only or color-only signal. */
export function ConnectionStrip({ state }: { state: ConnectionState }) {
  if (state === 'online') return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 bg-warning-soft px-5 py-2 text-center text-[15px] font-medium text-warning"
    >
      <span aria-hidden="true" className="h-2 w-2 rounded-full bg-warning" />
      {COPY[state]}
    </div>
  );
}
