import { createElement, type ReactNode } from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import type { SystemAlert } from '@eduscope/shared';
import { ClientContext } from '../client/client-provider.js';
import { useWsStore } from '../store/ws-store.js';
import '../styles/tokens.css';
import { AlertBanners } from './alert-banners.js';

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

function renderBanners(
  listAlerts: (...args: never[]) => Promise<unknown>,
  acknowledgeAlert: (...args: never[]) => Promise<unknown> = vi.fn(),
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const stub = { listAlerts, acknowledgeAlert } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(ClientContext.Provider, { value: stub, children }),
    );
  return render(createElement(AlertBanners), { wrapper });
}

describe('AlertBanners', () => {
  it('renders a banner per uncleared alert with title/detail verbatim from the payload', async () => {
    const alert = makeAlert({
      title: 'Storage at 82% of an 80% policy limit',
      detail: 'Older recordings will be deleted first.',
    });
    renderBanners(vi.fn(() => Promise.resolve({ items: [alert] })));
    await waitFor(() => expect(screen.getByTestId('alert-banner')).toBeInTheDocument());
    expect(screen.getByText('Storage at 82% of an 80% policy limit')).toBeInTheDocument();
    expect(screen.getByText('Older recordings will be deleted first.')).toBeInTheDocument();
  });

  it('maps each severity to its treatment; critical renders as error does', async () => {
    renderBanners(vi.fn(() => Promise.resolve({ items: [makeAlert({ severity: 'critical' })] })));
    await waitFor(() =>
      expect(screen.getByTestId('alert-banner').className).toContain('us-alertbanner--error'),
    );
  });

  it("an alert whose clearedAt is set does not render", async () => {
    renderBanners(
      vi.fn(() => Promise.resolve({ items: [makeAlert({ clearedAt: '2026-01-01T01:00:00.000Z' })] })),
    );
    await waitFor(() => expect(screen.getByTestId('alert-lane')).toBeInTheDocument());
    expect(screen.queryByTestId('alert-banner')).toBeNull();
  });

  it('acknowledge calls acknowledgeAlert with the alert id, once', async () => {
    const acknowledgeAlert = vi.fn(() => Promise.resolve(makeAlert()));
    renderBanners(vi.fn(() => Promise.resolve({ items: [makeAlert()] })), acknowledgeAlert);
    await waitFor(() => expect(screen.getByTestId('alert-banner')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Acknowledge/ }));
    expect(acknowledgeAlert).toHaveBeenCalledTimes(1);
    expect(acknowledgeAlert).toHaveBeenCalledWith('alert-1');
  });

  it('acknowledge actually hides the banner (INV-SA-1 "hide for now") even though the mock never sets clearedAt', async () => {
    // The mock's acknowledgeAlert only stamps acknowledgedBy — the re-fetched
    // listAlerts() would still return this alert forever, so dismissal must
    // be local UI state, not dependent on the server round-trip settling.
    const acknowledgeAlert = vi.fn(() => Promise.resolve(makeAlert()));
    renderBanners(vi.fn(() => Promise.resolve({ items: [makeAlert()] })), acknowledgeAlert);
    await waitFor(() => expect(screen.getByTestId('alert-banner')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Acknowledge/ }));
    await waitFor(() => expect(screen.queryByTestId('alert-banner')).toBeNull());
  });

  it("the lane's computed height is 56px with one banner and with three", async () => {
    renderBanners(vi.fn(() => Promise.resolve({ items: [makeAlert()] })));
    await waitFor(() => expect(screen.getByTestId('alert-banner')).toBeInTheDocument());
    expect(getComputedStyle(screen.getByTestId('alert-lane')).height).toBe('56px');

    const three = [
      makeAlert({ id: 'a' }),
      makeAlert({ id: 'b', severity: 'error' }),
      makeAlert({ id: 'c', severity: 'critical' }),
    ];
    renderBanners(vi.fn(() => Promise.resolve({ items: three })));
    await waitFor(() => expect(screen.getAllByTestId('alert-lane').length).toBeGreaterThan(0));
    const lanes = screen.getAllByTestId('alert-lane');
    expect(getComputedStyle(lanes[lanes.length - 1]!).height).toBe('56px');
  });

  it('the lane is position: absolute (never fixed)', async () => {
    renderBanners(vi.fn(() => Promise.resolve({ items: [makeAlert()] })));
    await waitFor(() => expect(screen.getByTestId('alert-banner')).toBeInTheDocument());
    expect(getComputedStyle(screen.getByTestId('alert-lane')).position).toBe('absolute');
  });

  it('cold render from listAlerts shows a banner before any WS event arrives (U-1)', async () => {
    renderBanners(vi.fn(() => Promise.resolve({ items: [makeAlert({ id: 'cold-1' })] })));
    await waitFor(() => expect(screen.getByTestId('alert-banner')).toBeInTheDocument());
    expect(screen.getByTestId('alert-banner')).toHaveAttribute('data-alert-id', 'cold-1');
  });

  it('an alert present in both the query and the store renders once', async () => {
    act(() => {
      useWsStore.getState().reset();
      useWsStore.setState({ alerts: { 'dup-1': makeAlert({ id: 'dup-1' }) } });
    });
    renderBanners(vi.fn(() => Promise.resolve({ items: [makeAlert({ id: 'dup-1' })] })));
    await waitFor(() => expect(screen.getByTestId('alert-banner')).toBeInTheDocument());
    expect(screen.getAllByTestId('alert-banner')).toHaveLength(1);
    useWsStore.getState().reset();
  });
});
