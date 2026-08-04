import { useTicker } from '../hooks/use-ticker.js';
import './shell.css';

function clockParts(now: Date): { date: string; time: string } {
  const date = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return { date, time };
}

/** Read at arm's length: >=19px is a floor, not a preference (S-03 §touch notes). */
export function PanelClock(): JSX.Element {
  const tick = useTicker(1_000);
  const { date, time } = clockParts(new Date(tick));
  return (
    <div className="us-clock" aria-label={`Current time ${time}`}>
      <span className="us-clock__time">{time}</span>
      <span className="us-clock__date">{date}</span>
    </div>
  );
}
