import { LAYOUT_PRESETS, TIMERS } from '@eduscope/shared';
import { eq } from 'drizzle-orm';
import type { DrizzleDb } from '../../db/client.js';
import { lectureSessions } from '../../db/schema.js';
import type { Clock } from '../../lib/clock.js';
import type { DomainBus } from '../../lib/domain-bus.js';
import type { IdGenerator } from '../../lib/ids.js';
import { SerialExecutor } from '../../lib/serial-executor.js';
import type { AuthContext } from '../auth/service.js';
import { runStartGuards, type ChannelValidResult } from './guards.js';
import { RecordingMachine } from './machine.js';
import type { PipelineManagerClient, StartRecordConsumerBody } from './pm/client.js';
import { PipelineManagerError } from './pm/types.js';
import { getRecordingStateSnapshot, toRecordingSegmentPayload, toRecordingStatePayload } from './snapshots.js';

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

export class RecordingExecutor {
  readonly #deps: RecordingExecutorDeps;
  readonly #machine: RecordingMachine;
  readonly #serial = new SerialExecutor();

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

  getState(): ReturnType<typeof getRecordingStateSnapshot> {
    return getRecordingStateSnapshot(this.#deps.db);
  }

  async startRecording(actor: AuthContext): Promise<StartRecordingResult> {
    return this.#serial.run(() => this.#doStart(actor));
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
    void this.#launchPmConsumer(created.sessionId, created.recordingId, guardResult.channel).catch((error: unknown) => {
      this.#deps.logger?.warn('recording start: background launch failed unexpectedly', { error: describeError(error) });
    });

    return { commandId, acceptedAt, resolveBySec: TIMERS['T-CMD-RESOLVE'] / 1000 };
  }

  async #launchPmConsumer(sessionId: string, recordingId: string, channel: ChannelValidResult): Promise<void> {
    const preset = LAYOUT_PRESETS.find((entry) => entry.id === channel.layoutPreset.id);
    const body: StartRecordConsumerBody = {
      preset: channel.layoutPreset.id,
      ...buildOutputs(this.#deps.recordingsRoot, sessionId, 0, preset?.outputs ?? [{ streamKey: 'main' }]),
      ...(channel.channelConfig.ratioA !== null ? { ratioA: channel.channelConfig.ratioA } : {}),
      ...(channel.channelConfig.ratioB !== null ? { ratioB: channel.channelConfig.ratioB } : {}),
    };

    let accepted;
    try {
      accepted = await this.#deps.pm.startRecordConsumer(body);
    } catch (error) {
      const mapped = mapPmError(error);
      await this.#serial.run(() => this.#failStart(sessionId, mapped));
      return;
    }
    this.#armConfirmRace(sessionId, recordingId, accepted.consumerId);
  }

  /** Races `evt.pm.consumer.running`/`evt.pm.consumer.failed` (filtered by `consumerId`) against `T-START-CONFIRM`; whichever settles first re-enters the serial queue to write the outcome (R-05/R-06/R-07). */
  #armConfirmRace(sessionId: string, recordingId: string, consumerId: string): void {
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
      finish(() => this.#confirmStart(sessionId, recordingId));
    });
    const unsubscribeFailed = this.#deps.bus.subscribe('evt.pm.consumer.failed', (payload) => {
      if (payload.consumerId !== consumerId) return;
      finish(() => this.#failStart(sessionId, { code: payload.code, message: `pipeline-manager reported ${payload.code}` }));
    });

    this.#deps.clock.sleep(TIMERS['T-START-CONFIRM'], controller.signal).then(() => {
      if (controller.signal.aborted) return; // resolved because the race was already won, not a genuine timeout
      finish(() => this.#failStart(sessionId, { code: 'confirm_timeout', message: 'pipeline-manager did not confirm the recording in time' }));
    });
  }

  async #confirmStart(sessionId: string, _recordingId: string): Promise<void> {
    const result = this.#machine.confirmRecording(sessionId);
    this.#deps.bus.publish('recording.state', toRecordingStatePayload(this.#deps.db, result.session, 'initial'));
    this.#deps.bus.publish('recording.segment', toRecordingSegmentPayload(result.session, result.recording, result.segment));
    void this.#deps.pm.setLed('blink').catch((error: unknown) => {
      this.#deps.logger?.warn('recording confirm: LED update failed', { error: describeError(error) });
    });
  }

  async #failStart(sessionId: string, error: { code: string; message: string }): Promise<void> {
    const result = this.#machine.failStart(sessionId, error.code, error.message);
    this.#deps.bus.publish('recording.state', toRecordingStatePayload(this.#deps.db, result.session, 'initial'));
    void this.#deps.pm.setLed('off').catch((ledError: unknown) => {
      this.#deps.logger?.warn('recording fail: LED update failed', { error: describeError(ledError) });
    });
  }

  #loadSession(sessionId: string): typeof lectureSessions.$inferSelect {
    const session = this.#deps.db.select().from(lectureSessions).where(eq(lectureSessions.id, sessionId)).get();
    if (!session) {
      throw new Error(`recording executor: session ${sessionId} vanished immediately after creation`);
    }
    return session;
  }
}

/** Deterministic, opaque segment path(s) — never parsed for metadata by any consumer (SEG-7, B-02). */
function buildOutputs(
  recordingsRoot: string,
  sessionId: string,
  segmentIndex: number,
  outputs: readonly { streamKey: string }[],
): { outputPath?: string; outputPaths?: Record<string, string> } {
  const paddedIndex = String(segmentIndex).padStart(3, '0');
  const base = `${recordingsRoot}/sessions/${sessionId}`;
  if (outputs.length <= 1) {
    return { outputPath: `${base}/seg-${paddedIndex}.ts` };
  }
  const outputPaths: Record<string, string> = {};
  for (const output of outputs) {
    outputPaths[output.streamKey] = `${base}/seg-${paddedIndex}-${output.streamKey}.ts`;
  }
  return { outputPaths };
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
