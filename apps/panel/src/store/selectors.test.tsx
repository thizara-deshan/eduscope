import { render } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useTelemetryStore, useWsStore } from './ws-store.js';
import { useRecordingState, useWsShallow } from './selectors.js';

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
