import { createElement, type ReactNode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import type { SystemAlert } from '@eduscope/shared';
import { ClientContext } from '../client/client-provider.js';
import { useWsStore } from '../store/ws-store.js';
import '../styles/tokens.css';
import { useAlertSuppression } from './alert-suppression.js';
import { NotificationCenter } from './notification-center.js';

function makeAlert(overrides: Partial<SystemAlert> = {}): SystemAlert {
  return {
    id: 'alert-1',
    code: 'storage.warning',
    severity: 'warning',
    category: 'System',
    title: 'Storage at 82% — recordings may be trimmed soon',
    detail: null,
    raisedAt: '2026-01-01T00:00:00.000Z',
    clearedAt: null,
    clearedReason: null,
    acknowledgedBy: null,
    context: null,
    relatedEntity: null,
    ...overrides,
  };
}

function renderNotifications(
  alerts: readonly SystemAlert[],
  acknowledgeAlert = vi.fn(() => Promise.resolve()),
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = {
    listAlerts: vi.fn(() => Promise.resolve({ items: alerts })),
    acknowledgeAlert,
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(ClientContext.Provider, { value: client, children }),
  );
  return render(<NotificationCenter />, { wrapper });
}

describe('NotificationCenter', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
    for (const code of useAlertSuppression.getState().codes) {
      useAlertSuppression.getState().release(code);
    }
  });

  it('shows a count and reveals all active alerts in severity order', async () => {
    const warning = makeAlert({ id: 'warning', title: 'Storage warning' });
    const critical = makeAlert({ id: 'critical', severity: 'critical', title: 'Firmware failed' });
    renderNotifications([warning, critical]);
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 2 active' }));
    const cards = screen.getAllByTestId('notification-card');
    expect(cards[0]).toHaveTextContent('Firmware failed');
    expect(cards[1]).toHaveTextContent('Storage warning');
  });

  it('acknowledges and locally removes one notification', async () => {
    const warning = makeAlert({ title: 'Storage warning' });
    const acknowledgeAlert = vi.fn(() => Promise.resolve());
    renderNotifications([warning], acknowledgeAlert);
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 active' }));
    await userEvent.click(screen.getByRole('button', { name: 'Acknowledge Storage warning' }));
    expect(acknowledgeAlert).toHaveBeenCalledWith(warning.id);
    expect(screen.queryByTestId('notification-card')).toBeNull();
  });

  it('closes on Escape and restores focus to the trigger', async () => {
    renderNotifications([makeAlert()]);
    const trigger = await screen.findByRole('button', { name: /Notifications, 1 active/ });
    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('merges query and live alerts without duplicates and hides suppressed codes', async () => {
    const duplicate = makeAlert({ id: 'duplicate' });
    act(() => useWsStore.setState({ alerts: { duplicate } }));
    renderNotifications([duplicate]);
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 active' }));
    expect(screen.getAllByTestId('notification-card')).toHaveLength(1);

    act(() => useAlertSuppression.getState().suppress(duplicate.code));
    await waitFor(() => expect(screen.queryByTestId('notification-card')).toBeNull());
  });

  it('renders server-provided title and detail verbatim', async () => {
    renderNotifications([makeAlert({ title: 'Firmware signature invalid', detail: 'The update was not applied.' })]);
    await userEvent.click(await screen.findByRole('button', { name: /Notifications, 1 active/ }));
    expect(screen.getByText('Firmware signature invalid')).toBeInTheDocument();
    expect(screen.getByText('The update was not applied.')).toBeInTheDocument();
  });
});
