import { createElement, Fragment, type ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient, PreviewChannel } from '@eduscope/api-client';
import type { SourceHealthState, SourceRole, SourceStatus, User } from '@eduscope/shared';
import { AuthProvider } from '../../auth/auth-context.js';
import { ClientContext } from '../../client/client-provider.js';
import { OverlayHost, OverlayProvider } from '../../overlays/overlay-host.js';
import { useWsStore } from '../../store/ws-store.js';
import '../../styles/tokens.css';
import { SourcesBar, VIDEO_ROLE_ORDER } from './sources-bar.js';

const user: User = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', username: 'a.perera', displayName: 'A. Perera',
  role: 'lecturer', source: 'institute', mustResetPassword: false, disabled: false,
  lastLoginAt: null, createdAt: '2026-01-01T00:00:00.000Z',
};
const roles: SourceRole[] = [
  { id: 'students-cam', medium: 'video', displayLabel: 'Students Camera', requiredForStart: false, provisionable: true },
  { id: 'lecturer-cam', medium: 'video', displayLabel: 'Lecturer Camera', requiredForStart: true, provisionable: true },
  { id: 'presentation', medium: 'video', displayLabel: 'Presentation', requiredForStart: true, provisionable: true },
  { id: 'mic-room', medium: 'audio', displayLabel: 'Room Mic', requiredForStart: false, provisionable: false },
];
const statuses = (states: SourceHealthState[] = ['offline', 'degraded', 'online']): SourceStatus[] => [
  { roleId: 'students-cam', state: states[0]!, detail: null, since: '2026-08-05T10:00:00Z', inputId: null },
  { roleId: 'lecturer-cam', state: states[1]!, detail: null, since: '2026-08-05T10:00:00Z', inputId: null },
  { roleId: 'presentation', state: states[2]!, detail: null, since: '2026-08-05T10:00:00Z', inputId: null },
  { roleId: 'mic-room', state: 'unbound', detail: null, since: '2026-08-05T10:00:00Z', inputId: null },
];

function renderBar(options: { pending?: boolean; states?: SourceHealthState[] } = {}) {
  useWsStore.getState().reset();
  useWsStore.setState({ recording: null, stale: false });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const never = () => new Promise<never>(() => undefined);
  const channel: PreviewChannel = {
    send: vi.fn(), close: vi.fn(), messages$: { subscribe: () => () => undefined },
  };
  const openPreview = vi.fn(() => channel);
  const client = {
    listSourceRoles: vi.fn(options.pending ? never : () => Promise.resolve(roles)),
    getSourcesStatus: vi.fn(options.pending ? never : () => Promise.resolve(statuses(options.states))),
    openPreview,
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(ClientContext.Provider, { value: client },
      createElement(AuthProvider, {
        initialUser: user,
        children: createElement(OverlayProvider, null,
          createElement(Fragment, null, children, createElement(OverlayHost))),
      })),
  );
  return { ...render(<SourcesBar />, { wrapper }), openPreview };
}

describe('SourcesBar', () => {
  it('defaults to a 54px collapsed bar with three state-coloured dots', async () => {
    renderBar();
    const bar = screen.getByTestId('sources-bar');
    expect(getComputedStyle(bar).height).toBe('54px');
    expect(screen.getAllByTestId('source-dot')).toHaveLength(3);
    expect(screen.queryByTestId('source-tile')).toBeNull();
    await waitFor(() => expect(screen.getAllByTestId('source-dot')[0]).toHaveAttribute('data-state', 'online'));
  });

  it('keeps the expanded bar within the approved 154px envelope', () => {
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Show sources' }));
    expect(getComputedStyle(screen.getByTestId('sources-bar')).height).toBe('154px');
  });

  it('renders the three video roles in semantic order regardless of REST order', async () => {
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Show sources' }));
    await waitFor(() => expect(screen.getAllByTestId('source-tile')).toHaveLength(3));
    expect(screen.getAllByTestId('source-tile').map((tile) => tile.dataset.role))
      .toEqual([...VIDEO_ROLE_ORDER]);
  });

  it('renders pending-query tiles as unknown rather than empty boxes', () => {
    renderBar({ pending: true });
    fireEvent.click(screen.getByRole('button', { name: 'Show sources' }));
    expect(screen.getAllByTestId('source-tile')).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: 'checking…' })).toHaveLength(3);
  });

  it('lets a WS unknown event outrank the REST healthy value', async () => {
    renderBar({ states: ['online', 'online', 'online'] });
    fireEvent.click(screen.getByRole('button', { name: 'Show sources' }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Live' })).toHaveLength(3));
    act(() => useWsStore.setState({ sources: {
      presentation: {
        roleId: 'presentation', state: 'unknown', detail: null,
        since: '2026-08-05T10:00:01Z', inputId: null,
      },
    } }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'checking…' })).toBeDisabled());
    expect(screen.getAllByTestId('source-tile')).toHaveLength(3);
  });

  it('opens the shared S-10 lightbox from an online role tile', async () => {
    const view = renderBar({ states: ['online', 'online', 'online'] });
    fireEvent.click(screen.getByRole('button', { name: 'Show sources' }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Live' })).toHaveLength(3));
    const presentation = screen.getAllByTestId('source-tile')
      .find((tile) => tile.dataset.role === 'presentation');
    fireEvent.click(presentation!);
    expect(screen.getByRole('dialog', { name: 'Presentation preview' })).toBeInTheDocument();
    expect(view.openPreview).toHaveBeenCalledTimes(1);
  });
});
