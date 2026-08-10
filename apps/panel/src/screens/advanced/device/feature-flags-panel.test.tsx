import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DeviceProvisioning } from '@eduscope/shared';
import { FeatureFlagsPanel } from './feature-flags-panel.js';

const provisioning = (overrides: Record<string, unknown> = {}): DeviceProvisioning => ({
  deviceId: 'D1', serialNumber: 'ESC-1', instituteProfileId: 'uom', hallCode: 'ENG-A301',
  hallDisplayName: 'Engineering Auditorium A301', titlePattern: '{hallDisplayName}',
  timezone: 'Asia/Colombo', ntpServers: [], expectedStorageVolumeUuid: 'uuid-1',
  featureFlags: { recordingEnabled: true, aiQuizEnabled: false, streamingEnabled: true },
  quizServerBaseUrl: null, llmEndpoint: null, provisionedAt: '2026-01-01T00:00:00Z',
  provisionedBy: 'deploy-bot',
  ...overrides,
} as DeviceProvisioning);

describe('FeatureFlagsPanel', () => {
  it('feature/recording independence (C-5, INV-DP-4): AI off is neutral, recording still On', () => {
    render(createElement(FeatureFlagsPanel, { provisioning: provisioning() }));
    expect(screen.getAllByText('On').length).toBe(2); // Recording, Streaming
    expect(screen.getByText(/Off — turned off for this room; recording is unaffected/)).toBeInTheDocument();
  });

  it('null endpoints render as unavailable (LP-18)', () => {
    render(createElement(FeatureFlagsPanel, { provisioning: provisioning() }));
    expect(screen.getByText(/not configured — AI studio unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/not configured — quiz features unavailable/)).toBeInTheDocument();
  });
});
