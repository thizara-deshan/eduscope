import type { ReactNode } from 'react';

export function NotConnectedRow({
  icon,
  name,
}: {
  readonly icon: ReactNode;
  readonly name: string;
}): JSX.Element {
  return (
    <div className="us-notconnected__row">
      <span className="us-notconnected__icon" aria-hidden="true">{icon}</span>
      <span className="us-notconnected__name" aria-label={name === 'A/C' ? 'Air conditioning' : undefined}>
        {name}
      </span>
    </div>
  );
}
