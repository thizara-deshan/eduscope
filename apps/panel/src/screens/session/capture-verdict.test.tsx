import { createElement, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import type { User } from '@eduscope/shared';
import { AuthProvider } from '../../auth/auth-context.js';
import { ClientContext } from '../../client/client-provider.js';
import { useWsStore } from '../../store/ws-store.js';
import { CaptureVerdict } from './capture-verdict.js';

const user: User = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', username: 'a.perera', displayName: 'A. Perera',
  role: 'lecturer', source: 'institute', mustResetPassword: false, disabled: false,
  lastLoginAt: null, createdAt: '2026-01-01T00:00:00.000Z',
};

const source = (roleId: string, state: string) => ({
  roleId, state, detail: null, inputId: null, since: '2026-08-05T10:00:00.000Z',
});
const storage = (pressure = 'ok') => ({
  pressure, freeBytes: 418_000_000_000, totalBytes: 1_800_000_000_000,
  policy: {
    maxAgeDays: 14, warningThresholdPct: 70, criticalThresholdPct: 85,
    earlyDeleteOrder: 'uploaded-oldest-first', neverDeleteUnuploaded: true,
    refuseStartWhenCritical: true,
  },
});

function renderVerdict({
  role = 'online', mic = 'online', pressure = 'ok', recording = 'recording', stale = false,
}: {
  role?: string; mic?: string; pressure?: string; recording?: string; stale?: boolean;
} = {}) {
  useWsStore.getState().reset();
  useWsStore.setState({
    sources: {
      presentation: source('presentation', role),
      'mic-lecturer': source('mic-lecturer', mic),
    } as never,
    channels: { local: {
      channelId: 'local', state: 'on', presetId: 'pc-only',
      ratioA: null, ratioB: null, reason: null,
    } } as never,
    storage: storage(pressure) as never,
    recording: { state: recording } as never,
    stale,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(['provisioning'], {
    hallDisplayName: 'Hall A', featureFlags: { aiQuizEnabled: false }, llmEndpoint: null,
  });
  const client = { getProvisioning: vi.fn(() => Promise.resolve({
    hallDisplayName: 'Hall A', featureFlags: { aiQuizEnabled: false }, llmEndpoint: null,
  })) } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(ClientContext.Provider, { value: client },
      createElement(AuthProvider, {
        initialUser: user,
        children: createElement(MemoryRouter, null, children),
      })),
  );
  return render(<CaptureVerdict />, { wrapper });
}

describe('CaptureVerdict', () => {
  it('renders the assured state in words', () => {
    renderVerdict();
    expect(screen.getByTestId('capture-verdict')).toHaveAttribute('data-tier', '1');
    expect(screen.getByText('Everything this lecture needs is working')).toBeInTheDocument();
  });

  it('renders attention with a named sentence', () => {
    renderVerdict({ pressure: 'warning' });
    expect(screen.getByTestId('capture-verdict')).toHaveAttribute('data-tier', '3');
    expect(screen.getByText('The disk is filling up.')).toBeInTheDocument();
  });

  it('renders a problem followed by the recording reassurance', () => {
    renderVerdict({ role: 'offline' });
    expect(screen.getByText('PC has no signal.')).toBeInTheDocument();
    expect(screen.getByText('Your lecture is still recording.')).toBeInTheDocument();
  });

  it('lets the dead microphone sentence win a tier-4 tie', () => {
    renderVerdict({ role: 'offline', mic: 'offline', pressure: 'critical' });
    expect(screen.getByText(/recording silence/i)).toBeInTheDocument();
  });

  it('degrades stale healthy data to the checking state', () => {
    renderVerdict({ stale: true });
    expect(screen.getByTestId('capture-verdict')).toHaveAttribute('data-tier', '2');
    expect(screen.getByText('Checking the room…')).toBeInTheDocument();
  });

  it('replaces the verdict with the paused sentence', () => {
    renderVerdict({ recording: 'paused' });
    expect(screen.getByText('Paused — nothing is being recorded right now.')).toBeInTheDocument();
    expect(screen.getByText(/PAUSED · HALL A/i)).toBeInTheDocument();
  });

  it('uses the saving sentence for both stopping and finalizing', () => {
    const first = renderVerdict({ recording: 'stopping' });
    expect(screen.getByText('Saving your lecture…')).toBeInTheDocument();
    first.unmount();
    renderVerdict({ recording: 'finalizing' });
    expect(screen.getByText('Saving your lecture…')).toBeInTheDocument();
  });
});
