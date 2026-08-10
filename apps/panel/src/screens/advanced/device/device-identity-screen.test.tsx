import { createElement, type ReactNode } from 'react';
import { act } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ClientContext } from '../../../client/client-provider.js';
import { useWsStore } from '../../../store/ws-store.js';
import { DeviceIdentityScreen } from './device-identity-screen.js';

const provisioning = (overrides: Record<string, unknown> = {}) => ({
  deviceId: 'D1', serialNumber: 'ESC-1', instituteProfileId: 'uom', hallCode: 'ENG-A301',
  hallDisplayName: 'Engineering Auditorium A301', titlePattern: '{hallDisplayName} — {date}',
  timezone: 'Asia/Colombo', ntpServers: ['0.pool.ntp.org'], expectedStorageVolumeUuid: 'uuid-1',
  featureFlags: { recordingEnabled: true, aiQuizEnabled: true, streamingEnabled: true },
  quizServerBaseUrl: 'https://q', llmEndpoint: 'https://ai', provisionedAt: '2026-01-01T00:00:00Z',
  provisionedBy: 'deploy-bot',
  ...overrides,
});

const health = (overrides: Record<string, unknown> = {}) => ({
  deviceId: 'D1', observedAt: new Date().toISOString(), storageTotalBytes: 500_000_000_000,
  storageFreeBytes: 260_000_000_000, storagePressure: 'ok', diskHealth: 'good',
  captureCardState: 'present', publisherStates: {
    presentation: { status: 'running', lastErrorCode: null, since: '2026-01-01T00:00:00Z' },
  },
  ntpSynced: true, clockOffsetMs: 12, lastBootAt: '2026-01-01T00:00:00Z', cpuLoad1m: 0.1, tempC: 40,
  ...overrides,
});

function build(methods: Partial<EduscopeClient> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const stub = {
    getProvisioning: () => Promise.resolve(provisioning()),
    getDeviceHealth: () => Promise.resolve(health()),
    listAlerts: () => Promise.resolve({ items: [] }),
    ...methods,
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider, { client: queryClient },
    createElement(ClientContext.Provider, { value: stub }, createElement(MemoryRouter, null, children)),
  );
  return render(createElement(DeviceIdentityScreen), { wrapper });
}

describe('DeviceIdentityScreen', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
  });

  it('loading: renders a skeleton, no full-screen spinner', () => {
    build({ getProvisioning: () => new Promise(() => {}) });
    expect(screen.getByTestId('device-skeleton')).toBeInTheDocument();
  });

  it('populated: identity, features, health and alerts all render', async () => {
    build({ listAlerts: () => Promise.resolve({ items: [{
      id: 'A1', code: 'source.offline', severity: 'error', category: 'System', title: 'Capture card not detected',
      detail: null, raisedAt: '2026-01-01T00:00:00Z', clearedAt: null, clearedReason: null,
      acknowledgedBy: null, context: null, relatedEntity: null,
    }] }) });
    await waitFor(() => expect(screen.getByTestId('provisioned-chip')).toHaveTextContent('Provisioned'));
    expect(screen.getByRole('heading', { name: 'Device & Identity' }).closest('.us-adm__pagehead')).not.toBeNull();
    expect(screen.getByText('ENG-A301', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Present')).toBeInTheDocument();
    expect(screen.getByText('Capture card not detected')).toBeInTheDocument();
  });

  it('not provisioned: banner names missing fields; health and alerts still render', async () => {
    build({ getProvisioning: () => Promise.resolve(provisioning({ expectedStorageVolumeUuid: null })) });
    await waitFor(() => expect(screen.getByText('Not provisioned')).toBeInTheDocument());
    expect(screen.getByText('Missing: Expected storage volume.')).toBeInTheDocument();
    expect(screen.getAllByText('— not set (required)').length).toBeGreaterThan(0);
    expect(screen.getByText('Present')).toBeInTheDocument();
    expect(screen.getByText('No active alerts.')).toBeInTheDocument();
  });

  it('read-only structural (C-1): no input, no save/edit/apply button', async () => {
    build();
    await waitFor(() => expect(screen.getByTestId('provisioned-chip')).toHaveTextContent('Provisioned'));
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    const buttons = screen.queryAllByRole('button');
    for (const b of buttons) {
      expect(b.getAttribute('aria-label') ?? b.textContent ?? '').not.toMatch(/save|edit|apply/i);
    }
  });

  it('U-2: identity stays crisp while live regions dim', async () => {
    build();
    await waitFor(() => expect(screen.getByTestId('provisioned-chip')).toHaveTextContent('Provisioned'));
    act(() => useWsStore.setState({ stale: true }));
    expect(screen.getByText('ENG-A301', { exact: false })).toBeInTheDocument();
  });
});
