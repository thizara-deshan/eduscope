import { TIMERS, type AiCountdownSnapshot, type AiCountdownState, type IntervalMinutes, type RecordingStatePayload } from '@eduscope/shared';
import { ProblemError } from '../../contracts/problem.js';
import type { Clock } from '../../lib/clock.js';
import type { DomainBus, Unsubscribe } from '../../lib/domain-bus.js';
import type { IdGenerator } from '../../lib/ids.js';
import type { LifecycleComponent, LifecycleStopReason } from '../../lifecycle.js';
import type { AlertStore } from '../device/alerts.js';
import { assertAuthOwner } from '../recording/guards.js';
import type { AuthContext } from '../auth/service.js';
import type { QuestionClient } from './clients.js';

const DEFAULT_INTERVAL_MINUTES: IntervalMinutes = 20; // A-14/INT-11 — the prototype's 15 is drift.
const AI_UNAVAILABLE_ALERT_CODE = 'ai.unavailable';

export interface AiCountdownAccepted {
  commandId: string;
  acceptedAt: string;
  resolveBySec: number;
}

export interface AiCountdownLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface AiCountdownDeps {
  clock: Clock;
  ids: IdGenerator;
  bus: DomainBus;
  question: QuestionClient;
  alerts: AlertStore;
  /** G-AI-ENABLED (Q-01): `featureFlags.aiQuizEnabled && llmEndpoint !== null`. Wrapped as a predicate so this module never re-parses the provisioning file itself (INV-DP-3 stays owned by ProvisioningReader). */
  isAiEnabled: () => boolean;
  llmEndpoint: () => string | null;
  logger?: AiCountdownLogger;
}

interface CountdownRecord {
  sessionId: string | null;
  ownerUserId: string | null;
  state: AiCountdownState;
  intervalMinutes: IntervalMinutes;
  /** Absolute wall-clock deadline while `armed`; `null` otherwise (INV-G-7 — no per-second ticking server-side). */
  nextAt: number | null;
  /** Frozen countdown value while `held`/`degraded`/`generating`; the source of truth for `remainingMs` outside `armed`. */
  heldRemainingMs: number | null;
  /** Tracks the recording's own lifecycle state so `generateNow`/`setInterval` guards don't need a DB read. */
  recordingState: RecordingStatePayload['state'];
}

function freshRecord(): CountdownRecord {
  return {
    sessionId: null,
    ownerUserId: null,
    state: 'unavailable',
    intervalMinutes: DEFAULT_INTERVAL_MINUTES,
    nextAt: null,
    heldRemainingMs: null,
    recordingState: 'idle',
  };
}

/**
 * Machine 2a (state-machines.md §3.1, design/core-api.md §10): the countdown
 * to the next AI question-generation cycle. Emits `T-COUNTDOWN-RESYNC` (15s)
 * plus on every transition; the panel ticks `mm:ss` locally from `nextAt`
 * (INV-G-7 — no per-second rows or events). Generation itself (machine 2b,
 * Q-11..Q-17) is B-30's job: this machine only decides *when* to ask for one
 * (`ai.generation.requested`) and how to react to the terminal outcome
 * (`reportGenerationSettled`, the seam B-30's executor will call).
 */
export class AiCountdown implements LifecycleComponent {
  readonly name = 'ai-countdown';

  readonly #deps: AiCountdownDeps;
  #record: CountdownRecord = freshRecord();
  #unsubscribeRecording: Unsubscribe | null = null;
  #resyncTimer: { cancel(): void } | null = null;
  #fireController: AbortController | null = null;
  #probeTimer: { cancel(): void } | null = null;

  constructor(deps: AiCountdownDeps) {
    this.#deps = deps;
  }

  async start(): Promise<void> {
    this.#unsubscribeRecording = this.#deps.bus.subscribe('recording.state', (payload) => {
      this.#onRecordingState(payload);
    });
    this.#resyncTimer = this.#deps.clock.every(TIMERS['T-COUNTDOWN-RESYNC'], () => this.#publish());
  }

  async stop(_reason: LifecycleStopReason): Promise<void> {
    this.#unsubscribeRecording?.();
    this.#unsubscribeRecording = null;
    this.#resyncTimer?.cancel();
    this.#resyncTimer = null;
    this.#fireController?.abort();
    this.#fireController = null;
    this.#probeTimer?.cancel();
    this.#probeTimer = null;
  }

  snapshot(): AiCountdownSnapshot {
    return this.#toSnapshot();
  }

  /** `cmd.ai.set_interval` (Q-10) — only while `armed`/`held`. */
  setInterval(intervalMinutes: IntervalMinutes, actor: AuthContext): AiCountdownAccepted {
    if (this.#record.state !== 'armed' && this.#record.state !== 'held') {
      throw new ProblemError(409, 'conflict', 'The AI countdown is not running');
    }
    this.#assertOwner(actor);

    this.#record.intervalMinutes = intervalMinutes;
    const remainingMs = intervalMinutes * 60_000;
    if (this.#record.state === 'armed') {
      this.#armTimer(remainingMs);
    } else {
      this.#record.heldRemainingMs = remainingMs;
    }
    this.#publish();
    return this.#accepted();
  }

  /** `cmd.ai.generate_now` (Q-03) — only while the session is `recording` and the countdown is `armed`/`degraded` (a paused session has no new transcript). */
  generateNow(actor: AuthContext): AiCountdownAccepted {
    if (this.#record.recordingState !== 'recording') {
      throw new ProblemError(409, 'session.not-active', 'No recording is active');
    }
    if (this.#record.state !== 'armed' && this.#record.state !== 'degraded') {
      throw new ProblemError(409, 'conflict', 'A generation is already in progress');
    }
    this.#assertOwner(actor);

    this.#beginGenerating('manual');
    return this.#accepted();
  }

  /**
   * The B-30 seam: machine 2b calls this once a generation cycle settles.
   * `ready`/`failed-retryable` reset the countdown to a full interval (Q-04);
   * `failed-exhausted` holds it degraded (Q-05) until the next successful
   * `T-LLM-PROBE` (Q-06). Exposed now so this task's own tests can exercise
   * Q-04/Q-05 without machine 2b existing yet.
   */
  reportGenerationSettled(sessionId: string, outcome: 'ready' | 'failed-retryable' | 'failed-exhausted'): void {
    if (this.#record.sessionId !== sessionId || this.#record.state !== 'generating') return;

    if (outcome === 'failed-exhausted') {
      this.#record.state = 'degraded';
      this.#record.heldRemainingMs = this.#record.intervalMinutes * 60_000;
      this.#record.nextAt = null;
      this.#deps.alerts.raise({
        code: AI_UNAVAILABLE_ALERT_CODE,
        severity: 'warning',
        category: 'System',
        title: 'AI question generation is unavailable',
        detail: 'The configured LLM endpoint is unreachable or timing out.',
      });
      this.#armProbeTimer();
      this.#publish();
      return;
    }

    // Q-04: ready, or failed with retries left — resets to a full interval either way (auto and manual generations both reset it).
    this.#record.state = 'armed';
    this.#armTimer(this.#record.intervalMinutes * 60_000);
    this.#publish();
  }

  #onRecordingState(payload: RecordingStatePayload): void {
    this.#record.recordingState = payload.state;

    if (payload.state === 'recording') {
      if (this.#record.state === 'unavailable') {
        if (!this.#deps.isAiEnabled() || !payload.sessionId) return;
        this.#record.sessionId = payload.sessionId;
        this.#record.ownerUserId = payload.ownerUserId;
        this.#record.intervalMinutes = DEFAULT_INTERVAL_MINUTES;
        this.#record.state = 'armed';
        this.#armTimer(this.#record.intervalMinutes * 60_000);
        this.#publish();
        return;
      }
      if (this.#record.state === 'held' && this.#record.sessionId === payload.sessionId) {
        // Q-08: remaining time is preserved across the pause, not reset.
        this.#record.state = 'armed';
        this.#armTimer(this.#record.heldRemainingMs ?? this.#record.intervalMinutes * 60_000);
        this.#record.heldRemainingMs = null;
        this.#publish();
      }
      return;
    }

    if (payload.state === 'paused') {
      // Q-07: the countdown runs only while `recording` — armed is the only source state the diagram defines.
      if (this.#record.state === 'armed') {
        this.#record.state = 'held';
        this.#record.heldRemainingMs = this.#remainingNow();
        this.#cancelFireTimer();
        this.#publish();
      }
      return;
    }

    if (payload.state === 'completed' || payload.state === 'error') {
      if (this.#record.state === 'unavailable') return;
      this.#cancelFireTimer();
      this.#probeTimer?.cancel();
      this.#probeTimer = null;
      if (this.#deps.alerts.list(false).some((alert) => alert.code === AI_UNAVAILABLE_ALERT_CODE)) {
        this.#deps.alerts.clear(AI_UNAVAILABLE_ALERT_CODE, 'resolved');
      }
      this.#record = freshRecord();
      this.#record.recordingState = payload.state;
      this.#publish();
    }
  }

  #beginGenerating(trigger: 'countdown' | 'manual'): void {
    this.#cancelFireTimer();
    const sessionId = this.#record.sessionId!;
    const requestedAt = this.#deps.clock.now().toISOString();
    this.#record.state = 'generating';
    this.#record.nextAt = null;
    this.#record.heldRemainingMs = null;
    this.#publish();
    this.#deps.bus.publish('ai.generation.requested', {
      sessionId,
      trigger,
      intervalMinutesAtRequest: this.#record.intervalMinutes,
      requestedAt,
    });
  }

  /** Arms the single-shot `remainingMs` timer that fires Q-02 — never a per-second poll (INV-G-7). */
  #armTimer(remainingMs: number): void {
    this.#cancelFireTimer();
    const now = this.#deps.clock.now();
    this.#record.nextAt = now.getTime() + remainingMs;
    this.#record.heldRemainingMs = null;

    const controller = new AbortController();
    this.#fireController = controller;
    this.#deps.clock.sleep(remainingMs, controller.signal).then(() => {
      if (controller.signal.aborted) return;
      this.#beginGenerating('countdown');
    });
  }

  #armProbeTimer(): void {
    this.#probeTimer?.cancel();
    this.#probeTimer = this.#deps.clock.every(TIMERS['T-LLM-PROBE'], () => {
      void this.#runProbe();
    });
  }

  async #runProbe(): Promise<void> {
    if (this.#record.state !== 'degraded') return;
    const endpoint = this.#deps.llmEndpoint();
    if (!endpoint) return;
    let reachable = false;
    try {
      const result = await this.#deps.question.probe(endpoint);
      reachable = result.reachable;
    } catch (error) {
      this.#deps.logger?.warn('ai countdown: probe failed', { error: error instanceof Error ? error.message : String(error) });
      return;
    }
    if (!reachable || this.#record.state !== 'degraded') return;

    // Q-06: resumes from the held remainingMs.
    this.#probeTimer?.cancel();
    this.#probeTimer = null;
    this.#record.state = 'armed';
    this.#armTimer(this.#record.heldRemainingMs ?? this.#record.intervalMinutes * 60_000);
    this.#deps.alerts.clear(AI_UNAVAILABLE_ALERT_CODE, 'resolved');
    this.#publish();
  }

  #cancelFireTimer(): void {
    this.#fireController?.abort();
    this.#fireController = null;
  }

  #remainingNow(): number {
    if (this.#record.nextAt === null) return this.#record.heldRemainingMs ?? 0;
    return Math.max(0, this.#record.nextAt - this.#deps.clock.now().getTime());
  }

  #publish(): void {
    this.#deps.bus.publish('ai.countdown', this.#toSnapshot());
  }

  #toSnapshot(): AiCountdownSnapshot {
    const state = this.#record.state;
    let remainingMs: number | null;
    let nextAt: string | null;
    if (state === 'armed') {
      remainingMs = this.#remainingNow();
      nextAt = this.#record.nextAt !== null ? new Date(this.#record.nextAt).toISOString() : null;
    } else if (state === 'held' || state === 'degraded') {
      remainingMs = this.#record.heldRemainingMs;
      nextAt = null;
    } else {
      remainingMs = null;
      nextAt = null;
    }
    return { state, remainingMs, nextAt, intervalMinutes: this.#record.intervalMinutes };
  }

  #assertOwner(actor: AuthContext): void {
    if (this.#record.ownerUserId === null) return;
    assertAuthOwner({ ownerUserId: this.#record.ownerUserId }, actor);
  }

  #accepted(): AiCountdownAccepted {
    const now = this.#deps.clock.now();
    return { commandId: this.#deps.ids.next(now), acceptedAt: now.toISOString(), resolveBySec: TIMERS['T-CMD-RESOLVE'] / 1000 };
  }
}
