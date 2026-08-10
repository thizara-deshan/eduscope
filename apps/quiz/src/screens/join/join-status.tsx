import { useEffect, useRef } from 'react';
import type { JoinStatus as JoinStatusKind } from './use-join-resolution.js';

const COPY: Record<'not-found' | 'unavailable' | 'unreachable', string> = {
  'not-found': 'That quiz code is not active.',
  unavailable: 'Quiz service unavailable. Try again.',
  unreachable: 'Something went wrong. Try again.',
};

export function JoinStatus({ status, onRetry }: { status: JoinStatusKind; onRetry: () => void }) {
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (status === 'not-found' || status === 'unavailable' || status === 'unreachable') {
      statusRef.current?.focus();
    }
  }, [status]);

  if (status === 'idle') return null;

  if (status === 'resolving') {
    return (
      <div role="status" aria-live="polite" className="join-status join-status--skeleton" data-testid="join-skeleton">
        Finding your quiz…
      </div>
    );
  }

  return (
    <div role="alert" aria-live="assertive" tabIndex={-1} ref={statusRef} className="join-status join-status--error">
      <p>{COPY[status]}</p>
      {(status === 'unavailable' || status === 'unreachable') && (
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
