import type { DeviceProvisioning } from '@eduscope/shared';

interface FeatureFlagsPanelProps {
  readonly provisioning: DeviceProvisioning;
}

/** S-36 §2.1, C-5 — featureFlags legible On/Off; AI Off is neutral (INV-DP-4), never an error. */
export function FeatureFlagsPanel({ provisioning }: FeatureFlagsPanelProps): JSX.Element {
  const { featureFlags } = provisioning;

  return (
    <section className="us-adm__card us-device__card" aria-label="Features in this room">
      <h2 className="us-device__eyebrow">Features in this room</h2>
      <div className="us-device__feature">
        <span className={`us-device__dot us-device__dot--${featureFlags.recordingEnabled ? 'on' : 'off'}`} aria-hidden="true" />
        <span className="us-device__label">Recording</span>
        <span className="us-device__value">{featureFlags.recordingEnabled ? 'On' : 'Off'}</span>
      </div>
      <div className="us-device__feature">
        <span className={`us-device__dot us-device__dot--${featureFlags.aiQuizEnabled ? 'on' : 'off'}`} aria-hidden="true" />
        <span className="us-device__label">AI quiz</span>
        <span className="us-device__value">
          {featureFlags.aiQuizEnabled ? 'On' : 'Off — turned off for this room; recording is unaffected'}
        </span>
      </div>
      <div className="us-device__feature">
        <span className={`us-device__dot us-device__dot--${featureFlags.streamingEnabled ? 'on' : 'off'}`} aria-hidden="true" />
        <span className="us-device__label">Streaming</span>
        <span className="us-device__value">{featureFlags.streamingEnabled ? 'On' : 'Off'}</span>
      </div>
      <div className="us-device__field">
        <span className="us-device__label">AI endpoint</span>
        <span className="us-device__value">
          {provisioning.llmEndpoint ?? 'not configured — AI studio unavailable'}
        </span>
      </div>
      <div className="us-device__field">
        <span className="us-device__label">Quiz server</span>
        <span className="us-device__value">
          {provisioning.quizServerBaseUrl ?? 'not configured — quiz features unavailable'}
        </span>
      </div>
    </section>
  );
}
