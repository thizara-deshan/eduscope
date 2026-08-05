import { createElement, type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import type { AudioControlPayload, SourcesStatusPayload, User } from '@eduscope/shared';
import { AuthProvider } from '../auth/auth-context.js';
import { ClientContext } from '../client/client-provider.js';
import { useWsStore } from '../store/ws-store.js';
import { useAudioControl } from './use-audio-control.js';

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

function renderAudio(options: {
  viewer?: User;
  audio?: AudioControlPayload;
  health?: SourcesStatusPayload['state'];
  stale?: boolean;
} = {}) {
  useWsStore.getState().reset();
  useWsStore.setState({
    recording: recording as never,
    audioControls: { 'mic-lecturer': options.audio ?? control() },
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
  return { ...renderHook(() => useAudioControl('mic-lecturer'), { wrapper }), updateAudioControl };
}

describe('useAudioControl', () => {
  beforeEach(() => useWsStore.getState().reset());

  it.each([
    ['live', control(), 'online', owner],
    ['muted', control({ muted: true }), 'online', owner],
    ['pending', control({ appliedState: 'pending' }), 'online', owner],
    ['apply-failed', control({ appliedState: 'failed', lastError: 'Mixer refused.' }), 'online', owner],
    ['offline', control(), 'offline', owner],
    ['locked', control(), 'online', other],
  ] as const)('derives %s from applied control, health and authority truth', (expected, audio, health, viewer) => {
    const { result } = renderAudio({ audio, health, viewer });
    expect(result.current.state).toBe(expected);
  });

  it('does not call the client when the inline authority reason disables the control', () => {
    const { result, updateAudioControl } = renderAudio({ viewer: other });
    act(() => {
      result.current.setMuted(true);
      result.current.setGain(55);
    });
    expect(result.current.disabledReason).toMatch(/recording owner or an administrator/i);
    expect(updateAudioControl).not.toHaveBeenCalled();
  });
});
