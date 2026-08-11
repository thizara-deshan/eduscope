import type { ConnectionState } from '../../components/connection-strip.js';
import { cn } from '../../lib/utils.js';

const COPY: Record<ConnectionState, string> = {
  online: 'Connected',
  reconnecting: 'Reconnecting…',
  offline: 'Offline',
};

/** No score/rank here — that is exclusively S-40's concern. */
export function QuizLiveHeader({ connectionState }: { connectionState: ConnectionState }) {
  const online = connectionState === 'online';
  return (
    <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-sm font-medium text-muted shadow-sm">
      <span
        aria-hidden="true"
        className={cn('h-2 w-2 rounded-full', online ? 'bg-success' : 'bg-warning')}
      />
      {COPY[connectionState]}
    </div>
  );
}
