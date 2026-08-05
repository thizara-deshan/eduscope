import { createElement, Fragment, type ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import type { User } from '@eduscope/shared';
import { AuthProvider } from '../../auth/auth-context.js';
import { ClientContext } from '../../client/client-provider.js';
import { OverlayHost, OverlayProvider } from '../../overlays/overlay-host.js';
import { useWsStore } from '../../store/ws-store.js';
import '../../styles/tokens.css';
import { RoomControlsBar } from './room-controls-bar.js';

const owner: User = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', username: 'a.perera', displayName: 'A. Perera',
  role: 'lecturer', source: 'institute', mustResetPassword: false, disabled: false,
  lastLoginAt: null, createdAt: '2026-01-01T00:00:00.000Z',
};
const admin: User = { ...owner, role: 'admin', username: 'admin', displayName: 'Administrator' };

function renderBar(viewer: User = owner, recordingState: 'idle' | 'recording' = 'idle') {
  useWsStore.getState().reset();
  useWsStore.setState({
    recording: {
      state: recordingState, startReason: recordingState === 'idle' ? null : 'initial',
      sessionId: recordingState === 'idle' ? null : owner.id,
      title: recordingState === 'idle' ? null : 'Lecture',
      ownerUserId: recordingState === 'idle' ? null : owner.id,
      ownerDisplayName: recordingState === 'idle' ? null : owner.displayName,
      startedAt: recordingState === 'idle' ? null : '2026-08-05T10:00:00Z',
      recordedDurationMs: null, segmentIndex: null, segmentCount: null, pauseCount: null,
      takeoverBy: null, takeoverAt: null, takeoverByDisplayName: null,
      errorCode: null, errorMessage: null,
    },
    audioControls: {
      'mic-lecturer': {
        roleId: 'mic-lecturer', gain: 50, muted: false,
        appliedState: 'applied', lastError: null,
      },
    },
    sources: {
      'mic-lecturer': {
        roleId: 'mic-lecturer', state: 'online', detail: null,
        since: '2026-08-05T10:00:00Z', inputId: null,
      },
    },
  });
  const client = {
    updateAudioControl: vi.fn(() => Promise.resolve({ resolveBySec: 2 })),
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    ClientContext.Provider,
    { value: client },
    createElement(AuthProvider, {
      initialUser: viewer,
      children: createElement(MemoryRouter, { initialEntries: ['/'] },
        createElement(OverlayProvider, null,
          createElement(Fragment, null,
            createElement(Routes, null,
              createElement(Route, { path: '/', element: children }),
              createElement(Route, { path: '/advanced', element: <div>Advanced destination</div> }),
            ),
            createElement(OverlayHost),
          ))),
    }),
  );
  return render(<RoomControlsBar />, { wrapper });
}

describe('RoomControlsBar', () => {
  it('defaults to the collapsed 54px head', () => {
    renderBar();
    const bar = screen.getByTestId('room-controls-bar');
    expect(getComputedStyle(bar).height).toBe('54px');
    expect(screen.getByRole('button', { name: 'Show controls' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'MICROPHONE' })).toBeNull();
  });

  it('expands to exactly 168px with three structurally separate regions', async () => {
    renderBar();
    await userEvent.click(screen.getByRole('button', { name: 'Show controls' }));
    const bar = screen.getByTestId('room-controls-bar');
    expect(getComputedStyle(bar).height).toBe('168px');
    expect(screen.getByRole('region', { name: 'MICROPHONE' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'POWER' }))
      .getByRole('button', { name: 'Power off' })).toBeEnabled();
    expect(screen.getByRole('region', { name: 'NOT CONNECTED' })).toBeInTheDocument();
  });

  it('uses the approved 194px safety envelope when the power row carries a reason', async () => {
    renderBar(owner, 'recording');
    await userEvent.click(screen.getByRole('button', { name: 'Show controls' }));
    expect(getComputedStyle(screen.getByTestId('room-controls-bar')).height).toBe('194px');
    expect(screen.getByText('This device is recording — stop the lecture first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to the lecture' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Power off' })).toBeDisabled();
  });

  it.each([
    ['lecturer', owner],
    ['administrator', admin],
  ])('shows Advanced to the %s and navigates to the shared destination', async (_label, viewer) => {
    renderBar(viewer);
    await userEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    expect(screen.getByText('Advanced destination')).toBeInTheDocument();
  });

  it('is not in the tab order: the expanded bar reaches exactly four targets', async () => {
    const user = userEvent.setup();
    renderBar();
    await user.click(screen.getByRole('button', { name: 'Show controls' }));
    (document.activeElement as HTMLElement | null)?.blur();
    const stops: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      await user.tab();
      stops.push((document.activeElement as HTMLElement).getAttribute('aria-label')
        ?? document.activeElement?.textContent?.trim()
        ?? '');
    }
    expect(stops).toEqual(['Advanced', 'Collapse', 'Lecturer Mic', 'Power off']);
    const bar = screen.getByTestId('room-controls-bar');
    expect(within(bar).queryByRole('button', { name: /projector|screen|speaker|lights|air/i })).toBeNull();
  });
});
