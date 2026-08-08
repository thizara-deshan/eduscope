import { createElement, type ReactNode } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import type { User } from '@eduscope/shared';
import { AuthProvider } from '../../auth/auth-context.js';
import { ClientContext } from '../../client/client-provider.js';
import { OverlayProvider } from '../../overlays/overlay-host.js';
import { useWsStore } from '../../store/ws-store.js';
import { CaptureAssuranceCard } from './capture-assurance-card.js';

const user: User = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', username: 'a.perera', displayName: 'A. Perera',
  role: 'lecturer', source: 'institute', mustResetPassword: false, disabled: false,
  lastLoginAt: null, createdAt: '2026-01-01T00:00:00.000Z',
};
const source = (roleId: string) => ({
  roleId, state: 'online', detail: null, inputId: null, since: '2026-08-05T10:00:00.000Z',
});
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
const storage = {
  pressure: 'ok', freeBytes: 418_000_000_000, totalBytes: 1_800_000_000_000,
  volumes: [], policy: {
    maxAgeDays: 14, warningThresholdPct: 70, criticalThresholdPct: 85,
    earlyDeleteOrder: 'uploaded-oldest-first', neverDeleteUnuploaded: true,
    refuseStartWhenCritical: true,
  },
};

let resize: ((height: number) => void) | null = null;
class ResizeObserverMock {
  constructor(callback: ResizeObserverCallback) {
    resize = (height) => callback([{
      contentRect: { height }, target: document.body,
    } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  observe() {}
  disconnect() {}
  unobserve() {}
}

function renderCard({ cold = false }: { cold?: boolean } = {}) {
  useWsStore.getState().reset();
  if (!cold) {
    useWsStore.setState({
      sources: {
        presentation: source('presentation'),
        'lecturer-cam': source('lecturer-cam'),
        'students-cam': source('students-cam'),
      } as never,
      channels: { local: channels[0]!.status } as never,
      storage: storage as never,
      recording: { state: 'recording' } as never,
    });
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(['provisioning'], {
    hallDisplayName: 'Hall A', featureFlags: { aiQuizEnabled: false }, llmEndpoint: null,
  });
  const pending = new Promise<never>(() => undefined);
  const client = {
    getProvisioning: vi.fn(() => Promise.resolve({
      hallDisplayName: 'Hall A', featureFlags: { aiQuizEnabled: false }, llmEndpoint: null,
    })),
    listChannels: vi.fn(() => cold ? pending : Promise.resolve(channels)),
    listLayoutPresets: vi.fn(() => cold ? pending : Promise.resolve(presets)),
    getStorageOverview: vi.fn(() => cold ? pending : Promise.resolve(storage)),
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(ClientContext.Provider, { value: client },
      createElement(AuthProvider, {
        initialUser: user,
        children: createElement(MemoryRouter, null,
          createElement(OverlayProvider, null, children)),
      })),
  );
  return render(<CaptureAssuranceCard />, { wrapper });
}

describe('CaptureAssuranceCard', () => {
  it('renders a four-block cold skeleton with a tier-2 verdict', () => {
    renderCard({ cold: true });
    expect(screen.getByTestId('capture-verdict')).toHaveAttribute('data-tier', '2');
    expect(screen.getByTestId('capture-sources')).toBeInTheDocument();
    expect(screen.getByTestId('capture-outputs')).toBeInTheDocument();
    expect(screen.getByTestId('capture-disk')).toBeInTheDocument();
  });

  it('condenses by measured height without omitting facts', async () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    renderCard();
    expect(await screen.findByText(/This device — Presentation only/i)).toBeInTheDocument();
    act(() => resize?.(602));
    const card = screen.getByTestId('capture-assurance-card');
    const comfortableFacts = ['Everything this lecture needs is working', 'PC', 'Live',
      'This device — Presentation only', 'Live Meeting — Cameras side by side',
      '418 GB free of 1.8 TB',
      'Recordings are deleted 14 days after they upload.'];
    for (const fact of comfortableFacts) expect(card).toHaveTextContent(fact);
    expect(card).toHaveAttribute('data-density', 'comfortable');
    act(() => resize?.(388));
    for (const fact of comfortableFacts) expect(card).toHaveTextContent(fact);
    expect(card).toHaveAttribute('data-density', 'dense');
    vi.unstubAllGlobals();
  });

  it('has one polite live region and no buttons beyond the three source tiles', async () => {
    renderCard();
    await screen.findByText(/This device — Presentation only/i);
    const card = screen.getByTestId('capture-assurance-card');
    const liveRegions = card.querySelectorAll('[aria-live]');
    expect(liveRegions).toHaveLength(1);
    expect(liveRegions[0]).toHaveAttribute('aria-live', 'polite');
    expect(liveRegions[0]).not.toHaveAttribute('aria-live', 'assertive');
    expect(within(card).getAllByRole('button')).toHaveLength(3);
  });
});
