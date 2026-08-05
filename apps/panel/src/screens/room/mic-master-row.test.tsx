import { act, createElement, type ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import type { AudioControlPayload, SourcesStatusPayload, User } from '@eduscope/shared';
import { AuthProvider } from '../../auth/auth-context.js';
import { ClientContext } from '../../client/client-provider.js';
import { useWsStore } from '../../store/ws-store.js';
import { MicRow } from '../sources/mic-row.js';
import { MicMasterRow } from './mic-master-row.js';

const OWNER_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const OTHER_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const owner: User = {
  id: OWNER_ID, username: 'a.perera', displayName: 'A. Perera', role: 'lecturer',
  source: 'institute', mustResetPassword: false, disabled: false,
  lastLoginAt: null, createdAt: '2026-01-01T00:00:00.000Z',
};
const other: User = { ...owner, id: OTHER_ID, username: 'n.silva', displayName: 'N. Silva' };
const control = (overrides: Partial<AudioControlPayload> = {}): AudioControlPayload => ({
  roleId: 'mic-lecturer', gain: 50, muted: false,
  appliedState: 'applied', lastError: null, ...overrides,
});
const source = (state: SourcesStatusPayload['state'] = 'online'): SourcesStatusPayload => ({
  roleId: 'mic-lecturer', state, detail: null,
  since: '2026-08-05T10:00:00Z', inputId: null,
});
const recording = {
  state: 'recording', startReason: 'initial', sessionId: OWNER_ID, title: 'Lecture',
  ownerUserId: OWNER_ID, ownerDisplayName: 'A. Perera', startedAt: '2026-08-05T10:00:00Z',
  recordedDurationMs: 0, segmentIndex: 1, segmentCount: 1, pauseCount: 0,
  takeoverBy: null, takeoverAt: null, takeoverByDisplayName: null,
  errorCode: null, errorMessage: null,
};

function renderMic(options: {
  viewer?: User;
  audio?: AudioControlPayload | null;
  health?: SourcesStatusPayload['state'];
  stale?: boolean;
  both?: boolean;
} = {}) {
  useWsStore.getState().reset();
  useWsStore.setState({
    recording: recording as never,
    audioControls: options.audio === null ? {} : { 'mic-lecturer': options.audio ?? control() },
    sources: { 'mic-lecturer': source(options.health) },
    stale: options.stale ?? false,
  });
  const updateAudioControl = vi.fn(() => Promise.resolve({ resolveBySec: 2 }));
  const client = { updateAudioControl } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    ClientContext.Provider,
    { value: client },
    createElement(AuthProvider, { initialUser: options.viewer ?? owner, children }),
  );
  const node = options.both ? <><MicRow /><MicMasterRow /></> : <MicMasterRow />;
  return { ...render(node, { wrapper }), updateAudioControl };
}

describe('MicMasterRow', () => {
  it('renders live applied truth and issues the shared mute mutation', () => {
    const { updateAudioControl } = renderMic();
    expect(screen.getByTestId('mic-master-state')).toHaveTextContent('Live');
    const toggle = screen.getByRole('switch', { name: 'Lecturer Mic' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    expect(updateAudioControl).toHaveBeenCalledWith('mic-lecturer', { muted: true });
  });

  it('renders muted applied truth', () => {
    renderMic({ audio: control({ muted: true }) });
    expect(screen.getByTestId('mic-master-state')).toHaveTextContent('Muted');
    expect(screen.getByRole('switch', { name: 'Lecturer Mic' })).toHaveAttribute('aria-checked', 'false');
  });

  it('renders pending without moving the applied switch', () => {
    renderMic({ audio: control({ muted: false, appliedState: 'pending' }) });
    expect(screen.getByTestId('mic-master-state')).toHaveTextContent('Applying…');
    expect(screen.getByRole('switch', { name: 'Lecturer Mic' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'Lecturer Mic' })).toBeDisabled();
  });

  it('keeps the switch live when a mute apply fails and renders the failure', () => {
    renderMic({ audio: control({ muted: false, appliedState: 'failed', lastError: 'The mixer refused the change.' }) });
    expect(screen.getByTestId('mic-master-state')).toHaveTextContent("Still live — the mute didn't apply.");
    expect(screen.getByText('The mixer refused the change.')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Lecturer Mic' })).toHaveAttribute('aria-checked', 'true');
  });

  it('disables the row while the microphone is offline', () => {
    renderMic({ health: 'offline' });
    expect(screen.getByTestId('mic-master-state')).toHaveTextContent('No microphone signal.');
    expect(screen.getByRole('switch', { name: 'Lecturer Mic' })).toBeDisabled();
  });

  it('does not guess a switch position during cold load', () => {
    renderMic({ audio: null });
    expect(screen.getByTestId('mic-master-state')).toHaveTextContent('Applying…');
    expect(screen.getByRole('switch', { name: 'Lecturer Mic' })).not.toHaveAttribute('aria-checked');
    expect(screen.getByRole('switch', { name: 'Lecturer Mic' })).toBeDisabled();
  });

  it('disables the row with the fixed stale reason', () => {
    renderMic({ stale: true });
    expect(screen.getByTestId('mic-master-state')).toHaveTextContent("Not connected — you can't change this right now.");
    expect(screen.getByRole('switch', { name: 'Lecturer Mic' })).toBeDisabled();
  });

  it('renders the authority refusal inline for a non-owner', () => {
    renderMic({ viewer: other });
    expect(screen.getByTestId('mic-master-state')).toHaveTextContent(
      'Only the recording owner or an administrator can change audio controls right now.',
    );
    expect(screen.getByRole('switch', { name: 'Lecturer Mic' })).toBeDisabled();
  });

  it('keeps S-09 and S-11 on one control truth after one audio.control event', () => {
    renderMic({ both: true });
    act(() => useWsStore.setState({
      audioControls: { 'mic-lecturer': control({ muted: true }) },
    }));
    expect(screen.getByTestId('mic-state')).toHaveTextContent('Muted');
    expect(screen.getByTestId('mic-master-state')).toHaveTextContent('Muted');
  });
});
