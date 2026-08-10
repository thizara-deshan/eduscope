import { createElement, type ReactNode } from 'react';
import { act } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import type { NetworkConfig, PhysicalInput, SourceBinding } from '@eduscope/shared';
import { ClientContext } from '../../../client/client-provider.js';
import { useWsStore } from '../../../store/ws-store.js';
import { NetworkScreen } from './network-screen.js';

const lan = (overrides: Partial<NetworkConfig> = {}): NetworkConfig => ({
  id: 'N1', interfaceName: 'eth0', kind: 'lan', vlanId: null, addressMode: 'static',
  ipv4Address: '10.20.4.12', prefixLength: 24, gateway: '10.20.4.1', dnsServers: ['10.20.0.53'],
  appliedAt: '2026-01-01T00:00:00Z', lastApplyError: null,
  ...overrides,
});

const vlan = (overrides: Partial<NetworkConfig> = {}): NetworkConfig => ({
  id: 'N2', interfaceName: 'eth0.100', kind: 'vlan', vlanId: 100, addressMode: 'dhcp',
  ipv4Address: null, prefixLength: null, gateway: null, dnsServers: [],
  appliedAt: null, lastApplyError: null,
  ...overrides,
});

const cameraInput = (overrides: Partial<PhysicalInput> = {}): PhysicalInput => ({
  id: 'CAM1', kind: 'rtsp', address: '192.168.1.50', credentialRef: null, transport: 'tcp',
  expectedCodec: null, stableIdentifier: null, presenceState: 'present', lastSeenAt: null,
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const binding = (overrides: Partial<SourceBinding> = {}): SourceBinding => ({
  roleId: 'lecturer-cam', physicalInputId: 'CAM1', enabled: true, updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

function build(methods: Partial<EduscopeClient> = {}) {
  useWsStore.getState().reset();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const stub = {
    listNetworkConfigs: () => Promise.resolve([lan(), vlan()]),
    listPhysicalInputs: () => Promise.resolve([cameraInput()]),
    listSourceBindings: () => Promise.resolve([binding()]),
    ...methods,
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider, { client: queryClient }, createElement(ClientContext.Provider, { value: stub, children }),
  );
  return render(createElement(NetworkScreen), { wrapper });
}

describe('NetworkScreen', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
  });

  it('loading: renders a skeleton', () => {
    build({ listNetworkConfigs: () => new Promise(() => {}) });
    expect(screen.getByTestId('network-skeleton')).toBeInTheDocument();
  });

  it('populated: LAN, vLAN and camera cards render', async () => {
    build();
    await waitFor(() => expect(screen.getByLabelText('eth0 (lan)')).toBeInTheDocument());
    expect(screen.getByLabelText('eth0.100 (vlan)')).toBeInTheDocument();
    expect(screen.getByTestId('camera-lecturer-cam')).toBeInTheDocument();
  });

  it('dirty and validating: an invalid IP disables Apply and shows the reason', async () => {
    build();
    await waitFor(() => expect(screen.getByLabelText('eth0 (lan)')).toBeInTheDocument());
    const octet1 = screen.getByLabelText('IPv4 address octet 1');
    act(() => { (octet1 as HTMLInputElement).focus(); });
    await act(async () => {
      (octet1 as HTMLInputElement).dispatchEvent(new Event('input', { bubbles: true }));
    });
    // Directly simulate a bad value via fireEvent-like change
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(octet1, { target: { value: '999' } });
    const applyButtons = screen.getAllByRole('button', { name: 'Apply' });
    expect(screen.getByText('Enter a valid IPv4 address.')).toBeInTheDocument();
    expect(applyButtons[0]).toBeDisabled();
  });

  it('applying -> applied: apply issues the command and the row re-reads with a new appliedAt', async () => {
    const { fireEvent } = await import('@testing-library/react');
    let applyCount = 0;
    const updateNetworkConfig = vi.fn(() => {
      applyCount += 1;
      return Promise.resolve({ commandId: 'c1', acceptedAt: '2026-01-01T00:00:00Z', resolveBySec: 10 });
    });
    build({
      updateNetworkConfig,
      listNetworkConfigs: () => Promise.resolve([
        applyCount === 0 ? lan() : lan({ ipv4Address: '10.20.4.20', appliedAt: '2026-01-02T00:00:00Z' }),
        vlan(),
      ]),
    });
    await waitFor(() => expect(screen.getByLabelText('eth0 (lan)')).toBeInTheDocument());
    const octet4 = screen.getByLabelText('IPv4 address octet 4');
    fireEvent.change(octet4, { target: { value: '20' } });
    const [lanApply] = screen.getAllByRole('button', { name: 'Apply' });
    fireEvent.click(lanApply!);
    await waitFor(() => expect(updateNetworkConfig).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/applied 1\/2\/2026/)).toBeInTheDocument());
  });

  it('apply failed: lastApplyError readback shows, prior config stays', async () => {
    const { fireEvent } = await import('@testing-library/react');
    const updateNetworkConfig = vi.fn(() => Promise.resolve({ commandId: 'c1', acceptedAt: '2026-01-01T00:00:00Z', resolveBySec: 10 }));
    build({
      updateNetworkConfig,
      listNetworkConfigs: () => Promise.resolve([
        lan({ lastApplyError: 'Interface did not come back up; previous config kept.' }),
        vlan(),
      ]),
    });
    await waitFor(() => expect(screen.getByLabelText('eth0 (lan)')).toBeInTheDocument());
    const octet4 = screen.getByLabelText('IPv4 address octet 4');
    fireEvent.change(octet4, { target: { value: '20' } });
    const [lanApply] = screen.getAllByRole('button', { name: 'Apply' });
    fireEvent.click(lanApply!);
    await waitFor(() => expect(screen.getByText(/previous config kept/)).toBeInTheDocument());
    expect(screen.getByLabelText('eth0 (lan)')).toBeInTheDocument();
  });

  it('self-lockout warning: editing the LAN address surfaces the warning', async () => {
    const { fireEvent } = await import('@testing-library/react');
    build();
    await waitFor(() => expect(screen.getByLabelText('eth0 (lan)')).toBeInTheDocument());
    const octet4 = screen.getByLabelText('IPv4 address octet 4');
    fireEvent.change(octet4, { target: { value: '99' } });
    expect(screen.getByText(/can disconnect this panel/)).toBeInTheDocument();
  });

  it('camera rebind: tile reads unknown then online after the mock re-probe', async () => {
    build();
    await waitFor(() => expect(screen.getByTestId('camera-lecturer-cam')).toBeInTheDocument());
    act(() => useWsStore.getState().ingest({
      event: 'sources.status', at: '2026-01-01T00:00:00+00:00', seq: 1,
      payload: { roleId: 'lecturer-cam', state: 'unknown' },
    } as never));
    expect(screen.getByTestId('camera-lecturer-cam')).toHaveTextContent('unknown');
    act(() => useWsStore.getState().ingest({
      event: 'sources.status', at: '2026-01-01T00:00:01+00:00', seq: 2,
      payload: { roleId: 'lecturer-cam', state: 'online' },
    } as never));
    expect(screen.getByTestId('camera-lecturer-cam')).toHaveTextContent('online');
  });

  it('no-Wi-Fi: no element labelled SSID/Wi-Fi exists (structural)', async () => {
    build();
    await waitFor(() => expect(screen.getByLabelText('eth0 (lan)')).toBeInTheDocument());
    expect(screen.queryByLabelText(/wi-?fi/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/ssid/i)).not.toBeInTheDocument();
  });

  it('U-2: Apply is disabled while stale', async () => {
    const { fireEvent } = await import('@testing-library/react');
    build();
    await waitFor(() => expect(screen.getByLabelText('eth0 (lan)')).toBeInTheDocument());
    const octet4 = screen.getByLabelText('IPv4 address octet 4');
    fireEvent.change(octet4, { target: { value: '20' } });
    act(() => useWsStore.setState({ stale: true }));
    const [lanApply] = screen.getAllByRole('button', { name: 'Apply' });
    expect(lanApply).toBeDisabled();
  });
});
