import { createElement, Fragment, type ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import type { RecordingStatePayload, User } from '@eduscope/shared';
import { AuthProvider } from '../../auth/auth-context.js';
import { ClientContext } from '../../client/client-provider.js';
import { OverlayHost, OverlayProvider } from '../../overlays/overlay-host.js';
import { useWsStore } from '../../store/ws-store.js';
import { PowerOffRow } from './power-off-row.js';
import { POWEROFF_BLOCKED_REASON } from './use-power-off.js';

const me: User = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', username: 'a.perera', displayName: 'A. Perera',
  role: 'lecturer', source: 'institute', mustResetPassword: false, disabled: false,
  lastLoginAt: null, createdAt: '2026-01-01T00:00:00.000Z',
};
const recording = (state: RecordingStatePayload['state']): RecordingStatePayload => ({
  state, startReason: state === 'idle' ? null : 'initial', sessionId: state === 'idle' ? null : me.id,
  title: state === 'idle' ? null : 'Lecture', ownerUserId: state === 'idle' ? null : me.id,
  ownerDisplayName: state === 'idle' ? null : me.displayName,
  startedAt: state === 'idle' ? null : '2026-08-05T10:00:00Z', recordedDurationMs: 0,
  segmentIndex: null, segmentCount: null, pauseCount: null, takeoverBy: null,
  takeoverAt: null, takeoverByDisplayName: null, errorCode: null, errorMessage: null,
});

function renderRow(options: { state?: RecordingStatePayload['state'] | null; stale?: boolean } = {}) {
  useWsStore.getState().reset();
  useWsStore.setState({
    recording: options.state === null ? null : recording(options.state ?? 'idle'),
    stale: options.stale ?? false,
  });
  const powerOffDevice = vi.fn(() => Promise.resolve({
    commandId: me.id, acceptedAt: '2026-08-05T10:00:00Z', resolveBySec: 10,
  }));
  const client = {
    powerOffDevice,
    getProvisioning: vi.fn(() => Promise.resolve({
      hallDisplayName: 'Hall A', featureFlags: { aiQuizEnabled: false }, llmEndpoint: null,
    })),
  } as unknown as EduscopeClient;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(['provisioning'], {
    hallDisplayName: 'Hall A', featureFlags: { aiQuizEnabled: false }, llmEndpoint: null,
  });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(ClientContext.Provider, { value: client },
      createElement(AuthProvider, {
        initialUser: me,
        children: createElement(MemoryRouter, null,
          createElement(OverlayProvider, null,
            createElement(Fragment, null,
              children,
              <section id="recording-transport" tabIndex={-1}>Transport target</section>,
              createElement(OverlayHost),
            ))),
      })),
  );
  return { ...render(<PowerOffRow />, { wrapper }), powerOffDevice };
}

describe('PowerOffRow', () => {
  it('renders the available quiet entry without issuing the command', () => {
    const view = renderRow();
    const button = screen.getByRole('button', { name: 'Power off' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(screen.getByRole('alertdialog', { name: 'Power off this device?' })).toBeInTheDocument();
    expect(view.powerOffDevice).not.toHaveBeenCalled();
  });

  it.each(['starting', 'recording', 'paused', 'stopping', 'finalizing'] as const)(
    'blocks the entry with one inline reason while recording is %s',
    (state) => {
      renderRow({ state });
      const button = screen.getByRole('button', { name: 'Power off' });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-disabled', 'true');
      const reason = screen.getByText(POWEROFF_BLOCKED_REASON);
      expect(button).toHaveAttribute('aria-describedby', reason.id);
      expect(screen.getByRole('button', { name: 'Go to the lecture' })).toBeEnabled();
    },
  );

  it('focuses the stable S-07 target from the blocked remedy', () => {
    renderRow({ state: 'recording' });
    fireEvent.click(screen.getByRole('button', { name: 'Go to the lecture' }));
    expect(document.getElementById('recording-transport')).toHaveFocus();
  });

  it('renders the disconnected entry with its fixed reason', () => {
    renderRow({ stale: true });
    const button = screen.getByRole('button', { name: 'Power off' });
    expect(button).toBeDisabled();
    expect(screen.getByText('Not connected — you cannot power off right now.')).toBeInTheDocument();
  });

  it('keeps the entry disabled during cold load', () => {
    renderRow({ state: null });
    expect(screen.getByRole('button', { name: 'Power off' })).toBeDisabled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('opens a non-dismissible overlay', () => {
    renderRow();
    fireEvent.click(screen.getByRole('button', { name: 'Power off' }));
    fireEvent.keyDown(screen.getByTestId('overlay-host'), { key: 'Escape' });
    expect(screen.getByRole('alertdialog', { name: 'Power off this device?' })).toBeInTheDocument();
  });
});
