import { render, renderHook } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useTelemetryStore, useWsStore } from './ws-store.js';
import {
  useAudioControlRow, useExpectedShutdown, useLastSegment, useRecordingState,
  useWsShallow,
} from './selectors.js';

const envelope = (event: string, payload: unknown, seq: number) =>
  ({ event, at: '2026-07-30T09:00:00+00:00', seq, payload }) as never;

function Probe({ onRender }: { onRender: () => void }) {
  useRecordingState();
  onRender();
  return null;
}

describe('selector discipline (zustand v5 has no automatic shallow equality)', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
  });

  it('an atomic selector does not re-render on an unrelated slice change', () => {
    let renders = 0;
    render(<Probe onRender={() => { renders += 1; }} />);
    const baseline = renders;
    act(() => {
      useWsStore.getState().ingest(
        envelope('storage.status', { pressure: 'warning' }, 0),
      );
    });
    expect(renders, 'storage must not re-render a recording-state consumer').toBe(baseline);
  });

  it('a multi-field read via useWsShallow is stable when nothing it reads changed', () => {
    let renders = 0;
    function Multi() {
      useWsShallow((s) => ({ stale: s.stale, needsResync: s.needsResync }));
      renders += 1;
      return null;
    }
    render(<Multi />);
    const baseline = renders;
    act(() => {
      useWsStore.getState().ingest(envelope('device.health', { ntpSynced: true }, 0));
    });
    expect(renders).toBe(baseline);
  });

  it('telemetry at 10 Hz causes ZERO React renders', () => {
    let renders = 0;
    render(<Probe onRender={() => { renders += 1; }} />);
    const baseline = renders;
    act(() => {
      for (let i = 0; i < 100; i += 1) {
        useTelemetryStore.getState().setLevel('mic-lecturer', i / 100);
      }
    });
    expect(renders, 'meters must never enter React state').toBe(baseline);
  });
});

describe('wave 2 store slices', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
  });

  it('selects an audio.control row by role id', () => {
    const payload = {
      roleId: 'mic-lecturer', gain: 0.75, muted: false,
      appliedState: 'applied', lastError: null,
    };
    act(() => useWsStore.getState().ingest(envelope('audio.control', payload, 0)));
    const { result } = renderHook(() => useAudioControlRow('mic-lecturer'));
    expect(result.current).toEqual(payload);
  });

  it('retains and selects the latest recording.segment', () => {
    const payload = { sessionId: '01J00000000000000000000000', index: 2 };
    act(() => useWsStore.getState().ingest(envelope('recording.segment', payload, 0)));
    const { result } = renderHook(() => useLastSegment());
    expect(result.current).toEqual(payload);
  });

  it('sets, selects, and resets expected shutdown', () => {
    act(() => useWsStore.getState().setExpectedShutdown(true));
    const { result } = renderHook(() => useExpectedShutdown());
    expect(result.current).toBe(true);
    act(() => useWsStore.getState().reset());
    expect(result.current).toBe(false);
  });
});
