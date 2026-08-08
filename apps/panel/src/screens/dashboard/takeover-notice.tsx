import { TAKEOVER_REVOKED_SENTENCE } from '../../auth/session.js';

function timeLabel(at: string | null): string | null {
  if (!at) return null;
  return /T(\d{2}:\d{2})/.exec(at)?.[1] ?? at;
}

export function TakeoverNotice({
  kind,
  priorOwnerDisplayName,
  byDisplayName,
  at,
}: {
  readonly kind: 'new-owner' | 'displaced';
  readonly priorOwnerDisplayName: string | null;
  readonly byDisplayName: string | null;
  readonly at: string | null;
}): JSX.Element {
  const time = timeLabel(at);
  if (kind === 'new-owner') {
    return (
      <aside className="us-takeovernotice us-takeovernotice--owner" data-testid="takeover-notice">
        You took over this recording from {priorOwnerDisplayName ?? 'the prior lecturer'}
        {time ? ` at ${time}` : ''}. It is still saved as their lecture.
      </aside>
    );
  }
  return (
    <aside className="us-takeovernotice us-takeovernotice--displaced" data-testid="takeover-notice">
      {TAKEOVER_REVOKED_SENTENCE} {byDisplayName ?? 'An administrator'} took over
      {time ? ` at ${time}` : ''}. You can no longer pause or stop this lecture.
    </aside>
  );
}
