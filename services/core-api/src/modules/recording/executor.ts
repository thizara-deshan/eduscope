import { LAYOUT_PRESETS, TIMERS, type OutputSpec } from '@eduscope/shared';
import { eq, inArray } from 'drizzle-orm';
import type { DrizzleDb } from '../../db/client.js';
import { channelConfigs, lectureSessions, recordings, recordingSegments } from '../../db/schema.js';
import type { Cancel, Clock } from '../../lib/clock.js';
import type { DomainBus } from '../../lib/domain-bus.js';
import type { IdGenerator } from '../../lib/ids.js';
import { SerialExecutor } from '../../lib/serial-executor.js';
import type { LifecycleComponent, LifecycleStopReason } from '../../lifecycle.js';
import { ProblemError } from '../../contracts/problem.js';
import type { AuthContext } from '../auth/service.js';
import { takeoverRecording } from './authority.js';
import { runBootRecovery, type BootRecoveryAction } from './boot-recovery.js';
import { assertAuthOwner, assertStorageOk, resolveChannelValid, runStartGuards, type ChannelValidResult } from './guards.js';
import { RecordingMachine } from './machine.js';
import type { PipelineManagerClient, StartRecordConsumerBody } from './pm/client.js';
import { PipelineManagerError, type PmStatus } from './pm/types.js';
import { stopConsumerWithEosRace } from './recovery.js';
import { segmentOutputPaths } from './segments.js';
import { getRecordingStateSnapshot, toRecordingSegmentPayload, toRecordingStatePayload } from './snapshots.js';

/** state-machines.md §1: the non-terminal vocabulary a "current session" read is scoped to. */
const NON_TERMINAL_STATES = ['starting', 'recording', 'paused', 'stopping', 'finalizing'] as const;

type StartReason = 'initial' | 'resume' | 'recovery';

/** Treated as "no live consumer" (G-DEVICE-REBOOTED) when `T-BOOT-RECOVERY` elapses with no `pm.status.resynced` yet. */
const EMPTY_PM_STATUS: PmStatus = {
  platform: '',
  encodeLedger: { capacity: 0, inUse: 0, reservedBy: [] },
  publishers: {
    usb: { state: 'unknown', bound: false, fps: null, rms: null, lastError: null },
    rtsp: { state: 'unknown', bound: false, fps: null, rms: null, lastError: null },
    rtsp2: { state: 'unknown', bound: false, fps: null, rms: null, lastError: null },
    audio: { state: 'unknown', bound: false, fps: null, rms: null, lastError: null },
  },
  consumers: [],
  device: { captureCardState: 'absent', led: 'off' },
  sequence: 0,
};

export interface RecordingExecutorLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface RecordingExecutorDeps {
  db: DrizzleDb;
  clock: Clock;
  ids: IdGenerator;
  bus: DomainBus;
  pm: PipelineManagerClient;
  provisioningPath: string;
  recordingsRoot: string;
  logger?: RecordingExecutorLogger;
}

export interface StartRecordingResult {
  commandId: string;
  acceptedAt: string;
  resolveBySec: number;
}

export class RecordingExecutor implements LifecycleComponent {
  readonly name = 'recording-executor';

  readonly #deps: RecordingExecutorDeps;
  readonly #machine: RecordingMachine;
  readonly #serial = new SerialExecutor();

  /** consumerId of the currently-running record consumer, keyed by sessionId — set once R-05 confirms (or BR-1 adopts), cleared when the segment closes. Process-local only; a session `recording` after restart with no live PM consumer falls to BR-2/3/8, not this map. */
  readonly #activeConsumerId = new Map<string, string>();
  readonly #inFlightPause = new Set<string>();
  readonly #inFlightStop = new Set<string>();

  #heartbeatCancel: Cancel | null = null;
  #bootRecoveryAbort: AbortController | null = null;
  #bootRecoveryPromise: Promise<void> | null = null;

  constructor(deps: RecordingExecutorDeps) {
    this.#deps = deps;
    // `deps.db` may itself be a getter resolved only after the DB lifecycle
    // component starts (app.ts's pattern for every module) — copying `deps.db`
    // here would freeze that read at construction time, before it exists.
    this.#machine = new RecordingMachine({
      get db(): DrizzleDb {
        return deps.db;
      },
      clock: deps.clock,
      ids: deps.ids,
    });
  }

  /** Arms the T-SESSION-HEARTBEAT writer and the boot-recovery race; never blocks server startup on either (core-api.md §4.3's "within T-BOOT-RECOVERY" is a background convergence bound, not a listen-blocking one). */
  async start(): Promise<void> {
    this.#heartbeatCancel = this.#deps.clock.every(TIMERS['T-SESSION-HEARTBEAT'], () => this.#writeHeartbeat());
    this.#bootRecoveryPromise = this.#armBootRecovery().catch((error: unknown) => {
      this.#deps.logger?.warn('boot recovery: pass failed unexpectedly', { error: describeError(error) });
    });
  }

  async stop(_reason: LifecycleStopReason): Promise<void> {
    this.#heartbeatCancel?.cancel();
    this.#bootRecoveryAbort?.abort();
    await this.#bootRecoveryPromise?.catch(() => undefined);
  }

  getState(): ReturnType<typeof getRecordingStateSnapshot> {
    return getRecordingStateSnapshot(this.#deps.db);
  }

  async startRecording(actor: AuthContext): Promise<StartRecordingResult> {
    return this.#serial.run(() => this.#doStart(actor));
  }

  async pauseRecording(actor: AuthContext): Promise<StartRecordingResult> {
    return this.#serial.run(() => this.#doPause(actor));
  }

  async resumeRecording(actor: AuthContext): Promise<StartRecordingResult> {
    return this.#serial.run(() => this.#doResume(actor));
  }

  async stopRecording(actor: AuthContext): Promise<StartRecordingResult> {
    return this.#serial.run(() => this.#doStop(actor));
  }

  async takeoverRecording(actor: AuthContext): Promise<StartRecordingResult> {
    return this.#serial.run(() => this.#doTakeover(actor));
  }

  async #doStart(actor: AuthContext): Promise<StartRecordingResult> {
    const { db, clock, ids, bus } = this.#deps;
    const guardResult = runStartGuards(db, this.#deps.provisioningPath);
    const created = this.#machine.createStarting({
      provisioning: guardResult.provisioning,
      channel: guardResult.channel,
      ownerUserId: actor.userId,
    });

    const now = clock.now();
    const commandId = ids.next(now);
    const acceptedAt = now.toISOString();

    bus.publish('recording.state', toRecordingStatePayload(db, this.#loadSession(created.sessionId), 'initial'));

    // Class B failures resolve only over the event channel, never the HTTP
    // response (openapi.yaml startRecording description) — deliberately not
    // awaited, so the 202 above is not held up by the PM round trip.
    void this.#launchPmConsumer(created.sessionId, guardResult.channel).catch((error: unknown) => {
      this.#deps.logger?.warn('recording start: background launch failed unexpectedly', { error: describeError(error) });
    });

    return { commandId, acceptedAt, resolveBySec: TIMERS['T-CMD-RESOLVE'] / 1000 };
  }

  async #launchPmConsumer(sessionId: string, channel: ChannelValidResult): Promise<void> {
    const preset = LAYOUT_PRESETS.find((entry) => entry.id === channel.layoutPreset.id);
    const body: StartRecordConsumerBody = {
      preset: channel.layoutPreset.id,
      ...buildOutputs(this.#deps.recordingsRoot, sessionId, 0, preset?.outputs ?? [{ streamKey: 'main', roleIds: [], includeAudio: true }]),
      ...(channel.channelConfig.ratioA !== null ? { ratioA: channel.channelConfig.ratioA } : {}),
      ...(channel.channelConfig.ratioB !== null ? { ratioB: channel.channelConfig.ratioB } : {}),
    };

    let accepted;
    try {
      accepted = await this.#deps.pm.startRecordConsumer(body);
    } catch (error) {
      const mapped = mapPmError(error);
      await this.#serial.run(() => this.#failStart(sessionId, mapped, 'initial'));
      return;
    }
    this.#armConfirmRace(sessionId, accepted.consumerId, TIMERS['T-START-CONFIRM'], 'initial');
  }

  async #doPause(actor: AuthContext): Promise<StartRecordingResult> {
    const session = this.#loadActiveSessionOrThrow();
    assertAuthOwner(session, actor);

    if (session.state === 'paused' || this.#inFlightPause.has(session.id)) {
      return this.#acceptedResult(); // idempotent: already paused, or a pause is already in flight
    }
    if (session.state !== 'recording') {
      throw new ProblemError(409, 'session.not-active', `Cannot pause while ${session.state}`);
    }

    const recording = this.#loadRecordingBySession(session.id);
    const consumerId = this.#activeConsumerId.get(session.id);
    const outputs = this.#outputsForPreset(recording.layoutPresetId);
    const accepted = this.#acceptedResult();

    this.#inFlightPause.add(session.id);
    void this.#finishPause(session.id, consumerId, outputs).catch((error: unknown) => {
      this.#deps.logger?.warn('recording pause: background stop failed unexpectedly', { error: describeError(error) });
    });

    return accepted;
  }

  /** R-08 (graceful) / R-09 (T-PAUSE-EOS timeout, segment truncated) — resolves entirely over the event channel, per the 202-is-acceptance rule. */
  async #finishPause(sessionId: string, consumerId: string | undefined, outputs: readonly OutputSpec[]): Promise<void> {
    try {
      const graceful = consumerId
        ? (await stopConsumerWithEosRace({ bus: this.#deps.bus, clock: this.#deps.clock }, this.#deps.pm, consumerId, TIMERS['T-PAUSE-EOS'])).graceful
        : false;

      await this.#serial.run(() => {
        const result = this.#machine.closeActiveSegment(sessionId, {
          endReason: 'pause',
          graceful,
          outputs,
          recordingsRoot: this.#deps.recordingsRoot,
          nextState: 'paused',
          bumpPauseCount: true,
        });
        this.#activeConsumerId.delete(sessionId);
        this.#deps.bus.publish('recording.state', toRecordingStatePayload(this.#deps.db, result.session, null));
        this.#deps.bus.publish('recording.segment', toRecordingSegmentPayload(result.session, result.recording, result.segment));
        void this.#deps.pm.setLed('off').catch((error: unknown) => {
          this.#deps.logger?.warn('recording pause: LED update failed', { error: describeError(error) });
        });
      });
    } finally {
      this.#inFlightPause.delete(sessionId);
    }
  }

  async #doResume(actor: AuthContext): Promise<StartRecordingResult> {
    const session = this.#loadActiveSessionOrThrow();
    assertAuthOwner(session, actor);

    if (session.state === 'recording') {
      return this.#acceptedResult(); // idempotent: already resumed
    }
    if (session.state !== 'paused') {
      throw new ProblemError(409, 'session.not-active', `Cannot resume while ${session.state}`);
    }

    assertStorageOk(this.#deps.db);
    const channel = resolveChannelValid(this.#deps.db);

    const started = this.#machine.enterResuming(session.id);
    const accepted = this.#acceptedResult();
    this.#deps.bus.publish('recording.state', toRecordingStatePayload(this.#deps.db, started, 'resume'));

    void this.#launchResumeConsumer(session.id, channel).catch((error: unknown) => {
      this.#deps.logger?.warn('recording resume: background launch failed unexpectedly', { error: describeError(error) });
    });

    return accepted;
  }

  async #launchResumeConsumer(sessionId: string, channel: ChannelValidResult): Promise<void> {
    const recording = this.#loadRecordingBySession(sessionId);
    const nextIndex = this.#nextSegmentIndex(recording.id);
    const outputs = this.#outputsForPreset(channel.layoutPreset.id);
    const body: StartRecordConsumerBody = {
      preset: channel.layoutPreset.id,
      ...buildOutputs(this.#deps.recordingsRoot, sessionId, nextIndex, outputs),
      ...(channel.channelConfig.ratioA !== null ? { ratioA: channel.channelConfig.ratioA } : {}),
      ...(channel.channelConfig.ratioB !== null ? { ratioB: channel.channelConfig.ratioB } : {}),
    };

    let accepted;
    try {
      accepted = await this.#deps.pm.startRecordConsumer(body);
    } catch (error) {
      const mapped = mapPmError(error);
      await this.#serial.run(() => this.#failStart(sessionId, mapped, 'resume'));
      return;
    }
    this.#armConfirmRace(sessionId, accepted.consumerId, TIMERS['T-RESUME-CONFIRM'], 'resume');
  }

  /** BR-2's PM leg: launches a fresh record consumer for the next segment, same shape as resume but without re-checking G-CHANNEL-VALID (BR-2's own guard list is G-DEVICE-REBOOTED/G-RECOVERY-WINDOW/G-STORAGE-OK/G-PROVISIONED only — boot-recovery.ts already checked those before returning this action). */
  async #launchRecoveryConsumer(sessionId: string): Promise<void> {
    const recording = this.#loadRecordingBySession(sessionId);
    const channelConfig = this.#deps.db.select().from(channelConfigs).where(eq(channelConfigs.channelId, 'local')).get()!;
    const outputs = this.#outputsForPreset(recording.layoutPresetId);
    const nextIndex = this.#nextSegmentIndex(recording.id);
    const body: StartRecordConsumerBody = {
      preset: recording.layoutPresetId,
      ...buildOutputs(this.#deps.recordingsRoot, sessionId, nextIndex, outputs),
      ...(channelConfig.ratioA !== null ? { ratioA: channelConfig.ratioA } : {}),
      ...(channelConfig.ratioB !== null ? { ratioB: channelConfig.ratioB } : {}),
    };

    let accepted;
    try {
      accepted = await this.#deps.pm.startRecordConsumer(body);
    } catch (error) {
      const mapped = mapPmError(error);
      await this.#serial.run(() => this.#failStart(sessionId, mapped, 'recovery'));
      return;
    }
    this.#armConfirmRace(sessionId, accepted.consumerId, TIMERS['T-START-CONFIRM'], 'recovery');
  }

  async #doStop(actor: AuthContext): Promise<StartRecordingResult> {
    const session = this.#loadActiveSessionOrThrow();
    assertAuthOwner(session, actor);

    if (session.state === 'stopping' || session.state === 'finalizing' || this.#inFlightStop.has(session.id)) {
      return this.#acceptedResult(); // idempotent: already stopping
    }
    if (session.state !== 'recording' && session.state !== 'paused') {
      throw new ProblemError(409, 'session.not-active', `Cannot stop while ${session.state}`);
    }

    const wasRecording = session.state === 'recording';
    const recording = this.#loadRecordingBySession(session.id);
    const consumerId = this.#activeConsumerId.get(session.id);
    const outputs = this.#outputsForPreset(recording.layoutPresetId);

    const stopped = this.#machine.enterStopping(session.id);
    const accepted = this.#acceptedResult();
    this.#deps.bus.publish('recording.state', toRecordingStatePayload(this.#deps.db, stopped, null));

    this.#inFlightStop.add(session.id);
    void this.#finishStop(session.id, wasRecording, consumerId, outputs).catch((error: unknown) => {
      this.#deps.logger?.warn('recording stop: background finalize failed unexpectedly', { error: describeError(error) });
    });

    return accepted;
  }

  /** R-12 (graceful) / R-13 (T-STOP-EOS timeout) when capturing, else straight through (R-11's "if capturing" branch has nothing to wait for) — then R-14/R-15 (finalizing → completed/error), all resolved over the event channel. */
  async #finishStop(sessionId: string, wasRecording: boolean, consumerId: string | undefined, outputs: readonly OutputSpec[]): Promise<void> {
    try {
      let graceful = false;
      if (wasRecording && consumerId) {
        const outcome = await stopConsumerWithEosRace({ bus: this.#deps.bus, clock: this.#deps.clock }, this.#deps.pm, consumerId, TIMERS['T-STOP-EOS']);
        graceful = outcome.graceful;
      }

      await this.#serial.run(() => {
        if (wasRecording) {
          const closed = this.#machine.closeActiveSegment(sessionId, {
            endReason: 'stop',
            graceful,
            outputs,
            recordingsRoot: this.#deps.recordingsRoot,
            nextState: 'finalizing',
            bumpPauseCount: false,
          });
          this.#activeConsumerId.delete(sessionId);
          this.#deps.bus.publish('recording.state', toRecordingStatePayload(this.#deps.db, closed.session, null));
          this.#deps.bus.publish('recording.segment', toRecordingSegmentPayload(closed.session, closed.recording, closed.segment));
        } else {
          const finalizing = this.#machine.enterFinalizingNoSegment(sessionId);
          this.#deps.bus.publish('recording.state', toRecordingStatePayload(this.#deps.db, finalizing, null));
        }

        const completed = this.#machine.completeFinalizedSession(sessionId);
        this.#deps.bus.publish('recording.state', toRecordingStatePayload(this.#deps.db, completed.session, null));
        void this.#deps.pm.setLed('off').catch((error: unknown) => {
          this.#deps.logger?.warn('recording stop: LED update failed', { error: describeError(error) });
        });
      });
    } finally {
      this.#inFlightStop.delete(sessionId);
    }
  }

  /** R-21 (G-ADMIN): synchronous — no PM call, so no background continuation is needed. */
  async #doTakeover(actor: AuthContext): Promise<StartRecordingResult> {
    const result = takeoverRecording({ db: this.#deps.db, clock: this.#deps.clock, ids: this.#deps.ids }, actor);
    const accepted = this.#acceptedResult();
    this.#deps.bus.publish('recording.state', toRecordingStatePayload(this.#deps.db, result.session, null));
    return accepted;
  }

  /** T-SESSION-HEARTBEAT (5s): a single-column UPDATE outside the serial queue (core-api.md §4.3) — the input `runBootRecovery`'s G-RECOVERY-WINDOW reads on the next boot. */
  #writeHeartbeat(): void {
    const session = this.#deps.db
      .select({ id: lectureSessions.id })
      .from(lectureSessions)
      .where(inArray(lectureSessions.state, NON_TERMINAL_STATES))
      .get();
    if (!session) return;
    this.#deps.db
      .update(lectureSessions)
      .set({ lastHeartbeatAt: this.#deps.clock.now().toISOString() })
      .where(eq(lectureSessions.id, session.id))
      .run();
  }

  /**
   * Races the pm-bridge's first `pm.status.resynced` against
   * `T-BOOT-RECOVERY`; whichever settles first runs the BR-1..BR-9 pass
   * through the serial queue, same ordering guarantee as `#armConfirmRace`.
   * `stop()` aborting this wait (PM never reachable, service shutting down
   * first) resolves with `null` — skipping the pass entirely — rather than
   * leaving the wait permanently unresolved.
   */
  async #armBootRecovery(): Promise<void> {
    const controller = new AbortController();
    this.#bootRecoveryAbort = controller;

    const status = await new Promise<PmStatus | null>((resolve) => {
      let settled = false;
      const finish = (value: PmStatus | null): void => {
        if (settled) return;
        settled = true;
        unsubscribe();
        resolve(value);
      };

      const unsubscribe = this.#deps.bus.subscribe('pm.status.resynced', (value) => {
        finish(value);
        controller.abort(); // cancel the now-unnecessary pending sleep
      });
      controller.signal.addEventListener('abort', () => finish(null), { once: true });
      this.#deps.clock.sleep(TIMERS['T-BOOT-RECOVERY'], controller.signal).then(() => finish(EMPTY_PM_STATUS));
    });

    if (status === null) return; // stop() cancelled the wait before it ever settled
    await this.#serial.run(() => this.#runBootRecoveryPass(status));
  }

  #runBootRecoveryPass(pmStatus: PmStatus): void {
    const actions = runBootRecovery(
      {
        db: this.#deps.db,
        clock: this.#deps.clock,
        ids: this.#deps.ids,
        recordingsRoot: this.#deps.recordingsRoot,
        provisioningPath: this.#deps.provisioningPath,
      },
      pmStatus,
    );
    for (const action of actions) {
      this.#applyBootRecoveryAction(action);
    }
  }

  #applyBootRecoveryAction(action: BootRecoveryAction): void {
    switch (action.kind) {
      case 'none':
        return;
      case 'adopted': {
        this.#activeConsumerId.set(action.sessionId, action.consumerId);
        const session = this.#loadSession(action.sessionId);
        this.#deps.bus.publish('recording.state', { ...toRecordingStatePayload(this.#deps.db, session, null), adopted: true });
        return;
      }
      case 'auto-resume': {
        const session = this.#loadSession(action.sessionId);
        this.#deps.bus.publish('recording.state', toRecordingStatePayload(this.#deps.db, session, 'recovery'));
        void this.#launchRecoveryConsumer(action.sessionId).catch((error: unknown) => {
          this.#deps.logger?.warn('boot recovery: auto-resume launch failed unexpectedly', { error: describeError(error) });
        });
        return;
      }
      case 'stayed-paused':
      case 'finalized': {
        const session = this.#loadSession(action.sessionId);
        this.#deps.bus.publish('recording.state', toRecordingStatePayload(this.#deps.db, session, null));
      }
    }
  }

  /** Races `evt.pm.consumer.running`/`evt.pm.consumer.failed` (filtered by `consumerId`) against `timeoutMs`; whichever settles first re-enters the serial queue to write the outcome (R-05/R-06/R-07). Shared by the initial start (T-START-CONFIRM), resume (T-RESUME-CONFIRM), and BR-2 auto-resume (T-START-CONFIRM). */
  #armConfirmRace(sessionId: string, consumerId: string, timeoutMs: number, startReason: StartReason): void {
    const controller = new AbortController();
    let settled = false;

    const finish = (work: () => Promise<void>): void => {
      if (settled) return;
      settled = true;
      unsubscribeRunning();
      unsubscribeFailed();
      controller.abort();
      this.#serial.run(work).catch((error: unknown) => {
        this.#deps.logger?.warn('recording start: confirm/timeout handling failed', { error: describeError(error) });
      });
    };

    const unsubscribeRunning = this.#deps.bus.subscribe('evt.pm.consumer.running', (payload) => {
      if (payload.consumerId !== consumerId) return;
      finish(() => this.#confirmStart(sessionId, consumerId, startReason));
    });
    const unsubscribeFailed = this.#deps.bus.subscribe('evt.pm.consumer.failed', (payload) => {
      if (payload.consumerId !== consumerId) return;
      finish(() => this.#failStart(sessionId, { code: payload.code, message: `pipeline-manager reported ${payload.code}` }, startReason));
    });

    this.#deps.clock.sleep(timeoutMs, controller.signal).then(() => {
      if (controller.signal.aborted) return; // resolved because the race was already won, not a genuine timeout
      finish(() => this.#failStart(sessionId, { code: 'confirm_timeout', message: 'pipeline-manager did not confirm the recording in time' }, startReason));
    });
  }

  async #confirmStart(sessionId: string, consumerId: string, startReason: StartReason): Promise<void> {
    const result = this.#machine.confirmRecording(sessionId);
    this.#activeConsumerId.set(sessionId, consumerId);
    this.#deps.bus.publish('recording.state', toRecordingStatePayload(this.#deps.db, result.session, startReason));
    this.#deps.bus.publish('recording.segment', toRecordingSegmentPayload(result.session, result.recording, result.segment));
    void this.#deps.pm.setLed('blink').catch((error: unknown) => {
      this.#deps.logger?.warn('recording confirm: LED update failed', { error: describeError(error) });
    });
  }

  /** R-06 (no segments — `error`) / R-07 (segments exist — preserve the lecture, SM-R-4). A resume that fails after prior segments exist has nothing capturing to wait on, so R-07 here proceeds straight through finalizing to completed/error (R-11's "if capturing" branch has no consumer). */
  async #failStart(sessionId: string, error: { code: string; message: string }, startReason: StartReason): Promise<void> {
    const result = this.#machine.failStart(sessionId, error.code, error.message);
    this.#activeConsumerId.delete(sessionId);
    this.#deps.bus.publish('recording.state', toRecordingStatePayload(this.#deps.db, result.session, startReason));
    void this.#deps.pm.setLed('off').catch((ledError: unknown) => {
      this.#deps.logger?.warn('recording fail: LED update failed', { error: describeError(ledError) });
    });

    if (result.segmentsExist) {
      const finalizing = this.#machine.enterFinalizingNoSegment(sessionId);
      this.#deps.bus.publish('recording.state', toRecordingStatePayload(this.#deps.db, finalizing, startReason));
      const completed = this.#machine.completeFinalizedSession(sessionId);
      this.#deps.bus.publish('recording.state', toRecordingStatePayload(this.#deps.db, completed.session, startReason));
    }
  }

  #loadSession(sessionId: string): typeof lectureSessions.$inferSelect {
    const session = this.#deps.db.select().from(lectureSessions).where(eq(lectureSessions.id, sessionId)).get();
    if (!session) {
      throw new Error(`recording executor: session ${sessionId} vanished immediately after creation`);
    }
    return session;
  }

  #loadActiveSessionOrThrow(): typeof lectureSessions.$inferSelect {
    const session = this.#deps.db.select().from(lectureSessions).where(inArray(lectureSessions.state, NON_TERMINAL_STATES)).get();
    if (!session) {
      throw new ProblemError(409, 'session.not-active', 'No recording is active');
    }
    return session;
  }

  #loadRecordingBySession(sessionId: string): typeof recordings.$inferSelect {
    const recording = this.#deps.db.select().from(recordings).where(eq(recordings.sessionId, sessionId)).get();
    if (!recording) {
      throw new Error(`recording executor: no recording for session ${sessionId}`);
    }
    return recording;
  }

  #nextSegmentIndex(recordingId: string): number {
    const rows = this.#deps.db
      .select({ index: recordingSegments.index })
      .from(recordingSegments)
      .where(eq(recordingSegments.recordingId, recordingId))
      .all();
    return rows.length > 0 ? Math.max(...rows.map((row) => row.index)) + 1 : 0;
  }

  #outputsForPreset(layoutPresetId: string): readonly OutputSpec[] {
    const preset = LAYOUT_PRESETS.find((entry) => entry.id === layoutPresetId);
    return preset?.outputs ?? [{ streamKey: 'main', roleIds: [], includeAudio: true }];
  }

  #acceptedResult(): StartRecordingResult {
    const now = this.#deps.clock.now();
    return { commandId: this.#deps.ids.next(now), acceptedAt: now.toISOString(), resolveBySec: TIMERS['T-CMD-RESOLVE'] / 1000 };
  }
}

/** Deterministic, opaque segment path(s) — never parsed for metadata by any consumer (SEG-7, B-02). */
function buildOutputs(
  recordingsRoot: string,
  sessionId: string,
  segmentIndex: number,
  outputs: readonly OutputSpec[],
): { outputPath?: string; outputPaths?: Record<string, string> } {
  const paths = segmentOutputPaths(recordingsRoot, sessionId, segmentIndex, outputs);
  if (outputs.length <= 1) {
    const streamKey = outputs[0]?.streamKey ?? 'main';
    return { outputPath: paths[streamKey]! }; // segmentOutputPaths always keys the single-output case by this same streamKey
  }
  return { outputPaths: paths };
}

function mapPmError(error: unknown): { code: string; message: string } {
  if (error instanceof PipelineManagerError) {
    return { code: error.problem.code, message: error.problem.title };
  }
  return { code: 'pm.unreachable', message: describeError(error) };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
