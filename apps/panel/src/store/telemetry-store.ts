import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { SourceRoleId } from '@eduscope/shared';

interface TelemetryState {
  /** audio.levels at <= 10 Hz. NEVER read through a React hook. */
  audioLevels: Partial<Record<SourceRoleId, number>>;
  /** Bookkeeping: changes on every event, consumed by nothing visual. */
  lastSeq: number | null;
  setLevel(roleId: SourceRoleId, rms: number): void;
  setLastSeq(seq: number): void;
  reset(): void;
}

/**
 * Telemetry, kept out of the application store on purpose.
 *
 * Ten notifications a second against a store that 42 screens subscribe to means
 * zustand re-runs every registered selector ten times a second, on a board that
 * is also running the capture pipelines. Meters subscribe here IMPERATIVELY —
 *
 *   useEffect(() => useTelemetryStore.subscribe(
 *     (s) => s.audioLevels['mic-lecturer'],
 *     (rms) => el.current?.style.setProperty('--level', String(rms)),
 *   ), []);
 *
 * — which writes a CSS custom property and causes zero React renders.
 */
export const useTelemetryStore = create<TelemetryState>()(
  subscribeWithSelector((set) => ({
    audioLevels: {},
    lastSeq: null,
    setLevel: (roleId, rms) =>
      set((s) => ({ audioLevels: { ...s.audioLevels, [roleId]: rms } })),
    setLastSeq: (seq) => set({ lastSeq: seq }),
    reset: () => set({ audioLevels: {}, lastSeq: null }),
  })),
);
