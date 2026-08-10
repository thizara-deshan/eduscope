import { createElement, type ReactNode } from 'react';
import { act } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ProblemError } from '@eduscope/api-client';
import type { FirmwareUpdate } from '@eduscope/shared';
import { ClientContext } from '../../../client/client-provider.js';
import { useWsStore } from '../../../store/ws-store.js';
import { FirmwareScreen } from './firmware-screen.js';

const fw = (overrides: Partial<FirmwareUpdate> = {}): FirmwareUpdate => ({
  id: 'F1', currentVersion: '2026.1.3', availableVersion: null, state: 'idle',
  signatureVerified: true, rollbackVersion: '2026.1.2', startedAt: null, finishedAt: null,
  lastError: null,
  ...overrides,
});

function build(methods: Partial<EduscopeClient> = {}) {
  useWsStore.getState().reset();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const stub = {
    getFirmwareState: () => Promise.resolve(fw()),
    ...methods,
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider, { client: queryClient }, createElement(ClientContext.Provider, { value: stub, children }),
  );
  return render(createElement(FirmwareScreen), { wrapper });
}

describe('FirmwareScreen', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
  });

  it('loading: renders a skeleton', () => {
    build({ getFirmwareState: () => new Promise(() => {}) });
    expect(screen.getByTestId('firmware-skeleton')).toBeInTheDocument();
  });

  it('idle / up to date', async () => {
    build();
    await waitFor(() => expect(screen.getByTestId('firmware-up-to-date')).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Firmware Update' }).closest('.us-adm__pagehead')).not.toBeNull();
  });

  it('update available: version shown', async () => {
    build({ getFirmwareState: () => Promise.resolve(fw({ availableVersion: '2026.2.0' })) });
    await waitFor(() => expect(screen.getByTestId('firmware-update-available')).toHaveTextContent('2026.2.0'));
  });

  ([
    ['checking', 'firmware-checking'],
    ['downloading', 'firmware-downloading'],
    ['verifying', 'firmware-verifying'],
    ['applying', 'firmware-applying'],
  ] as const).forEach(([state, testId]) => {
    it(`${state}`, async () => {
      build({ getFirmwareState: () => Promise.resolve(fw({ state, availableVersion: '2026.2.0' })) });
      await waitFor(() => expect(screen.getByTestId(testId)).toBeInTheDocument());
    });
  });

  it('done: reboot-required is unmissable', async () => {
    build({ getFirmwareState: () => Promise.resolve(fw({ state: 'done', currentVersion: '2026.2.0', availableVersion: null })) });
    await waitFor(() => expect(screen.getByTestId('firmware-done')).toHaveTextContent(/reboot is required/));
  });

  it('failed: a loud, distinct message', async () => {
    build({ getFirmwareState: () => Promise.resolve(fw({ state: 'failed', lastError: 'Apply failed' })) });
    await waitFor(() => expect(screen.getByTestId('firmware-failed')).toHaveTextContent('Apply failed'));
  });

  it('signature failed: distinct from a generic failure', async () => {
    build({ getFirmwareState: () => Promise.resolve(fw({ state: 'failed', signatureVerified: false, lastError: 'Signature verification failed' })) });
    await waitFor(() => expect(screen.getByTestId('firmware-signature-failed')).toBeInTheDocument());
    expect(screen.queryByTestId('firmware-failed')).not.toBeInTheDocument();
  });

  it('rolled back: names the reason', async () => {
    build({ getFirmwareState: () => Promise.resolve(fw({ state: 'rolled-back', lastError: 'Reverted to the previous version' })) });
    await waitFor(() => expect(screen.getByTestId('firmware-rolled-back')).toHaveTextContent('Reverted to the previous version'));
  });

  it('refused while recording (409)', async () => {
    const applyFirmware = vi.fn(() => Promise.reject(
      new ProblemError({ status: 409, code: 'conflict', title: 'A lecture is in progress — firmware apply is refused while recording' }),
    ));
    build({
      getFirmwareState: () => Promise.resolve(fw({ availableVersion: '2026.2.0' })),
      applyFirmware,
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply update' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Apply update' }));
    await waitFor(() => expect(screen.getByTestId('firmware-refused')).toHaveTextContent(/refused while recording/));
  });

  it('U-2: Check/Apply disabled while stale', async () => {
    build();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check for updates' })).toBeInTheDocument());
    act(() => useWsStore.setState({ stale: true }));
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeDisabled();
  });
});
