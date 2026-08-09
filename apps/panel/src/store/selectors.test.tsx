import { render, renderHook } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useTelemetryStore, useWsStore } from './ws-store.js';
import {
  useAiSet, useAlert, useAudioControlRow, useExpectedShutdown, useLastSegment,
  usePublicationsList, useQuizSession, useRecordingState, useWsShallow,
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

  it('retains the latest closed segment when the next capturing segment opens', () => {
    const payload = {
      sessionId: '01J00000000000000000000000', index: 1,
      state: 'truncated', endReason: 'crash',
    };
    act(() => {
      useWsStore.getState().ingest(envelope('recording.segment', payload, 0));
      useWsStore.getState().ingest(envelope('recording.segment', {
        sessionId: payload.sessionId, index: 2, state: 'capturing', endReason: null,
      }, 1));
    });
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

describe('wave 4 store slices', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
  });

  it('useQuizSession returns the store slice and re-renders only on quiz.session ingest', () => {
    let renders = 0;
    function Probe() {
      useQuizSession();
      renders += 1;
      return null;
    }
    render(<Probe />);
    const baseline = renders;
    act(() => {
      useWsStore.getState().ingest(envelope('storage.status', { pressure: 'warning' }, 0));
    });
    expect(renders, 'an unrelated slice must not re-render a quiz.session consumer').toBe(baseline);

    const payload = {
      state: 'open', quizSessionId: '01J00000000000000000000001', joinUrl: 'https://q/482913',
      joinCode: '482913', joinedCount: 3, syncState: 'synced',
    };
    act(() => useWsStore.getState().ingest(envelope('quiz.session', payload, 1)));
    const { result } = renderHook(() => useQuizSession());
    expect(result.current).toEqual(payload);
  });

  it('usePublicationsList returns a stable array across an unrelated ingest', () => {
    const payload = {
      publicationId: '01J00000000000000000000002', questionId: '01J00000000000000000000003',
      state: 'open', isShowing: true, projectorState: 'showing', syncState: 'synced', closeReason: null,
    };
    act(() => useWsStore.getState().ingest(envelope('quiz.publication', payload, 0)));

    let renders = 0;
    function Probe() {
      usePublicationsList();
      renders += 1;
      return null;
    }
    render(<Probe />);
    const baseline = renders;
    act(() => {
      useWsStore.getState().ingest(envelope('device.health', { ntpSynced: true }, 1));
    });
    expect(renders, 'an unrelated ingest must not re-render a usePublicationsList consumer').toBe(baseline);

    const { result } = renderHook(() => usePublicationsList());
    expect(result.current).toEqual([payload]);
  });

  it('useAiSet returns the store slice', () => {
    const payload = {
      setId: '01J00000000000000000000005', sessionId: '01J00000000000000000000006',
      state: 'ready', trigger: 'countdown', count: 4, error: null, attempt: 0,
    };
    act(() => useWsStore.getState().ingest(envelope('ai.set', payload, 0)));
    const { result } = renderHook(() => useAiSet());
    expect(result.current).toEqual(payload);
  });

  it('useAlert selects one alert row by id', () => {
    const payload = {
      id: '01J00000000000000000000004', code: 'ai.unavailable', severity: 'error', category: 'System',
      title: 'ai.unavailable', detail: null, raisedAt: '2026-07-30T09:00:00Z', clearedAt: null,
      clearedReason: null, acknowledgedBy: null, context: null, relatedEntity: null,
    };
    act(() => useWsStore.getState().ingest(envelope('system.alert', payload, 0)));
    const { result } = renderHook(() => useAlert(payload.id));
    expect(result.current).toEqual(payload);
  });
});
