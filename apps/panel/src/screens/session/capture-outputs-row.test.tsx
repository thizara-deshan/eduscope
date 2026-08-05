import { createElement, type ReactNode } from 'react';
import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ClientContext } from '../../client/client-provider.js';
import { useWsStore } from '../../store/ws-store.js';
import { CaptureOutputsRow } from './capture-outputs-row.js';

const channels = [
  { channelId: 'local', state: 'on', presetId: 'pc-only', ratioA: null, ratioB: null, reason: null },
  { channelId: 'meeting', state: 'off', presetId: 'cams-fifty-fifty', ratioA: 50, ratioB: 50, reason: null },
  { channelId: 'streaming', state: 'off', presetId: 'fifty-fifty', ratioA: 50, ratioB: 50, reason: null },
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
