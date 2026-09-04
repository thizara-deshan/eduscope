import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeConfig } from '@eduscope/api-client';
import {
  ClientProvider,
  useClient,
  useMockClient,
} from './client-provider.js';
import { useWsStore } from '../store/ws-store.js';

const mockConfig: RuntimeConfig = {
  apiBaseUrl: '/api/v1',
  quizBaseUrl: 'https://quiz.example.edu',
  environment: 'development',
  adapters: { default: 'mock', overrides: {} },
};

/** Probes the routed client: proves an operation resolves against the mock. */
function RoutingProbe() {
  const client = useClient();
  const mock = useMockClient();
  return (
    <div>
      <div data-testid="mock-present">{mock ? 'mock' : 'no-mock'}</div>
      <div data-testid="has-recording">
        {typeof client.getRecordingState === 'function' ? 'yes' : 'no'}
      </div>
      <div data-testid="switch">
        {mock && typeof mock.switchScenario === 'function' ? 'switchable' : 'frozen'}
      </div>
    </div>
  );
}

function renderProvider(config: RuntimeConfig) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ClientProvider config={config}>
        <RoutingProbe />
      </ClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useWsStore.getState().reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ClientProvider (runtime adapter routing)', () => {
  it('constructs a routed client and exposes the concrete mock for the overlay', async () => {
    renderProvider(mockConfig);
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    await waitFor(() => expect(screen.getByTestId('has-recording').textContent).toBe('yes'));
    expect(screen.getByTestId('mock-present').textContent).toBe('mock');
    // The overlay reaches switchScenario through the concrete mock, never by
    // casting the routed (EduscopeClient-shaped) client.
    expect(screen.getByTestId('switch').textContent).toBe('switchable');
  });

  it('routes a real operation through the mock adapter end to end', async () => {
    let snapshot: unknown = null;
    function Caller() {
      const client = useClient();
      return (
        <button
          type="button"
          onClick={() => {
            void client.getRecordingState().then((s) => {
              snapshot = s;
            });
          }}
        >
          go
        </button>
      );
    }
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ClientProvider config={mockConfig}>
          <Caller />
        </ClientProvider>
      </QueryClientProvider>,
    );
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    await waitFor(() => screen.getByRole('button', { name: 'go' }));
    await act(async () => {
      screen.getByRole('button', { name: 'go' }).click();
    });
    await waitFor(() => expect(snapshot).not.toBeNull());
    expect(snapshot).toHaveProperty('state');
  });

  it('cleans up the store on unmount', async () => {
    const view = renderProvider(mockConfig);
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    await waitFor(() => expect(screen.getByTestId('has-recording').textContent).toBe('yes'));
    view.unmount();
    // reset() clears the connection back to its initial empty value.
    expect(useWsStore.getState().connection).toBeNull();
  });
});
