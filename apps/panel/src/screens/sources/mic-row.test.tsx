import { createElement, type ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import type { AudioControlPayload, SourceRoleId, SourcesStatusPayload, User } from '@eduscope/shared';
import { AuthProvider } from '../../auth/auth-context.js';
import { ClientContext } from '../../client/client-provider.js';
import { useWsStore } from '../../store/ws-store.js';
import { MicRow } from './mic-row.js';

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
  audio?: AudioControlPayload;
  health?: SourcesStatusPayload['state'];
  stale?: boolean;
  roleId?: SourceRoleId;
  displayName?: string;
} = {}) {
  const roleId = options.roleId ?? 'mic-lecturer';
  useWsStore.getState().reset();
  useWsStore.setState({
    recording: recording as never,
    audioControls: { [roleId]: options.audio ?? control({ roleId }) },
    sources: { [roleId]: { ...source(options.health), roleId } },
    stale: options.stale ?? false,
  });
  const updateAudioControl = vi.fn(() => Promise.resolve({ resolveBySec: 2 }));
  const client = { updateAudioControl } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    ClientContext.Provider,
    { value: client },
    createElement(AuthProvider, { initialUser: options.viewer ?? owner, children }),
  );
  return { ...render(<MicRow roleId={roleId} displayName={options.displayName ?? 'Lecturer Mic'} />, { wrapper }), updateAudioControl };
}

describe('MicRow', () => {
  it('binds the room label, meter, and controls to mic-room', () => {
    const { updateAudioControl } = renderMic({ roleId: 'mic-room', displayName: 'PC Mic' });
    expect(screen.getByRole('meter', { name: 'PC Mic level' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'PC Mic' }));
    expect(updateAudioControl).toHaveBeenCalledWith('mic-room', { muted: true });
  });
  it('renders applied live truth and issues mute without gain controls', () => {
    const { updateAudioControl } = renderMic();
    expect(screen.getByRole('switch', { name: 'Lecturer Mic' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Live')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Lecturer Mic' }));
    expect(updateAudioControl).toHaveBeenNthCalledWith(1, 'mic-lecturer', { muted: true });
    expect(screen.queryByLabelText(/gain|increase|decrease/i)).not.toBeInTheDocument();
  });

  it('renders applied muted truth', () => {
    renderMic({ audio: control({ muted: true }) });
    expect(screen.getByRole('switch', { name: 'Lecturer Mic' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Muted')).toBeInTheDocument();
  });

  it('renders pending without moving the applied switch', () => {
    renderMic({ audio: control({ muted: false, appliedState: 'pending' }) });
    expect(screen.getByText('Applying…')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Lecturer Mic' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'Lecturer Mic' })).toBeDisabled();
  });

  it('keeps the switch Live when a mute apply fails and renders the failure', () => {
    renderMic({ audio: control({ muted: false, appliedState: 'failed', lastError: 'The mixer did not accept the change.' }) });
    expect(screen.getByRole('switch', { name: 'Lecturer Mic' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText("Still live — the mute didn't apply.")).toBeInTheDocument();
    expect(screen.getByText('The mixer did not accept the change.')).toBeInTheDocument();
  });

  it('disables the row with the microphone-offline reason inline', () => {
    renderMic({ health: 'offline' });
    expect(screen.getByText('No microphone signal.')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Lecturer Mic' })).toBeDisabled();
  });

  it('disables a non-owner with the server-backed authority reason inline', () => {
    renderMic({ viewer: other });
    expect(screen.getByText('Only the recording owner or an administrator can change audio controls right now.')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Lecturer Mic' })).toBeDisabled();
  });

  it("disables stale controls with the fixed not-connected reason", () => {
    renderMic({ stale: true });
    expect(screen.getByText("Not connected — you can't change this right now.")).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Lecturer Mic' })).toBeDisabled();
  });
});
