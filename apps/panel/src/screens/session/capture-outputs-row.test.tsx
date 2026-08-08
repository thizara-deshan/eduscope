import { createElement, type ReactNode } from 'react';
import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ClientContext } from '../../client/client-provider.js';
import { useWsStore } from '../../store/ws-store.js';
import { CaptureOutputsRow } from './capture-outputs-row.js';

function snapshot(channelId: string, state: string, presetId: string, ratioA: number | null, ratioB: number | null) {
  return {
    config: {
      channelId, alwaysOn: channelId === 'local', enabledByDefault: true, presetId,
      ratioA, ratioB, streamTargetIds: null, updatedAt: '2026-01-01T00:00:00.000Z',
    },
    status: { channelId, state, presetId, ratioA, ratioB, reason: null },
  };
}
const channels = [
  snapshot('local', 'on', 'pc-only', null, null),
  snapshot('meeting', 'off', 'cams-fifty-fifty', 50, 50),
  snapshot('streaming', 'off', 'fifty-fifty', 50, 50),
];
const presets = [
  { id: 'pc-only', displayName: 'Presentation only' },
  { id: 'cams-fifty-fifty', displayName: 'Cameras side by side' },
  { id: 'fifty-fifty', displayName: 'Presentation and camera' },
];

function renderOutputs() {
  useWsStore.getState().reset();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = {
    listChannels: vi.fn(() => Promise.resolve(channels)),
    listLayoutPresets: vi.fn(() => Promise.resolve(presets)),
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(ClientContext.Provider, { value: client }, children),
  );
  return render(<CaptureOutputsRow dense={false} />, { wrapper });
}

describe('CaptureOutputsRow', () => {
  it('renders REST channels with resolved preset names and no interactive rows', async () => {
    renderOutputs();
    expect(await screen.findByText(/This device — Presentation only/i)).toBeInTheDocument();
    expect(screen.getByText(/Live Meeting — Cameras side by side/i)).toBeInTheDocument();
    expect(screen.queryByText(/Live Stream/i)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('keeps populated rows mounted through a stale/reconnect store transition', async () => {
    renderOutputs();
    const local = await screen.findByText(/This device — Presentation only/i);
    act(() => useWsStore.setState({ stale: true }));
    act(() => useWsStore.setState({ stale: false }));
    expect(local).toBeInTheDocument();
    expect(screen.queryByTestId('capture-outputs-skeleton')).toBeNull();
  });
});
