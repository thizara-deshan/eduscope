import { createElement, type ReactNode } from 'react';
import { act } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ProblemError } from '@eduscope/api-client';
import type { EncoderCapabilities, EncodingProfile } from '@eduscope/shared';
import { ClientContext } from '../../../client/client-provider.js';
import { useWsStore } from '../../../store/ws-store.js';
import { EncoderScreen } from './encoder-screen.js';

const profile = (overrides: Partial<EncodingProfile> = {}): EncodingProfile => ({
  id: 'E1', scope: 'device-default', channelId: null, videoBitrateKbps: 4000, framerate: 30,
  gop: 60, rateControl: 'cbr', codec: 'h264', container: 'mpegts', audioCodec: 'aac',
  audioBitrateKbps: 128, capabilityVerifiedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const capabilities: EncoderCapabilities = {
  videoBitrateKbps: { min: 2000, max: 8000 },
  framerates: [24, 25, 30],
  gops: [30, 60, 90],
  rateControls: ['cbr', 'vbr'],
  codecs: ['h264'],
  audioBitratesKbps: [96, 128, 192],
};

function build(methods: Partial<EduscopeClient> = {}) {
  useWsStore.getState().reset();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const stub = {
    getEncoderSettings: () => Promise.resolve({ profile: profile(), capabilities }),
    ...methods,
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider, { client: queryClient }, createElement(ClientContext.Provider, { value: stub, children }),
  );
  return render(createElement(EncoderScreen), { wrapper });
}

describe('EncoderScreen', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
  });

  it('loading: renders a skeleton', () => {
    build({ getEncoderSettings: () => new Promise(() => {}) });
    expect(screen.getByTestId('encoder-skeleton')).toBeInTheDocument();
  });

  it('populated: only h264 is offered — no H.265/AV1 option renders', async () => {
    build();
    await waitFor(() => expect(screen.getByText('h264')).toBeInTheDocument());
    expect(screen.queryByText(/h265|hevc|av1/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('bitrate-readout')).toHaveTextContent('4000 kbps');
  });

  it('dirty: moving the bitrate stepper marks it dirty and shows the applies-next-session notice', async () => {
    build();
    await waitFor(() => expect(screen.getByTestId('bitrate-readout')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Increase bitrate' }));
    expect(screen.getByTestId('bitrate-readout')).toHaveTextContent('4250 kbps');
    expect(screen.getByText(/never applies mid-lecture/)).toBeInTheDocument();
  });

  it('saving: Save calls updateEncoderSettings', async () => {
    const updateEncoderSettings = vi.fn(() => Promise.resolve(profile({ videoBitrateKbps: 4250 })));
    build({ updateEncoderSettings });
    await waitFor(() => expect(screen.getByTestId('bitrate-readout')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Increase bitrate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateEncoderSettings).toHaveBeenCalledWith({ videoBitrateKbps: 4250 }));
  });

  it('save rejected (422): the offending field is flagged and the value is not applied', async () => {
    const updateEncoderSettings = vi.fn(() => Promise.reject(
      new ProblemError({ status: 422, code: 'validation.invalid', title: "Bitrate is outside the encoder's capabilities" }),
    ));
    build({ updateEncoderSettings });
    await waitFor(() => expect(screen.getByTestId('bitrate-readout')).toBeInTheDocument());
    for (let i = 0; i < 20; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Increase bitrate' }));
    }
    expect(screen.getByTestId('bitrate-readout')).toHaveTextContent('9000 kbps');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText("Bitrate is outside the encoder's capabilities.")).toBeInTheDocument());
    // The server truth (profile.videoBitrateKbps) was never overwritten by the rejected value.
    expect(updateEncoderSettings).toHaveBeenCalledWith({ videoBitrateKbps: 9000 });
  });

  it('U-2: Save is disabled while stale', async () => {
    build();
    await waitFor(() => expect(screen.getByTestId('bitrate-readout')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Increase bitrate' }));
    act(() => useWsStore.setState({ stale: true }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
