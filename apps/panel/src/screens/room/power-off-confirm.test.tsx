import { createElement, type ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import type { User } from '@eduscope/shared';
import { AuthProvider } from '../../auth/auth-context.js';
import { ClientContext } from '../../client/client-provider.js';
import { OverlayProvider } from '../../overlays/overlay-host.js';
import { useAlertSuppression } from '../../shell/alert-suppression.js';
import '../../styles/tokens.css';
import { PowerOffConfirm } from './power-off-confirm.js';
import {
  POWEROFF_BLOCKED_REASON, type PowerOffState, usePowerOff,
} from './use-power-off.js';

vi.mock('./use-power-off.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./use-power-off.js')>();
  return { ...actual, usePowerOff: vi.fn() };
});

const confirm = vi.fn();
const retry = vi.fn();
const user: User = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', username: 'a.perera', displayName: 'A. Perera',
  role: 'lecturer', source: 'institute', mustResetPassword: false, disabled: false,
  lastLoginAt: null, createdAt: '2026-01-01T00:00:00.000Z',
};

function renderConfirm(state: PowerOffState) {
  vi.mocked(usePowerOff).mockReturnValue({ state, confirm, retry });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(['provisioning'], {
    hallDisplayName: 'Hall A', featureFlags: { aiQuizEnabled: false }, llmEndpoint: null,
  });
  const client = {} as EduscopeClient;
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
  return render(
    <>
      <section id="recording-transport" tabIndex={-1}>Transport target</section>
      <PowerOffConfirm />
    </>,
    { wrapper },
  );
}

describe('PowerOffConfirm', () => {
  beforeEach(() => {
    confirm.mockReset();
    retry.mockReset();
    useAlertSuppression.getState().release('poweroff.refused');
  });

  it('renders the inherited confirm with the room-specific consequence', () => {
    renderConfirm({ kind: 'confirm' });
    expect(screen.getByRole('alertdialog', { name: 'Power off this device?' })).toBeInTheDocument();
    expect(screen.getByText('Hall A · Eduscope recording panel')).toBeInTheDocument();
    expect(screen.getByText(/Someone has to press the power button in this room/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Power off' }));
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('locks both buttons and names pending without closing the dialog', () => {
    renderConfirm({ kind: 'pending' });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Powering off…' })).toBeDisabled();
  });

  it('uses the one blocked constant and replaces destruction with the S-07 jump', async () => {
    renderConfirm({ kind: 'refused-recording' });
    expect(screen.getByTestId('danger-message')).toHaveTextContent(POWEROFF_BLOCKED_REASON);
    expect(screen.queryByRole('button', { name: 'Power off' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Go to the lecture' }));
    await waitFor(() => expect(document.getElementById('recording-transport')).toHaveFocus());
  });

  it('renders another Problem title and replaces destruction with Close', () => {
    renderConfirm({ kind: 'refused-other', title: 'The power controller is unavailable.' });
    expect(screen.getByTestId('danger-message')).toHaveTextContent('The power controller is unavailable.');
    expect(screen.queryByRole('button', { name: 'Power off' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('renders accepted as the assertive terminal dead end', () => {
    renderConfirm({ kind: 'accepted' });
    const terminal = screen.getByRole('alert');
    expect(terminal).toHaveAttribute('aria-live', 'assertive');
    expect(terminal).toHaveTextContent('Shutting down');
    expect(terminal).toHaveTextContent('Hall A · Eduscope recording panel');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders one explicit Try again when the accepted device does not halt', () => {
    renderConfirm({ kind: 'accepted-not-halted' });
    expect(screen.getByText('The device has not shut down yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('suppresses the requester banner for the overlay lifetime only', () => {
    const view = renderConfirm({ kind: 'confirm' });
    expect(useAlertSuppression.getState().codes).toContain('poweroff.refused');
    view.unmount();
    expect(useAlertSuppression.getState().codes).not.toContain('poweroff.refused');
  });
});
