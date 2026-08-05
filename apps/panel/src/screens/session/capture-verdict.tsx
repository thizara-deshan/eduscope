import { useProvisioning } from '../../shell/use-provisioning.js';
import { useRecordingState } from '../../store/selectors.js';
import { useCaptureAssurance } from './use-capture-assurance.js';

export function CaptureVerdict(): JSX.Element {
  const verdict = useCaptureAssurance();
  const recordingState = useRecordingState();
  const provisioning = useProvisioning();
  const phase = recordingState === 'paused' ? 'PAUSED' : 'RECORDING';
  const eyebrow = provisioning.hallDisplayName
    ? `${phase} · ${provisioning.hallDisplayName.toUpperCase()}`
    : phase;

  return (
    <header
      className={`us-captureverdict us-captureverdict--tier-${verdict.tier}`}
      data-testid="capture-verdict"
      data-tier={verdict.tier}
      aria-live="polite"
    >
      <div className="us-captureverdict__eyebrow">{eyebrow}</div>
      <div className="us-captureverdict__sentence">{verdict.sentence}</div>
      {verdict.reassurance ? (
        <div className="us-captureverdict__reassurance">{verdict.reassurance}</div>
      ) : null}
    </header>
  );
}
