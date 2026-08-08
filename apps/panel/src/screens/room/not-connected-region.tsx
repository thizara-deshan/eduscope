import { useId, type ReactNode } from 'react';
import { NotConnectedRow } from './not-connected-row.js';

export interface NotConnectedItem {
  readonly icon: ReactNode;
  readonly name: string;
}

const PROJECTOR_ICON = (
  <svg viewBox="0 0 20 20" focusable="false">
    <rect x="2.5" y="5.5" width="15" height="9" rx="2" />
    <circle cx="13.5" cy="10" r="2.5" />
    <path d="M5 14.5v2m10-2v2" />
  </svg>
);
const SCREEN_ICON = (
  <svg viewBox="0 0 20 20" focusable="false">
    <path d="M3 3.5h14M4.5 5.5h11v8h-11zM10 13.5v3m-3 0h6" />
  </svg>
);
const SPEAKER_ICON = (
  <svg viewBox="0 0 20 20" focusable="false">
    <path d="M3 8h3l4-3v10l-4-3H3zM13 7.5a4 4 0 010 5M15 5a7 7 0 010 10" />
  </svg>
);
const LIGHTS_ICON = (
  <svg viewBox="0 0 20 20" focusable="false">
    <path d="M6.5 9a3.5 3.5 0 117 0c0 1.7-1.3 2.3-1.8 3.5H8.3C7.8 11.3 6.5 10.7 6.5 9zM8 15h4M10 1V0m6 3l1-1M4 3L3 2" />
  </svg>
);
const AIR_ICON = (
  <svg viewBox="0 0 20 20" focusable="false">
    <path d="M2 6h10c3 0 3-4 1-4-1 0-1.5.5-1.7 1M2 10h14c3 0 3 4 1 4-1 0-1.5-.5-1.7-1M2 14h7" />
  </svg>
);

export const ROOM_HARDWARE: readonly NotConnectedItem[] = [
  { icon: PROJECTOR_ICON, name: 'Projector' },
  { icon: SCREEN_ICON, name: 'Projector Screen' },
  { icon: SPEAKER_ICON, name: 'Speaker Volume' },
  { icon: LIGHTS_ICON, name: 'Lights' },
  { icon: AIR_ICON, name: 'A/C' },
];

export function NotConnectedRegion({
  title,
  items,
}: {
  readonly title: string;
  readonly items: readonly NotConnectedItem[];
}): JSX.Element {
  const titleId = useId();

  return (
    <section className="us-roomregion us-notconnected" aria-labelledby={titleId}>
      <p className="us-notconnected__notice">These are not wired to this device.</p>
      <h3 className="us-roomregion__title" id={titleId}>{title}</h3>
      <div className="us-notconnected__strip">
        {items.map((item) => <NotConnectedRow key={item.name} {...item} />)}
      </div>
    </section>
  );
}
