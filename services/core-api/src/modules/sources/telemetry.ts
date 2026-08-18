import type { AudioLevelsPayload, SourceRoleId } from '@eduscope/shared';
import type { Clock } from '../../lib/clock.js';

const AUDIO_LEVELS_MIN_INTERVAL_MS = 100; // <= 10 Hz (contracts/events.md §2.6)

function clampRms(rms: number): number {
  return Math.min(1, Math.max(0, rms));
}

/**
 * §2.6 `audio.levels` — telemetry, never rows (INV-AC-2, INV-G-7): no state
 * machine, just clamp-to-[0,1] plus a per-role <= 10 Hz throttle. The caller
 * is responsible for the "no panel subscriber, no work" gate (§6 budget) —
 * this class only decides *when* a reading is due to be sent, not *whether*
 * anyone is listening.
 */
export class AudioLevelThrottle {
  readonly #clock: Clock;
  readonly #lastSentAtMs = new Map<SourceRoleId, number>();

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  /** Returns the payload to publish, or `null` if this reading arrived inside the throttle window. */
  next(roleId: SourceRoleId, rms: number): AudioLevelsPayload | null {
    const nowMs = this.#clock.now().getTime();
    const lastSentAtMs = this.#lastSentAtMs.get(roleId);
    if (lastSentAtMs !== undefined && nowMs - lastSentAtMs < AUDIO_LEVELS_MIN_INTERVAL_MS) {
      return null;
    }
    this.#lastSentAtMs.set(roleId, nowMs);
    return { roleId, rms: clampRms(rms) };
  }
}
