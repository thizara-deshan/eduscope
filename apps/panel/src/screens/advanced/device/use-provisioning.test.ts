import { createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ClientContext } from '../../../client/client-provider.js';
import { useProvisioning } from './use-provisioning.js';

const provisioning = (overrides: Record<string, unknown> = {}) => ({
  deviceId: 'D1', serialNumber: 'ESC-1', instituteProfileId: 'uom', hallCode: 'ENG-A301',
  hallDisplayName: 'Engineering Auditorium A301', titlePattern: '{hallDisplayName} — {date}',
  timezone: 'Asia/Colombo', ntpServers: [], expectedStorageVolumeUuid: 'uuid-1',
  featureFlags: { recordingEnabled: true, aiQuizEnabled: true, streamingEnabled: true },
  quizServerBaseUrl: 'https://q', llmEndpoint: 'https://ai', provisionedAt: '2026-01-01T00:00:00Z',
  provisionedBy: 'deploy-bot',
  ...overrides,
});

function build(getProvisioning: () => Promise<unknown>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const stub = { getProvisioning } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider, { client: queryClient }, createElement(ClientContext.Provider, { value: stub, children }),
  );
  return renderHook(() => useProvisioning(), { wrapper });
}

describe('useProvisioning', () => {
  it('missingFields includes Expected storage volume when null, excludes set fields', async () => {
    const { result } = build(() => Promise.resolve(provisioning({ expectedStorageVolumeUuid: null })));
    await waitFor(() => expect(result.current.provisioning).toBeDefined());
    expect(result.current.missingFields).toEqual(['Expected storage volume']);
  });

  it('no missing fields when fully provisioned', async () => {
    const { result } = build(() => Promise.resolve(provisioning()));
    await waitFor(() => expect(result.current.provisioning).toBeDefined());
    expect(result.current.missingFields).toEqual([]);
  });
});
