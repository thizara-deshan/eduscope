import { useEffect, useRef } from 'react';
import { Button } from '../../components/ui/button.js';
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
      <div
        role="status"
        aria-live="polite"
        data-testid="join-skeleton"
        className="mt-5 flex items-center gap-3 rounded-2xl border border-border bg-surface px-5 py-4 text-base text-muted shadow-sm"
      >
        <span
          aria-hidden="true"
          className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-border border-t-primary"
        />
        Finding your quiz…
      </div>
    );
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      tabIndex={-1}
      ref={statusRef}
      className="mt-5 rounded-2xl border border-danger/30 bg-danger-soft px-5 py-4"
    >
      <p className="m-0 text-base font-medium text-danger">{COPY[status]}</p>
      {(status === 'unavailable' || status === 'unreachable') && (
        <Button type="button" variant="outline" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
