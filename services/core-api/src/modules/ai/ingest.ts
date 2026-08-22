import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { RecordingStatePayload } from '@eduscope/shared';
import type { DrizzleDb } from '../../db/client.js';
import { slideCaptures, transcriptSegments } from '../../db/schema.js';
import type { Clock } from '../../lib/clock.js';
import type { DomainBus, Unsubscribe } from '../../lib/domain-bus.js';
import type { IdGenerator } from '../../lib/ids.js';
import type { LifecycleComponent, LifecycleStopReason } from '../../lifecycle.js';
import { parseAiSseStream, type SlideClient, type SttClient } from './clients.js';

export interface AiIngestLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

/** C execution gate item 2 — the pipeline-manager snapshot-consumer boundary AiIngest needs, narrowed from `PipelineManagerClient`. */
export interface SnapshotConsumerClient {
  startSnapshotConsumer(outputPath: string): Promise<unknown>;
  stopSnapshotConsumer(): Promise<void>;
}

export interface AiIngestDeps {
  db: DrizzleDb;
  clock: Clock;
  ids: IdGenerator;
  bus: DomainBus;
  stt: SttClient;
  slide: SlideClient;
  pm: SnapshotConsumerClient;
  recordingsRoot: string;
  runtimeDir: string;
  /** G-AI-ENABLED (state-machines.md §3.1 Q-01) — same gate machine 2a (countdown.ts) uses; kept as an injected predicate so this module never re-parses the provisioning file. */
  isAiEnabled: () => boolean;
  /** C execution gate item 3 — delay before a stream-ended reconnect attempt reads `/status` again; production default is 2s, tests inject a small value. */
  reconnectBackoffMs?: number | undefined;
  logger?: AiIngestLogger;
}

interface ActiveSession {
  sessionId: string;
  sseController: AbortController;
  sourcePath: string;
  imageDir: string;
  /** The anchor last told to stt/slide, and the wall-clock moment it was set — together they let a reconnect re-derive a fresh anchor without a DB read (C execution gate item 3). */
  anchorOffsetMs: number;
  anchorSetAt: Date;
}

/**
 * Feeds stt-service/slide-service sessions from the recording lifecycle and
 * persists their SSE output append-only (INV-TS-2) as `TranscriptSegment`/
 * `SlideCapture` rows — the AI ingest half of machine 2a's session (B-29
 * plan Step 3). Independent of the countdown state machine (countdown.ts):
 * this module only cares whether a recording is capturing, not whether AI
 * generation is armed/degraded (a dead LLM never stops STT/slide capture,
 * ai-services.md §3.6).
 *
 * Also owns pipeline-manager's snapshot consumer lifecycle (C execution gate
 * item 2: start on recording start/resume, stop on pause/stop — ai-services.md
 * §2.1/§2.3, "the manager's consumer stop is the pause") and a reconnect loop
 * for each SSE stream that re-reads `/status` after a drop and reconciles the
 * active session with C rather than assuming it survived a restart (C
 * execution gate item 3, B-29).
 */
export class AiIngest implements LifecycleComponent {
  readonly name = 'ai-ingest';

  readonly #deps: AiIngestDeps;
  #unsubscribe: Unsubscribe | null = null;
  #active: ActiveSession | null = null;

  constructor(deps: AiIngestDeps) {
    this.#deps = deps;
  }

  async start(): Promise<void> {
    this.#unsubscribe = this.#deps.bus.subscribe('recording.state', (payload) => {
      this.#onRecordingState(payload);
    });
  }

  async stop(_reason: LifecycleStopReason): Promise<void> {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#active?.sseController.abort();
    this.#active = null;
  }

  #onRecordingState(payload: RecordingStatePayload): void {
    if (payload.state === 'recording') {
      if (!this.#deps.isAiEnabled()) return;
      if (this.#active && this.#active.sessionId === payload.sessionId && payload.startReason === 'resume') {
        const anchorOffsetMs = payload.recordedDurationMs ?? 0;
        this.#active.anchorOffsetMs = anchorOffsetMs;
        this.#active.anchorSetAt = this.#deps.clock.now();
        void this.#deps.pm.startSnapshotConsumer(this.#active.sourcePath).catch((error: unknown) => {
          this.#deps.logger?.warn('ai ingest: snapshot consumer start failed', { error: describeError(error) });
        });
        void this.#deps.stt.resumeSession(this.#active.sessionId, anchorOffsetMs).catch((error: unknown) => {
          this.#deps.logger?.warn('ai ingest: stt resume failed', { error: describeError(error) });
        });
        void this.#deps.slide.resumeSession(this.#active.sessionId, anchorOffsetMs).catch((error: unknown) => {
          this.#deps.logger?.warn('ai ingest: slide resume failed', { error: describeError(error) });
        });
        return;
      }
      if (!this.#active && payload.sessionId) {
        const anchorOffsetMs = payload.startReason === 'initial' ? 0 : (payload.recordedDurationMs ?? 0);
        this.#startFresh(payload.sessionId, anchorOffsetMs);
      }
      return;
    }

    if (payload.state === 'paused') {
      if (!this.#active) return;
      const sessionId = this.#active.sessionId;
      void this.#deps.pm.stopSnapshotConsumer().catch((error: unknown) => {
        this.#deps.logger?.warn('ai ingest: snapshot consumer stop failed', { error: describeError(error) });
      });
      void this.#deps.stt.pauseSession(sessionId).catch((error: unknown) => {
        this.#deps.logger?.warn('ai ingest: stt pause failed', { error: describeError(error) });
      });
      return;
    }

    // Any other state (idle/starting/stopping/finalizing/completed/error) that isn't a live capture: tear down if we were active.
    if (this.#active && payload.sessionId !== this.#active.sessionId) {
      this.#endActive();
    } else if (this.#active && (payload.state === 'completed' || payload.state === 'error')) {
      this.#endActive();
    }
  }

  #startFresh(sessionId: string, anchorOffsetMs: number): void {
    const sseController = new AbortController();
    const sourcePath = join(this.#deps.runtimeDir, 'slides', sessionId, 'current.png');
    const imageDir = join(this.#deps.recordingsRoot, 'sessions', sessionId, 'slides');
    this.#active = { sessionId, sseController, sourcePath, imageDir, anchorOffsetMs, anchorSetAt: this.#deps.clock.now() };

    void this.#deps.pm.startSnapshotConsumer(sourcePath).catch((error: unknown) => {
      this.#deps.logger?.warn('ai ingest: snapshot consumer start failed', { error: describeError(error) });
    });
    void this.#deps.stt.startSession(sessionId, anchorOffsetMs).catch((error: unknown) => {
      this.#deps.logger?.warn('ai ingest: stt start failed', { error: describeError(error) });
    });
    void this.#deps.slide.startSession(sessionId, imageDir, sourcePath, anchorOffsetMs).catch((error: unknown) => {
      this.#deps.logger?.warn('ai ingest: slide start failed', { error: describeError(error) });
    });

    void this.#runSttLoop(sessionId, sseController.signal);
    void this.#runSlideLoop(sessionId, sseController.signal);
  }

  #endActive(): void {
    const active = this.#active;
    if (!active) return;
    this.#active = null;
    active.sseController.abort();
    void this.#deps.pm.stopSnapshotConsumer().catch((error: unknown) => {
      this.#deps.logger?.warn('ai ingest: snapshot consumer stop failed', { error: describeError(error) });
    });
    void this.#deps.stt.endSession(active.sessionId).catch((error: unknown) => {
      this.#deps.logger?.warn('ai ingest: stt end failed', { error: describeError(error) });
    });
    void this.#deps.slide.endSession(active.sessionId).catch((error: unknown) => {
      this.#deps.logger?.warn('ai ingest: slide end failed', { error: describeError(error) });
    });
  }

  /**
   * After the stream ends (cleanly or with an error) and we weren't the ones
   * who aborted it, wait a beat and read `/status`: if it still names our
   * session, C is still running it and this was just a network blip — no
   * re-POST, only the caller's stream reopen. If it names a different
   * session (or none), C restarted and lost its in-memory state, so we
   * reconcile by re-POSTing start with a freshly rebased anchor. Neither
   * branch re-inserts a persisted row itself — that only ever happens from a
   * freshly consumed frame, and C's SSE has no replay (B-29: "B re-reads
   * /status after reconnect", not the stream).
   */
  async #reconcileStt(sessionId: string, signal: AbortSignal): Promise<boolean> {
    await delay(this.#deps.reconnectBackoffMs ?? 2000, undefined, { signal }).catch(() => {});
    if (signal.aborted) return false;
    const active = this.#active;
    if (!active || active.sessionId !== sessionId) return false;

    try {
      const status = await this.#deps.stt.getStatus();
      if (status.sessionId !== sessionId) {
        const anchorOffsetMs = active.anchorOffsetMs + Math.max(0, this.#deps.clock.now().getTime() - active.anchorSetAt.getTime());
        await this.#deps.stt.startSession(sessionId, anchorOffsetMs);
        active.anchorOffsetMs = anchorOffsetMs;
        active.anchorSetAt = this.#deps.clock.now();
      }
    } catch (error) {
      this.#deps.logger?.warn('ai ingest: stt reconnect reconcile failed', { error: describeError(error) });
    }
    return true;
  }

  async #reconcileSlide(sessionId: string, signal: AbortSignal): Promise<boolean> {
    await delay(this.#deps.reconnectBackoffMs ?? 2000, undefined, { signal }).catch(() => {});
    if (signal.aborted) return false;
    const active = this.#active;
    if (!active || active.sessionId !== sessionId) return false;

    try {
      const status = await this.#deps.slide.getStatus();
      if (status.sessionId !== sessionId) {
        const anchorOffsetMs = active.anchorOffsetMs + Math.max(0, this.#deps.clock.now().getTime() - active.anchorSetAt.getTime());
        await this.#deps.slide.startSession(sessionId, active.imageDir, active.sourcePath, anchorOffsetMs);
        active.anchorOffsetMs = anchorOffsetMs;
        active.anchorSetAt = this.#deps.clock.now();
      }
    } catch (error) {
      this.#deps.logger?.warn('ai ingest: slide reconnect reconcile failed', { error: describeError(error) });
    }
    return true;
  }

  async #runSttLoop(sessionId: string, signal: AbortSignal): Promise<void> {
    for (;;) {
      if (signal.aborted) return;
      try {
        const response = await this.#deps.stt.openEventStream(signal);
        for await (const frame of parseAiSseStream(response.body!, signal)) {
          if (frame.event !== 'evt.stt.segment') continue;
          const data = frame.data as {
            startOffsetMs: number;
            endOffsetMs: number;
            text: string;
            confidence: number | null;
            engine: string;
            modelVersion: string;
          };
          const now = this.#deps.clock.now();
          this.#deps.db
            .insert(transcriptSegments)
            .values({
              id: this.#deps.ids.next(now),
              sessionId,
              startOffsetMs: data.startOffsetMs,
              endOffsetMs: data.endOffsetMs,
              text: data.text,
              confidence: data.confidence ?? null,
              engine: data.engine,
              modelVersion: data.modelVersion,
              createdAt: now.toISOString(),
            })
            .run();
        }
      } catch (error) {
        if (signal.aborted) return;
        this.#deps.logger?.warn('ai ingest: stt stream ended', { error: describeError(error) });
      }
      if (signal.aborted) return;
      const shouldContinue = await this.#reconcileStt(sessionId, signal);
      if (!shouldContinue) return;
    }
  }

  async #runSlideLoop(sessionId: string, signal: AbortSignal): Promise<void> {
    for (;;) {
      if (signal.aborted) return;
      try {
        const response = await this.#deps.slide.openEventStream(signal);
        for await (const frame of parseAiSseStream(response.body!, signal)) {
          if (frame.event !== 'evt.slide.captured') continue;
          const data = frame.data as {
            capturedAt: string;
            offsetMs: number;
            imagePath: string | null;
            ocrText: string | null;
            dedupeHash: string;
            isSlideChange: boolean;
          };
          const now = this.#deps.clock.now();
          this.#deps.db
            .insert(slideCaptures)
            .values({
              id: this.#deps.ids.next(now),
              sessionId,
              capturedAt: data.capturedAt,
              offsetMs: data.offsetMs,
              imagePath: data.imagePath ?? null,
              ocrText: data.ocrText ?? null,
              dedupeHash: data.dedupeHash,
              isSlideChange: data.isSlideChange,
            })
            .run();
        }
      } catch (error) {
        if (signal.aborted) return;
        this.#deps.logger?.warn('ai ingest: slide stream ended', { error: describeError(error) });
      }
      if (signal.aborted) return;
      const shouldContinue = await this.#reconcileSlide(sessionId, signal);
      if (!shouldContinue) return;
    }
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
