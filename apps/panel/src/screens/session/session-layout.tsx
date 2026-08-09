import { useState } from 'react';
import { AiStudioCard } from '../ai/ai-studio-card.js';
import { TimerCard } from '../transport/timer-card.js';
import { CaptureAssuranceCard } from './capture-assurance-card.js';
import { MeetingChannelCard } from './meeting-channel-card.js';
import { useAiEnabled } from './use-ai-enabled.js';
import './session.css';

export function SessionLayout(): JSX.Element {
  const aiEnabled = useAiEnabled();
  // Lifted so Wave 4's insights wrapper can attach
  // `.us-insightswrap--collapsed` without changing S-08 (W3-D-6).
  const [meetingLayoutsOpen, setMeetingLayoutsOpen] = useState(false);

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
          <AiStudioCard />
        ) : (
          <CaptureAssuranceCard />
        )}
      </div>
      <aside
        className={`us-sessionlayout__sidebar${meetingLayoutsOpen ? ' us-sessionlayout__sidebar--meeting-open' : ''}`}
        data-testid="session-sidebar"
        aria-label="Session controls"
      >
        <TimerCard />
        <MeetingChannelCard expanded={meetingLayoutsOpen} onExpandedChange={setMeetingLayoutsOpen} />
      </aside>
    </main>
  );
}
