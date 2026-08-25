import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type WebSocket from 'ws';
import { z } from 'zod';
import { zQuizSyncClientMessage, zQuizSyncServerMessage } from '@eduscope/shared';
import type { QuizDb } from '../db/client.js';
import { quizSessions } from '../db/schema.js';
import type { Cancel, Clock } from '../lib/clock.js';
import type { SessionSerial } from '../lib/session-serial.js';
import { ProblemError } from '../contracts/problem.js';
import { authenticateDevice, type DevicePrincipal } from './auth.js';
import { chunkAnswers, replayAnswers } from './replay.js';
import { currentParticipantCounts, DeviceBatcher, type DeviceServerMessage } from './batchers.js';

type ClientMessage = z.infer<typeof zQuizSyncClientMessage>;
type HelloMessage = Extract<ClientMessage, { type: 'sync.hello' }>;

const HEARTBEAT_INTERVAL_MS = 5_000;
const IDLE_TIMEOUT_MS = 20_000;

export interface DeviceStreamLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface DeviceStreamHubDeps {
  db: QuizDb;
  clock: Clock;
  sessionSerial: SessionSerial;
  logger?: DeviceStreamLogger;
}

interface DeviceConnection {
  socket: WebSocket;
  quizSessionId: string;
  deviceId: string;
  writeQueue: Promise<void>;
  batcher: DeviceBatcher | null;
  heartbeatTimer: Cancel | null;
  idleController: AbortController | null;
}

/**
 * events.md §4 device-owned half: one socket per quiz session, bound only
 * once the first frame is a contract-valid `sync.hello` (B-owned — the
 * bearer authenticates the upgrade, but never binds a session by itself).
 * Replay-then-live delivery reuses the same `SessionSerial` key D-02..D-05
 * already mutate under, so an answer accepted while a hello is attaching
 * can never land between replay and live registration (D-07 step 5).
 */
export class DeviceStreamHub {
  readonly #deps: DeviceStreamHubDeps;
  readonly #connections = new Map<string, DeviceConnection>();

  constructor(deps: DeviceStreamHubDeps) {
    this.#deps = deps;
  }

  async attach(socket: WebSocket, principal: DevicePrincipal, hello: HelloMessage): Promise<void> {
    await this.#deps.sessionSerial.run(hello.quizSessionId, async () => {
      const [session] = await this.#deps.db
        .select({ deviceId: quizSessions.deviceId })
        .from(quizSessions)
        .where(eq(quizSessions.id, hello.quizSessionId));
      if (!session || session.deviceId !== principal.deviceId) {
        socket.close(1008, 'quiz session does not belong to the authenticated device');
        return;
      }

      const rows = await replayAnswers(this.#deps.db, hello.quizSessionId, hello.answerWatermark);
      const chunks = chunkAnswers(rows);

      const conn: DeviceConnection = {
        socket,
        quizSessionId: hello.quizSessionId,
        deviceId: principal.deviceId,
        writeQueue: Promise.resolve(),
        batcher: null,
        heartbeatTimer: null,
        idleController: null,
      };

      // Registering before closing any prior connection means a same-tick
      // 'close' from the old socket already sees the new entry and no-ops
      // (mirrors StudentStreamHub's reconnect-supersede invariant).
      const existing = this.#connections.get(hello.quizSessionId);
      this.#connections.set(hello.quizSessionId, conn);
      if (existing) {
        this.#teardown(existing);
        existing.socket.close(4000, 'superseded by a new connection');
      }

      let watermark = hello.answerWatermark;
      for (const chunk of chunks) {
        this.#send(conn, { type: 'sync.answers', quizSessionId: hello.quizSessionId, answers: chunk });
        watermark = chunk[chunk.length - 1]!.seq;
      }

      const counts = await currentParticipantCounts(this.#deps.db, hello.quizSessionId);
      this.#send(conn, { type: 'sync.participants', quizSessionId: hello.quizSessionId, ...counts });

      conn.batcher = new DeviceBatcher(
        { db: this.#deps.db, clock: this.#deps.clock, send: (message) => this.#send(conn, message) },
        hello.quizSessionId,
        watermark,
      );
      conn.batcher.start();
      conn.heartbeatTimer = this.#deps.clock.every(HEARTBEAT_INTERVAL_MS, () =>
        this.#send(conn, { type: 'sync.heartbeat', at: this.#deps.clock.now().toISOString() }),
      );
      this.#armIdle(conn);

      socket.on('message', (data: WebSocket.RawData) => this.#onMessage(conn, data));
      socket.on('close', () => this.#detach(conn));
      socket.on('error', () => this.#detach(conn));
    });
  }

  /** D-05 acceptance enqueues only after commit; a no-op if this session has no live socket (PostgreSQL remains the replay log). */
  enqueueAnswer(quizSessionId: string): void {
    this.#connections.get(quizSessionId)?.batcher?.markAnswersDirty();
  }

  /** Called by D-04 registration and D-06 connect/disconnect after their own commit. */
  markParticipantCounts(quizSessionId: string): void {
    this.#connections.get(quizSessionId)?.batcher?.markParticipantsDirty();
  }

  #onMessage(conn: DeviceConnection, data: WebSocket.RawData): void {
    let parsed: ClientMessage;
    try {
      parsed = zQuizSyncClientMessage.parse(JSON.parse(data.toString()));
    } catch (error) {
      this.#deps.logger?.warn('quiz-sync device stream: dropped an unparsable frame', {
        quizSessionId: conn.quizSessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    void parsed;
    // Any contract-valid client frame — hello would never recur, but a
    // heartbeat is the steady-state case — counts as liveness.
    this.#armIdle(conn);
  }

  #armIdle(conn: DeviceConnection): void {
    conn.idleController?.abort();
    const controller = new AbortController();
    conn.idleController = controller;
    this.#deps.clock.sleep(IDLE_TIMEOUT_MS, controller.signal).then(() => {
      if (controller.signal.aborted) return;
      if (this.#connections.get(conn.quizSessionId) !== conn) return;
      this.#connections.delete(conn.quizSessionId);
      this.#teardown(conn);
      conn.socket.close(1008, 'no activity within the liveness window');
    });
  }

  #detach(conn: DeviceConnection): void {
    if (this.#connections.get(conn.quizSessionId) !== conn) return;
    this.#connections.delete(conn.quizSessionId);
    this.#teardown(conn);
  }

  #teardown(conn: DeviceConnection): void {
    conn.batcher?.stop();
    conn.heartbeatTimer?.cancel();
    conn.idleController?.abort();
  }

  #send(conn: DeviceConnection, message: DeviceServerMessage): void {
    const parsed = zQuizSyncServerMessage.safeParse(message);
    if (!parsed.success) {
      this.#deps.logger?.warn('quiz-sync device stream: dropped an invalid outgoing frame', {
        quizSessionId: conn.quizSessionId,
      });
      if (this.#connections.get(conn.quizSessionId) === conn) {
        this.#connections.delete(conn.quizSessionId);
      }
      this.#teardown(conn);
      conn.socket.close(1011, 'internal error');
      return;
    }

    const data = JSON.stringify(parsed.data);
    conn.writeQueue = conn.writeQueue.then(
      () =>
        new Promise<void>((resolve) => {
          if (conn.socket.readyState !== conn.socket.OPEN) {
            resolve();
            return;
          }
          conn.socket.send(data, () => resolve());
        }),
    );
  }
}

/** See device/session-routes.ts's `authenticateDevice` — its `ProblemError` has `.status`, not the `.statusCode` `@fastify/websocket` reads to deny an upgrade (mirrors student/stream.ts's `StudentStreamAuthError`). */
class DeviceStreamAuthError extends Error {
  readonly statusCode: number;
  constructor(status: number, message: string) {
    super(message);
    this.statusCode = status;
  }
}

function makeDeviceStreamPreHandler(deviceUpgradeAllowed: () => boolean) {
  return async function deviceStreamPreHandler(request: FastifyRequest): Promise<void> {
    if (!deviceUpgradeAllowed()) {
      throw new DeviceStreamAuthError(503, 'device stream unavailable');
    }
    try {
      await authenticateDevice(request);
    } catch (error) {
      if (error instanceof ProblemError) {
        throw new DeviceStreamAuthError(error.status, error.title);
      }
      throw error;
    }
  };
}

/**
 * Registers the device-bearer-authenticated `GET /api/device/v1/stream`
 * upgrade (events.md §4). `deviceUpgradeAllowed` is a D-08 test-only seam
 * (DR-22) for simulating the stream becoming unavailable; production always
 * omits it and always allows an authenticated upgrade.
 */
export function registerDeviceStreamRoutes(app: FastifyInstance, hub: DeviceStreamHub, deviceUpgradeAllowed: () => boolean = () => true): void {
  app.get(
    '/api/device/v1/stream',
    { websocket: true, preHandler: makeDeviceStreamPreHandler(deviceUpgradeAllowed) },
    (socket, request) => {
      const principal = request.deviceContext!;

      const onFirstMessage = (data: WebSocket.RawData): void => {
        socket.off('message', onFirstMessage);

        let parsed: ClientMessage;
        try {
          parsed = zQuizSyncClientMessage.parse(JSON.parse(data.toString()));
        } catch {
          socket.close(1008, 'first frame must be a valid sync.hello');
          return;
        }
        if (parsed.type !== 'sync.hello') {
          socket.close(1008, 'first frame must be sync.hello');
          return;
        }
        if (parsed.deviceId !== principal.deviceId) {
          socket.close(1008, 'hello deviceId does not match the authenticated bearer');
          return;
        }

        void hub.attach(socket, principal, parsed);
      };

      socket.on('message', onFirstMessage);
    },
  );
}
