import { createElement, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ClientContext } from '../../client/client-provider.js';
import { useWsStore } from '../../store/ws-store.js';
import { CaptureDiskRow } from './capture-disk-row.js';

function renderDisk(maxAgeDays: number, dense = false) {
  useWsStore.getState().reset();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = { getStorageOverview: vi.fn(() => Promise.resolve({
    pressure: 'ok', freeBytes: 418_000_000_000, totalBytes: 1_800_000_000_000,
    volumes: [], policy: {
      maxAgeDays, warningThresholdPct: 70, criticalThresholdPct: 85,
      earlyDeleteOrder: 'uploaded-oldest-first', neverDeleteUnuploaded: true,
      refuseStartWhenCritical: true,
    },
  })) } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(ClientContext.Provider, { value: client }, children),
  );
  return render(<CaptureDiskRow dense={dense} />, { wrapper });
}

describe('CaptureDiskRow', () => {
  it('generates retention policy copy from maxAgeDays', async () => {
    const first = renderDisk(14);
    expect(await screen.findByText('Recordings are deleted 14 days after they upload.')).toBeInTheDocument();
    first.unmount();
    renderDisk(30);
    expect(await screen.findByText('Recordings are deleted 30 days after they upload.')).toBeInTheDocument();
  });

  it('shows bytes rather than hours and preserves both facts when dense', async () => {
    renderDisk(14, true);
    await screen.findByText(/418 GB free of 1\.8 TB/i);
    const row = screen.getByTestId('capture-disk');
    expect(row).toHaveTextContent(/418 GB free of 1\.8 TB/i);
    expect(row).toHaveTextContent(/deleted 14 days after they upload/i);
    expect(row.textContent).not.toMatch(/\d+\s*h\b/i);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});
