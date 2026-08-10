import type { ConnectionState } from '../../components/connection-strip.js';

const COPY: Record<ConnectionState, string> = {
  online: 'Connected',
  reconnecting: 'Reconnecting…',
  offline: 'Offline',
};

/** No score/rank here — that is exclusively S-40's concern. */
export function QuizLiveHeader({ connectionState }: { connectionState: ConnectionState }) {
  return (
    <div className="quiz-live__header">
      <span aria-hidden="true">{connectionState === 'online' ? '●' : '○'}</span>
      <span>{COPY[connectionState]}</span>
    </div>
  );
}
