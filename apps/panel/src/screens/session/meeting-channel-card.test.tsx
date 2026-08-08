import { act, createElement, type ReactNode, useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ProblemError } from '@eduscope/api-client';
import { ClientContext } from '../../client/client-provider.js';
import { useWsStore } from '../../store/ws-store.js';
import { MeetingChannelCard } from './meeting-channel-card.js';

const meetingConfig = {
  channelId: 'meeting', alwaysOn: false, enabledByDefault: false, presetId: 'cams-fifty-fifty',
  ratioA: 50, ratioB: 50, streamTargetIds: null, updatedAt: '2026-01-01T00:00:00.000Z',
};
const snapshots = [
  { config: meetingConfig, status: { channelId: 'meeting', state: 'off', presetId: 'cams-fifty-fifty', ratioA: 50, ratioB: 50, reason: null } },
];
const presets = [
  {
    id: 'cams-fifty-fifty', displayName: 'Both cameras', description: 'desc', allowedChannels: ['meeting'],
    kind: 'composite', canvas: { width: 1920, height: 1080 }, tiles: [], parametric: true,
    outputs: [], passthroughEligible: false, requiredRoles: ['lecturer-cam', 'students-cam'],
  },
  {
    id: 'cam-1', displayName: 'Lecturer only', description: 'desc', allowedChannels: ['local', 'meeting', 'streaming'],
    kind: 'single', canvas: { width: 1920, height: 1080 }, tiles: [], parametric: false,
    outputs: [], passthroughEligible: true, requiredRoles: ['lecturer-cam'],
  },
  {
    id: 'cam-2', displayName: 'Students only', description: 'desc', allowedChannels: ['local', 'meeting', 'streaming'],
    kind: 'single', canvas: { width: 1920, height: 1080 }, tiles: [], parametric: false,
    outputs: [], passthroughEligible: true, requiredRoles: ['students-cam'],
  },
  // Deliberately included so "meeting options are exactly the three" is a real assertion.
  {
    id: 'pc-only', displayName: 'Slides only', description: 'desc', allowedChannels: ['streaming'],
    kind: 'single', canvas: { width: 1920, height: 1080 }, tiles: [], parametric: false,
    outputs: [], passthroughEligible: true, requiredRoles: ['presentation'],
  },
];
const roles = [
  { id: 'lecturer-cam', medium: 'video', displayLabel: 'Lecturer Camera', requiredForStart: true, provisionable: true },
  { id: 'students-cam', medium: 'video', displayLabel: 'Students Camera', requiredForStart: false, provisionable: true },
];
const sourceStatus = [
  { roleId: 'lecturer-cam', state: 'online', detail: null, since: '2026-01-01T00:00:00.000Z', inputId: null },
  { roleId: 'students-cam', state: 'unbound', detail: null, since: '2026-01-01T00:00:00.000Z', inputId: null },
];

function channels(state: string, reason: string | null = null) {
  return { meeting: { channelId: 'meeting', state, presetId: 'cams-fifty-fifty', ratioA: 50, ratioB: 50, reason } };
}

function Harness() {
  const [expanded, setExpanded] = useState(false);
  return <MeetingChannelCard expanded={expanded} onExpandedChange={setExpanded} />;
}

function renderCard(overrides: Partial<EduscopeClient> = {}, cold = false) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const pending = new Promise<never>(() => undefined);
  const client = {
    listChannels: vi.fn(() => (cold ? pending : Promise.resolve(snapshots))),
    listLayoutPresets: vi.fn(() => (cold ? pending : Promise.resolve(presets))),
    listSourceRoles: vi.fn(() => (cold ? pending : Promise.resolve(roles))),
    getSourcesStatus: vi.fn(() => (cold ? pending : Promise.resolve(sourceStatus))),
    ...overrides,
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(ClientContext.Provider, { value: client }, children),
  );
  return render(<Harness />, { wrapper });
}

describe('S-08 Live Meeting card', () => {
  it('U-1: renders a skeleton before the queries resolve', () => {
    useWsStore.getState().reset();
    renderCard({}, true);
    expect(screen.getByTestId('meeting-channel-skeleton')).toBeInTheDocument();
  });

  it('off: switch off, accordion collapsed', async () => {
    useWsStore.getState().reset();
    useWsStore.setState({ channels: channels('off') as never });
    renderCard();
    await screen.findByTestId('meeting-channel-card');
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('meeting-channel-card')).not.toHaveClass('us-chcard--open');
  });

  it('preflight / starting: both feed the same pending rendering', async () => {
    useWsStore.getState().reset();
    useWsStore.setState({ channels: channels('preflight') as never });
    const view = renderCard();
    await screen.findByTestId('meeting-channel-card');
    expect(screen.getByTestId('meeting-channel-state-word')).toHaveTextContent('Starting…');
    view.unmount();

    useWsStore.setState({ channels: channels('starting') as never });
    renderCard();
    await screen.findByTestId('meeting-channel-card');
    expect(screen.getByTestId('meeting-channel-state-word')).toHaveTextContent('Starting…');
  });

  it('on: switch checked, meeting options are exactly cams-fifty-fifty/cam-1/cam-2', async () => {
    useWsStore.getState().reset();
    useWsStore.setState({ channels: channels('on') as never });
    renderCard();
    await screen.findByTestId('meeting-channel-card');
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    act(() => { screen.getByRole('button', { name: /Layouts/ }).click(); });
    const names = screen.getAllByRole('button', { name: /Both cameras|Lecturer only|Students only|Slides only/ }).map((b) => b.textContent);
    expect(names.some((n) => n?.includes('Slides only'))).toBe(false);
    expect(screen.getAllByRole('button', { name: /Both cameras|Lecturer only|Students only/ })).toHaveLength(3);
  });

  it('failed: red state, named reason, switch never reads ON', async () => {
    useWsStore.getState().reset();
    useWsStore.setState({ channels: channels('failed', 'The output consumer did not start.') as never });
    renderCard();
    await screen.findByTestId('meeting-channel-card');
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('meeting-channel-state-word')).toHaveTextContent('The output consumer did not start.');
    expect(screen.getByTestId('meeting-channel-state-word').textContent).not.toMatch(/recording stopped/i);
  });

  it('restarting: distinct from an ordinary starting, and never claims recording stopped', async () => {
    useWsStore.getState().reset();
    useWsStore.setState({ channels: channels('starting', 'The output stopped unexpectedly and is restarting.') as never });
    renderCard();
    await screen.findByTestId('meeting-channel-card');
    expect(screen.getByTestId('meeting-channel-state-word')).toHaveTextContent('Restarting…');
    expect(screen.getByTestId('meeting-channel-state-word').textContent).not.toMatch(/recording stopped/i);
  });

  it('stopping: shows a turning-off state', async () => {
    useWsStore.getState().reset();
    useWsStore.setState({ channels: channels('stopping') as never });
    renderCard();
    await screen.findByTestId('meeting-channel-card');
    expect(screen.getByTestId('meeting-channel-state-word')).toHaveTextContent('Turning off…');
  });

  it('invalid preset: a preset whose required role is unbound is disabled with the named reason', async () => {
    useWsStore.getState().reset();
    useWsStore.setState({ channels: channels('on') as never });
    renderCard();
    await screen.findByTestId('meeting-channel-card');
    act(() => { screen.getByRole('button', { name: /Layouts/ }).click(); });
    const invalid = screen.getByRole('button', { name: /Both cameras/ });
    expect(invalid).toBeDisabled();
    expect(invalid).toHaveTextContent('Needs Students Camera, which is not connected.');
  });

  it('preset change pending / U-4: only the tapped preset shows Saving…', async () => {
    useWsStore.getState().reset();
    useWsStore.setState({ channels: channels('on') as never });
    let resolve!: (v: unknown) => void;
    const update = vi.fn(() => new Promise((r) => { resolve = r; }));
    renderCard({ updateChannelConfig: update as never });
    await screen.findByTestId('meeting-channel-card');
    act(() => { screen.getByRole('button', { name: /Layouts/ }).click(); });
    act(() => { screen.getByRole('button', { name: /^Lecturer only/ }).click(); });
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /^Lecturer only/ })).toHaveTextContent('Saving…');
    await act(async () => resolve({ ...meetingConfig, presetId: 'cam-1' }));
  });

  it('U-5: a refused preset save shows the named reason', async () => {
    useWsStore.getState().reset();
    useWsStore.setState({ channels: channels('on') as never });
    const problem = { status: 422, code: 'config.invalid' as const, title: 'This layout could not be applied.' };
    renderCard({ updateChannelConfig: vi.fn(() => Promise.reject(new ProblemError(problem))) as never });
    await screen.findByTestId('meeting-channel-card');
    act(() => { screen.getByRole('button', { name: /Layouts/ }).click(); });
    act(() => { screen.getByRole('button', { name: /^Lecturer only/ }).click(); });
    await screen.findByText('This layout could not be applied.');
  });

  it('still on while paused: shows the local echo', async () => {
    useWsStore.getState().reset();
    useWsStore.setState({ channels: channels('on') as never, recording: { state: 'paused' } as never });
    renderCard();
    await screen.findByTestId('meeting-channel-card');
    expect(screen.getByTestId('meeting-still-on-paused')).toBeInTheDocument();
  });

  it('U-2: a stale connection disables the switch', async () => {
    useWsStore.getState().reset();
    useWsStore.setState({ channels: channels('off') as never, stale: true });
    renderCard();
    await screen.findByTestId('meeting-channel-card');
    expect(screen.getByRole('switch')).toBeDisabled();
  });

  it('a 202 alone never checks the switch', async () => {
    useWsStore.getState().reset();
    useWsStore.setState({ channels: channels('off') as never });
    const enableChannel = vi.fn(() => new Promise<never>(() => undefined));
    renderCard({ enableChannel: enableChannel as never });
    await screen.findByTestId('meeting-channel-card');
    act(() => { screen.getByRole('switch').click(); });
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('turning on expands the accordion; Layouts can then collapse it while staying on', async () => {
    useWsStore.getState().reset();
    useWsStore.setState({ channels: channels('off') as never });
    const enableChannel = vi.fn(() => new Promise<never>(() => undefined));
    renderCard({ enableChannel: enableChannel as never });
    await screen.findByTestId('meeting-channel-card');
    act(() => { screen.getByRole('switch').click(); });
    // Enable is pending, not yet on — the accordion only opens once state is genuinely on.
    act(() => useWsStore.setState({ channels: channels('on') as never }));
    expect(screen.getByTestId('meeting-channel-card')).toHaveClass('us-chcard--open');
    act(() => { screen.getByRole('button', { name: /Layouts/ }).click(); });
    expect(screen.getByTestId('meeting-channel-card')).not.toHaveClass('us-chcard--open');
  });
});
