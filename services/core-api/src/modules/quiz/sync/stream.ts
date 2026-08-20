import WebSocket from 'ws';
import { z } from 'zod';
import { TIMERS, WS_RECONNECT_BACKOFF_MS, zQuizSyncClientMessage, zQuizSyncServerMessage } from '@eduscope/shared';
import type { DrizzleDb } from '../../../db/client.js';
import type { Cancel, Clock } from '../../../lib/clock.js';
import { ReconnectBackoff } from '../../../lib/reconnect.js';
import type { DomainBus, Unsubscribe } from '../../../lib/domain-bus.js';
import type { LifecycleComponent, LifecycleStopReason } from '../../../lifecycle.js';
import { ingestAnswers } from '../responses.js';
import type { QuizSessionMachine } from '../session.js';
import { currentWatermark } from './replay.js';

type ClientMessage = z.infer<typeof zQuizSyncClientMessage>;
type ServerMessage = z.infer<typeof zQuizSyncServerMessage>;

function toWsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/api/device/v1/stream`;
}

export interface QuizSyncStreamLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface QuizSyncStreamDeps {
  db: DrizzleDb;
  clock: Clock;
  bus: DomainBus;
  sessionMachine: Pick<QuizSessionMachine, 'recordSyncActivity' | 'recordParticipants' | 'snapshot'>;
  quizServerBaseUrl: () => string | null;
  bearerToken: () => string | null;
  deviceId: () => string;
  /** Test seam — production always constructs a real `ws.WebSocket`. */
  wsFactory?: (url: string, headers: Record<string, string>) => WebSocket;
  logger?: QuizSyncStreamLogger;
}

/**
 * Machine 4d's device-initiated half (events.md §4, state-machines.md §5.4):
 * the one WS connection to `wss://{quizServerBaseUrl}/api/device/v1/stream`,
 * opened only while a quiz session is `open` (B-33's `quiz.session` event).
 * Sends `sync.hello` first (B-owned — the only client-originated frame this
 * contract test suite owns; `sync.answers`/`sync.participants` are D-owned)
 * with the durable watermark (`replay.ts`), then `sync.heartbeat` every
 * `T-QUIZ-HEARTBEAT`. Every inbound frame — heartbeat included — counts as
 * sync-link activity (`QuizSessionMachine.recordSyncActivity`); answers are
 * ingested through B-33's `responses.ts` (idempotent upsert, so a duplicate
 * replay after reconnect is a no-op). Reconnects on any close/error with
 * unlimited attempts and no separate connection ever opens while one is
 * already live or pending (`#activeQuizSessionId` guards re-entry).
 */
export class QuizSyncStream implements LifecycleComponent {
  readonly name = 'quiz-sync-stream';

  readonly #deps: QuizSyncStreamDeps;
  readonly #backoff = new ReconnectBackoff(WS_RECONNECT_BACKOFF_MS);
  #unsubscribeSession: Unsubscribe | null = null;
  #socket: WebSocket | null = null;
  #heartbeatTimer: Cancel | null = null;
  #reconnectController: AbortController | null = null;
  #activeQuizSessionId: string | null = null;
  #stopped = false;

  constructor(deps: QuizSyncStreamDeps) {
    this.#deps = deps;
  }

  async start(): Promise<void> {
    this.#stopped = false;
    this.#unsubscribeSession = this.#deps.bus.subscribe('quiz.session', (payload) => {
      if (payload.state === 'open' && payload.quizSessionId !== null) {
        this.#ensureConnected(payload.quizSessionId);
      } else if (this.#activeQuizSessionId !== null) {
        this.#teardown();
      }
    });

    // `QuizSessionMachine` (registered/started before this component) may already have adopted an `open`
    // session from a prior boot — its own start() ran and published before this subscription existed.
    const initial = this.#deps.sessionMachine.snapshot();
    if (initial.state === 'open' && initial.quizSessionId !== null) {
      this.#ensureConnected(initial.quizSessionId);
    }
  }

  async stop(_reason: LifecycleStopReason): Promise<void> {
    this.#stopped = true;
    this.#unsubscribeSession?.();
    this.#unsubscribeSession = null;
    this.#teardown();
  }

  #ensureConnected(quizSessionId: string): void {
    if (this.#stopped) return;
    if (this.#activeQuizSessionId === quizSessionId && this.#socket !== null) return; // one active stream
    if (this.#activeQuizSessionId !== null && this.#activeQuizSessionId !== quizSessionId) {
      this.#teardown();
    }
    this.#activeQuizSessionId = quizSessionId;
    this.#backoff.reset();
    this.#connect(quizSessionId);
  }

  #connect(quizSessionId: string): void {
    if (this.#stopped || this.#activeQuizSessionId !== quizSessionId) return;
    const baseUrl = this.#deps.quizServerBaseUrl();
    if (baseUrl === null) return;

    const headers: Record<string, string> = {
      authorization: `Bearer ${this.#deps.bearerToken() ?? ''}`,
      'x-eduscope-contract': '1.0',
    };
    const socket = this.#deps.wsFactory ? this.#deps.wsFactory(toWsUrl(baseUrl), headers) : new WebSocket(toWsUrl(baseUrl), { headers });
    this.#socket = socket;

    socket.on('open', () => {
      if (this.#socket !== socket) return; // superseded by a later connect/teardown
      this.#backoff.reset();
      this.#sendHello(quizSessionId);
      this.#armHeartbeat();
    });

    socket.on('message', (data: WebSocket.RawData) => {
      if (this.#socket !== socket) return;
      this.#onMessage(quizSessionId, data);
    });

    socket.on('close', () => {
      if (this.#socket !== socket) return;
      this.#socket = null;
      this.#heartbeatTimer?.cancel();
      this.#heartbeatTimer = null;
      this.#scheduleReconnect(quizSessionId);
    });

    socket.on('error', (error: Error) => {
      this.#deps.logger?.warn('quiz-sync stream: socket error', { error: error.message });
    });
  }

  #scheduleReconnect(quizSessionId: string): void {
    if (this.#stopped || this.#activeQuizSessionId !== quizSessionId) return;
    const delayMs = this.#backoff.next();
    const controller = new AbortController();
    this.#reconnectController = controller;
    this.#deps.clock.sleep(delayMs, controller.signal).then(() => {
      if (controller.signal.aborted) return;
      this.#connect(quizSessionId);
    });
  }

  #sendHello(quizSessionId: string): void {
    const message: ClientMessage = {
      type: 'sync.hello',
      deviceId: this.#deps.deviceId(),
      quizSessionId,
      answerWatermark: currentWatermark(this.#deps.db, quizSessionId),
    };
    this.#send(message);
  }

  #armHeartbeat(): void {
    this.#heartbeatTimer?.cancel();
    this.#heartbeatTimer = this.#deps.clock.every(TIMERS['T-QUIZ-HEARTBEAT'], () => {
      this.#send({ type: 'sync.heartbeat', at: this.#deps.clock.now().toISOString() });
    });
  }

  #send(message: ClientMessage): void {
    if (this.#socket === null || this.#socket.readyState !== WebSocket.OPEN) return;
    // Runs inside WS event-emitter callbacks (no surrounding promise chain) — a thrown validation error here
    // would otherwise surface as an uncaught exception rather than a handled failure.
    let validated: ClientMessage;
    try {
      validated = zQuizSyncClientMessage.parse(message);
    } catch (error) {
      this.#deps.logger?.warn('quiz-sync stream: refused to send an invalid frame', { error: error instanceof Error ? error.message : String(error) });
      return;
    }
    this.#socket.send(JSON.stringify(validated));
  }

  #onMessage(quizSessionId: string, data: WebSocket.RawData): void {
    let parsed: ServerMessage;
    try {
      parsed = zQuizSyncServerMessage.parse(JSON.parse(data.toString()));
    } catch (error) {
      this.#deps.logger?.warn('quiz-sync stream: dropped an unparsable frame', { error: error instanceof Error ? error.message : String(error) });
      return;
    }

    if (parsed.type === 'sync.heartbeat') {
      this.#deps.sessionMachine.recordSyncActivity();
      return;
    }

    // Device/session scope (INV-AP-2 spirit): a frame naming a different quiz session than the one this socket
    // was opened for is out of scope for the active connection and is dropped rather than cross-applied.
    if (parsed.quizSessionId !== quizSessionId) {
      this.#deps.logger?.warn('quiz-sync stream: dropped a frame scoped to a different quiz session', { received: parsed.quizSessionId, active: quizSessionId });
      return;
    }

    if (parsed.type === 'sync.answers') {
      ingestAnswers({ db: this.#deps.db, clock: this.#deps.clock, bus: this.#deps.bus }, quizSessionId, parsed.answers);
      this.#deps.sessionMachine.recordSyncActivity();
      return;
    }

    // sync.participants
    this.#deps.sessionMachine.recordParticipants(parsed.joinedCount);
  }

  #teardown(): void {
    this.#activeQuizSessionId = null;
    this.#backoff.reset();
    this.#reconnectController?.abort();
    this.#reconnectController = null;
    this.#heartbeatTimer?.cancel();
    this.#heartbeatTimer = null;
    const socket = this.#socket;
    this.#socket = null;
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      socket.removeAllListeners();
      socket.terminate();
    }
  }
}
