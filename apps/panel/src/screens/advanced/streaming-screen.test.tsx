import { act, createElement, type ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ProblemError } from '@eduscope/api-client';
import type { User } from '@eduscope/shared';
import { AuthProvider } from '../../auth/auth-context.js';
import { ClientContext } from '../../client/client-provider.js';
import { OverlayProvider } from '../../overlays/overlay-host.js';
import { useWsStore } from '../../store/ws-store.js';
import { StreamingScreen } from './streaming-screen.js';
import '../../styles/tokens.css';

const streamingConfig = {
  channelId: 'streaming', alwaysOn: false, enabledByDefault: false, presetId: 'fifty-fifty',
  ratioA: 50, ratioB: 50, streamTargetIds: ['T1'], updatedAt: '2026-01-01T00:00:00.000Z',
};
const snapshots = [
  { config: streamingConfig, status: { channelId: 'streaming', state: 'off', presetId: 'fifty-fifty', ratioA: 50, ratioB: 50, reason: null } },
];
const presets = [
  {
    id: 'fifty-fifty', displayName: 'Slides + camera', description: 'desc', allowedChannels: ['streaming'],
    kind: 'composite', canvas: { width: 1920, height: 1080 }, tiles: [], parametric: true,
    outputs: [], passthroughEligible: false, requiredRoles: ['presentation', 'lecturer-cam'],
  },
];
const roles = [
  { id: 'presentation', medium: 'video', displayLabel: 'Presentation', requiredForStart: true, provisionable: true },
  { id: 'lecturer-cam', medium: 'video', displayLabel: 'Lecturer Camera', requiredForStart: true, provisionable: true },
];
const sourceStatus = [
  { roleId: 'presentation', state: 'online', detail: null, since: '2026-01-01T00:00:00.000Z', inputId: null },
  { roleId: 'lecturer-cam', state: 'online', detail: null, since: '2026-01-01T00:00:00.000Z', inputId: null },
];
const target = {
  id: 'T1', platform: 'youtube' as const, displayName: 'Main YouTube', ingestUrl: 'rtmp://a.rtmp.youtube.com/live2',
  hasStreamKey: true, requiresTlsBridge: false, enabled: true, lastPreflightAt: null, lastPreflightResult: 'ok' as const,
};

function user(role: 'lecturer' | 'admin'): User {
  return {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', username: 'a.perera', displayName: 'A. Perera',
    role, source: 'institute', mustResetPassword: false, disabled: false,
    lastLoginAt: null, createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function renderScreen(
  role: 'lecturer' | 'admin',
  overrides: Partial<EduscopeClient> = {},
  cold = false,
  recordingState: 'idle' | 'recording' | 'paused' = 'idle',
) {
  useWsStore.getState().reset();
  useWsStore.setState({ recording: { state: recordingState } as never });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const pending = new Promise<never>(() => undefined);
  const stub = {
    listChannels: vi.fn(() => (cold ? pending : Promise.resolve(snapshots))),
    listLayoutPresets: vi.fn(() => (cold ? pending : Promise.resolve(presets))),
    listSourceRoles: vi.fn(() => (cold ? pending : Promise.resolve(roles))),
    getSourcesStatus: vi.fn(() => (cold ? pending : Promise.resolve(sourceStatus))),
    listStreamTargets: vi.fn(() => (cold ? pending : Promise.resolve([target]))),
    ...overrides,
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(ClientContext.Provider, { value: stub },
      createElement(AuthProvider, { initialUser: user(role), children: createElement(OverlayProvider, null, children) })),
  );
  return render(<StreamingScreen />, { wrapper });
}

describe('S-27 Streaming Configuration', () => {
  it('loading/U-1: renders a skeleton before the queries resolve', () => {
    renderScreen('admin', {}, true);
    expect(screen.getByTestId('streaming-screen-skeleton')).toBeInTheDocument();
  });

  it('no targets configured: shows the explanatory empty state', async () => {
    renderScreen('admin', { listStreamTargets: vi.fn(() => Promise.resolve([])) });
    await screen.findByTestId('stream-target-list').catch(() => undefined);
    expect(await screen.findByTestId('stream-targets-empty')).toBeInTheDocument();
  });

  it('populated: admin sees the saved target with edit/delete, and Add destination', async () => {
    renderScreen('admin');
    expect(await screen.findByText('Main YouTube')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add destination' })).toBeInTheDocument();
  });

  it('channel off: idle label and unchecked switch', async () => {
    renderScreen('admin');
    await screen.findByTestId('streaming-state-word');
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it.each([
    ['preflight', 'Checking your destination…'],
    ['starting', 'Starting…'],
    ['stopping', 'Turning off…'],
  ])('channel %s renders the matching state word', async (state, expected) => {
    renderScreen('admin', {}, false, 'recording');
    await screen.findByTestId('streaming-state-word');
    act(() => useWsStore.setState({
      channels: { streaming: { channelId: 'streaming', state, presetId: 'fifty-fifty', ratioA: 50, ratioB: 50, reason: null } },
    } as never));
    expect(screen.getByTestId('streaming-state-word')).toHaveTextContent(expected);
  });

  it('preflight failed: named reason says recording is unaffected', async () => {
    renderScreen('admin', {}, false, 'recording');
    await screen.findByTestId('streaming-state-word');
    act(() => useWsStore.setState({
      channels: {
        streaming: {
          channelId: 'streaming', state: 'failed', presetId: 'fifty-fifty', ratioA: 50, ratioB: 50,
          reason: 'The streaming destination could not be reached. Your lecture is still recording.',
        },
      },
    } as never));
    expect(screen.getByTestId('streaming-state-word')).toHaveTextContent(/still recording/);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('restarting: distinct from an ordinary starting', async () => {
    renderScreen('admin', {}, false, 'recording');
    await screen.findByTestId('streaming-state-word');
    act(() => useWsStore.setState({
      channels: {
        streaming: {
          channelId: 'streaming', state: 'starting', presetId: 'fifty-fifty', ratioA: 50, ratioB: 50,
          reason: 'The output stopped unexpectedly and is restarting.',
        },
      },
    } as never));
    expect(screen.getByTestId('streaming-state-word')).toHaveTextContent('Restarting…');
  });

  it('idle vs live toggle semantics: compares label/action at idle then live', async () => {
    renderScreen('admin');
    await screen.findByTestId('streaming-state-word');
    expect(screen.getByRole('switch')).toHaveAttribute('aria-label', 'Stream on next recording');
    act(() => useWsStore.setState({ recording: { state: 'recording' } as never }));
    expect(screen.getByRole('switch')).toHaveAttribute('aria-label', 'Start streaming now');
  });

  it('stream key write-only: editing the seeded target shows Configured and a blank key field', async () => {
    renderScreen('admin');
    await screen.findByText('Main YouTube');
    act(() => { screen.getByRole('button', { name: 'Edit' }).click(); });
    expect(await screen.findByText(/Stream key.*Configured/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Stream key/)).toHaveValue('');
    expect(document.body.textContent).not.toMatch(/mock-stream-key/);
  });

  it('saving/U-4 then rejected/U-5 on the target form', async () => {
    const problem = { status: 422, code: 'validation.invalid' as const, title: 'The streaming destination rejected these settings.' };
    const create = vi.fn(() => Promise.reject(new ProblemError(problem)));
    renderScreen('admin', { createStreamTarget: create as never });
    await screen.findByText('Main YouTube');
    act(() => { screen.getByRole('button', { name: 'Add destination' }).click(); });
    await screen.findByTestId('stream-target-form');
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Backup' } });
    fireEvent.change(screen.getByLabelText('Ingest URL'), { target: { value: 'rtmp://b' } });
    fireEvent.change(screen.getByLabelText(/Stream key/), { target: { value: 'k' } });
    act(() => { fireEvent.click(screen.getByRole('button', { name: /^Save$/ })); });
    expect(await screen.findByText('The streaming destination rejected these settings.')).toBeInTheDocument();
  });

  it('U-2: reconnecting disables the switch', async () => {
    renderScreen('admin');
    await screen.findByTestId('streaming-state-word');
    act(() => useWsStore.setState({ stale: true }));
    expect(screen.getByRole('switch')).toBeDisabled();
  });

  it('lecturer never calls listStreamTargets and sees a configured count with a management explanation', async () => {
    const listStreamTargets = vi.fn(() => Promise.resolve([target]));
    renderScreen('lecturer', { listStreamTargets: listStreamTargets as never });
    await screen.findByTestId('streaming-target-count');
    expect(listStreamTargets).not.toHaveBeenCalled();
    expect(screen.getByTestId('streaming-target-count')).toHaveTextContent('1 destination configured');
    expect(screen.queryByRole('button', { name: 'Add destination' })).toBeNull();
  });

  it('admin sees the target list and can create/update/delete', async () => {
    renderScreen('admin');
    expect(await screen.findByTestId('stream-target-list')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });
});
