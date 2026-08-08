import { act, createElement, type ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ProblemError } from '@eduscope/api-client';
import { ClientContext } from '../../client/client-provider.js';
import { useWsStore } from '../../store/ws-store.js';
import { LocalCaptureScreen } from './local-capture-screen.js';

const localConfig = {
  channelId: 'local', alwaysOn: true, enabledByDefault: true, presetId: 'fifty-fifty',
  ratioA: 50, ratioB: 50, streamTargetIds: null, updatedAt: '2026-01-01T00:00:00.000Z',
};
const snapshots = [{ config: localConfig, status: { channelId: 'local', state: 'on', presetId: 'fifty-fifty', ratioA: 50, ratioB: 50, reason: null } }];

function preset(id: string, kind: 'single' | 'composite' | 'multi-file', outputs: number, requiredRoles: string[]) {
  return {
    id, displayName: id, description: `${id} description`, allowedChannels: ['local'], kind,
    canvas: { width: 1920, height: 1080 },
    tiles: [{ roleId: 'presentation', x: 0, y: 0, w: 1920, h: 1080, z: 0 }],
    parametric: kind === 'composite',
    outputs: Array.from({ length: outputs }, (_v, i) => (
      { streamKey: `k${i}`, roleIds: [i === 0 ? 'presentation' : 'lecturer-cam'], includeAudio: i !== 0 }
    )),
    passthroughEligible: kind === 'single',
    requiredRoles,
  };
}

const presets = [
  preset('fifty-fifty', 'composite', 1, ['presentation', 'lecturer-cam']),
  preset('side-by-side', 'composite', 1, ['presentation', 'students-cam']),
  preset('cam-1', 'single', 1, ['lecturer-cam']),
  preset('cam-2', 'single', 1, ['students-cam']),
  preset('separate-files', 'multi-file', 2, ['presentation', 'lecturer-cam']),
];
const roles = [
  { id: 'presentation', medium: 'video', displayLabel: 'Presentation', requiredForStart: true, provisionable: true },
  { id: 'lecturer-cam', medium: 'video', displayLabel: 'Lecturer Camera', requiredForStart: true, provisionable: true },
  { id: 'students-cam', medium: 'video', displayLabel: 'Students Camera', requiredForStart: false, provisionable: true },
];
const sourceStatus = [
  { roleId: 'presentation', state: 'online', detail: null, since: '2026-01-01T00:00:00.000Z', inputId: null },
  { roleId: 'lecturer-cam', state: 'online', detail: null, since: '2026-01-01T00:00:00.000Z', inputId: null },
  { roleId: 'students-cam', state: 'unbound', detail: null, since: '2026-01-01T00:00:00.000Z', inputId: null },
];

function renderScreen(overrides: Partial<EduscopeClient> = {}, cold = false) {
  useWsStore.getState().reset();
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
  return render(<LocalCaptureScreen />, { wrapper });
}

describe('S-26 Local Capture Layout', () => {
  it('loading/U-1: renders a skeleton before the queries resolve', () => {
    renderScreen({}, true);
    expect(screen.getByTestId('local-capture-skeleton')).toBeInTheDocument();
  });

  it('populated: shows exactly the five local-channel presets, no switch anywhere', async () => {
    renderScreen();
    await screen.findByTestId('layout-preset-picker');
    expect(screen.getAllByRole('button', { name: /fifty-fifty|side-by-side|cam-1|cam-2|separate-files/ })).toHaveLength(5);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText('Always on')).toBeInTheDocument();
  });

  it('applied preset selection follows the returned config, not the tapped card', async () => {
    renderScreen();
    await screen.findByTestId('layout-preset-picker');
    expect(screen.getByRole('button', { name: /fifty-fifty/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^cam-1/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('separate-files renders two outputs in its preview', async () => {
    const update = vi.fn(() => Promise.resolve({ ...localConfig, presetId: 'separate-files' }));
    renderScreen({ updateChannelConfig: update as never });
    await screen.findByTestId('layout-preset-picker');
    act(() => { screen.getByRole('button', { name: /separate-files/ }).click(); });
    await waitFor(() => expect(screen.getByRole('button', { name: /separate-files/ })).toHaveAttribute('aria-pressed', 'true'));
    const large = within(document.querySelector('.us-adm__streampreview')!);
    expect(large.getByTestId('layout-preview')).toHaveAttribute('data-kind', 'multi-file');
  });

  it('pending/U-4: shows Saving… on the tapped card only', async () => {
    let resolve!: (v: unknown) => void;
    const update = vi.fn(() => new Promise((r) => { resolve = r; }));
    renderScreen({ updateChannelConfig: update as never });
    await screen.findByTestId('layout-preset-picker');
    act(() => { screen.getByRole('button', { name: /^cam-1/ }).click(); });
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /^cam-1/ })).toHaveTextContent('Saving…');
    expect(screen.getByRole('button', { name: /side-by-side/ })).not.toHaveTextContent('Saving…');
    await act(async () => resolve({ ...localConfig, presetId: 'cam-1' }));
  });

  it('invalid preset: a preset whose required role is unbound is disabled with the named reason', async () => {
    renderScreen();
    await screen.findByTestId('layout-preset-picker');
    const invalid = screen.getByRole('button', { name: /cam-2/ });
    expect(invalid).toBeDisabled();
    expect(invalid).toHaveTextContent('Needs Students Camera, which is not connected.');
  });

  it('refused/U-5: shows the named refusal message', async () => {
    const problem = { status: 422, code: 'config.invalid' as const, title: 'This layout could not be applied.' };
    const update = vi.fn(() => Promise.reject(new ProblemError(problem)));
    renderScreen({ updateChannelConfig: update as never });
    await screen.findByTestId('layout-preset-picker');
    act(() => { screen.getByRole('button', { name: /^cam-1/ }).click(); });
    await waitFor(() => expect(screen.getByText('This layout could not be applied.')).toBeInTheDocument());
  });

  it('U-2: reconnecting disables the picker and explains why', async () => {
    renderScreen();
    await screen.findByTestId('layout-preset-picker');
    act(() => useWsStore.setState({ stale: true }));
    expect(screen.getByRole('button', { name: /^cam-1/ })).toBeDisabled();
    expect(screen.getByText(/Reconnecting/)).toBeInTheDocument();
  });
});
