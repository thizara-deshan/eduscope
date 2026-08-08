import { createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ClientContext } from '../../client/client-provider.js';
import { useAiEnabled } from './use-ai-enabled.js';

function renderGate(provisioning: Record<string, unknown> | Promise<never>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = {
    getProvisioning: vi.fn(() => provisioning instanceof Promise
      ? provisioning
      : Promise.resolve(provisioning)),
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(ClientContext.Provider, { value: client }, children),
  );
  return renderHook(() => useAiEnabled(), { wrapper });
}

describe('useAiEnabled', () => {
  it('is true only when the feature flag and endpoint are present', async () => {
    const result = renderGate({
      featureFlags: { aiQuizEnabled: true },
      llmEndpoint: 'http://127.0.0.1:11434',
    });
    await waitFor(() => expect(result.result.current).toBe(true));
  });

  it('is false when aiQuizEnabled is false', async () => {
    const result = renderGate({
      featureFlags: { aiQuizEnabled: false },
      llmEndpoint: 'http://127.0.0.1:11434',
    });
    await waitFor(() => expect(result.result.current).toBe(false));
  });

  it('is false when llmEndpoint is null', async () => {
    const result = renderGate({
      featureFlags: { aiQuizEnabled: true },
      llmEndpoint: null,
    });
    await waitFor(() => expect(result.result.current).toBe(false));
  });

  it('is undefined while provisioning is in flight', () => {
    const result = renderGate(new Promise<never>(() => undefined));
    expect(result.result.current).toBeUndefined();
  });
});
