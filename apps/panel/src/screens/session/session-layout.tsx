import { TimerCard } from '../transport/timer-card.js';
import { CaptureAssuranceCard } from './capture-assurance-card.js';
import { useAiEnabled } from './use-ai-enabled.js';
import './session.css';

export function SessionLayout(): JSX.Element {
  const aiEnabled = useAiEnabled();

  return (
    <main
      className="us-sessionlayout"
      data-testid="screen"
      data-screen="S-05"
      aria-label="Recording session"
    >
      <div className="us-sessionlayout__main">
        {aiEnabled === undefined ? (
          <div
            className="us-sessionlayout__skeleton"
            data-testid="session-main-skeleton"
            aria-label="Loading session content"
          />
        ) : aiEnabled ? (
          <div className="us-sessionlayout__ai-slot" data-screen="S-13" data-wave="4">
            AI Quiz Studio
          </div>
        ) : (
          <CaptureAssuranceCard />
        )}
      </div>
      <aside
        className="us-sessionlayout__sidebar"
        data-testid="session-sidebar"
        aria-label="Session controls"
      >
        <TimerCard />
      </aside>
    </main>
  );
}
