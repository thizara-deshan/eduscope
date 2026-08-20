import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type WebSocket from 'ws';
import {
  PANEL_EVENT_NAMES,
  zEventEnvelope,
  zLogEntry,
  type AiSetPayload,
  type ChannelStatePayload,
  type PanelEventName,
  type PanelServerEvent,
  type PublicationWithQuestion,
  type QuizPublicationPayload,
  type QuizSessionPayload,
  type RecordingStatePayload,
} from '@eduscope/shared';
import { ProblemError } from '../../contracts/problem.js';
import type { DrizzleDb } from '../../db/client.js';
import { channelConfigs } from '../../db/schema.js';
import type { Clock } from '../../lib/clock.js';
import type { DomainBus, Unsubscribe } from '../../lib/domain-bus.js';
import type { LifecycleComponent, LifecycleStopReason } from '../../lifecycle.js';
import { listQuestionSets } from '../ai/question-sets.js';
import type { AuthContext, AuthService } from '../auth/service.js';
import type { ScopedSubscriptionRegistry } from '../export/subscriptions.js';
import { BackpressureTracker } from './backpressure.js';
import { shouldDeliver } from './subscriptions.js';

/**
 * `log.entry` (events.md §2.11) belongs to B-37's `LogStore`, which does not
 * exist yet — the hub still owns routing/scoping for it (its stream is one of
 * the three CG-3 scoped ones), so it declares the domain-bus shape here. B-37
 * reuses this same augmentation (identical declarations merge) when it starts
 * publishing.
 */
type LogEntryPayload = z.infer<typeof zLogEntry>;

declare module '../../lib/domain-bus.js' {
  interface CoreDomainEvents {
    'log.entry': LogEntryPayload;
  }
}

type PayloadFor<K extends PanelEventName> = Extract<PanelServerEvent, { event: K }>['payload'];

export interface PanelHubLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface PanelHubDeps {
  db: DrizzleDb;
  clock: Clock;
  bus: DomainBus;
  scopedSubscriptions: ScopedSubscriptionRegistry;
  recording: { getState(): RecordingStatePayload };
  channels: { listStatuses(): ChannelStatePayload[] };
  sources: { getStatus(): PayloadFor<'sources.status'>[] };
  storage: { snapshot(): PayloadFor<'storage.status'> };
  health: { snapshot(): PayloadFor<'device.health'> };
  countdown: { snapshot(): PayloadFor<'ai.countdown'> };
  quizSession: { snapshot(): { state: QuizSessionPayload['state']; quizSessionId: string | null; joinUrl: string | null; joinCode: string | null; joinedCount: number; syncState: QuizSessionPayload['syncState'] | null } };
  alerts: { list(includeCleared: boolean): PayloadFor<'system.alert'>[] };
  publications: { listPublications(sessionId: string): PublicationWithQuestion[] };
  logger?: PanelHubLogger;
}

/** Per-connection seq counter + outbound backpressure tracker (design/core-api.md §5, B-35 step 1). */
class PanelConnection {
  readonly socket: WebSocket;
  readonly authSessionId: string;
  #seq = 0;
  readonly #backpressure = new BackpressureTracker();
  readonly #logger: PanelHubLogger | undefined;

  constructor(socket: WebSocket, authSessionId: string, logger?: PanelHubLogger) {
    this.socket = socket;
    this.authSessionId = authSessionId;
    this.#logger = logger;
  }

  nextSeq(): number {
    const seq = this.#seq;
    this.#seq += 1;
    return seq;
  }

  /** Closes instead of queuing further once the connection is this far behind (>256 events or >1 MiB, B-35 step 1) — clients recover via full snapshot, never server replay. */
  send(envelope: unknown): void {
    const data = JSON.stringify(envelope);
    const byteLength = Buffer.byteLength(data, 'utf8');
    if (this.#backpressure.wouldExceed(byteLength)) {
      this.#logger?.warn('closing panel connection: backpressure limit exceeded', { authSessionId: this.authSessionId });
      this.socket.close(1008, 'backpressure limit exceeded');
      return;
    }
    this.#backpressure.enqueue(byteLength);
    this.socket.send(data, () => this.#backpressure.dequeue(byteLength));
  }
}

/** local mirrors machine 1a — its runtime state is the active LectureSession, never a second source of truth (design/core-api.md §11, mirrors settings/channel-routes.ts's localChannelStatus). */
function localChannelRuntimeState(recordingState: RecordingStatePayload['state']): ChannelStatePayload['state'] {
  if (recordingState === 'starting') return 'starting';
  if (recordingState === 'recording' || recordingState === 'paused') return 'on';
  if (recordingState === 'stopping' || recordingState === 'finalizing') return 'stopping';
  return 'off';
}

/**
 * Fan-out-only WS hub (events.md §1/§2): authenticates on upgrade, replays
 * the on-subscribe snapshot, then mirrors every subsequent domain-bus event
 * to every connection whose scope allows it. Never writes domain state —
 * commands stay on REST (SM-R-1). `audio.levels` is subscribed to the bus
 * only while >=1 connection is open (B-09's `listenerCount` budget gate).
 */
export class PanelHub implements LifecycleComponent {
  readonly name = 'panel-hub';

  readonly #deps: PanelHubDeps;
  readonly #connections = new Set<PanelConnection>();
  #unsubs: Unsubscribe[] = [];
  #audioUnsub: Unsubscribe | null = null;
  #stopped = false;

  constructor(deps: PanelHubDeps) {
    this.#deps = deps;
  }

  async start(): Promise<void> {
    for (const name of PANEL_EVENT_NAMES) {
      if (name === 'audio.levels') continue; // lazily ref-counted below instead
      this.#unsubs.push(this.#deps.bus.subscribe(name, (payload) => this.publish(name, payload as never)));
    }
  }

  async stop(_reason: LifecycleStopReason): Promise<void> {
    this.#stopped = true;
    for (const unsub of this.#unsubs) unsub();
    this.#unsubs = [];
    this.#unsubscribeAudio();
    for (const conn of this.#connections) conn.socket.close(1001, 'server is shutting down');
    this.#connections.clear();
  }

  /** Fans a domain-bus transition out to every connection its scope allows (events.md §1 "Scoping"). */
  publish<K extends PanelEventName>(event: K, payload: PayloadFor<K>): void {
    for (const conn of this.#connections) {
      if (!shouldDeliver(event, payload, conn.authSessionId, this.#deps.scopedSubscriptions)) continue;
      this.#deliverTo(conn, event, payload);
    }
  }

  /** Called by the WS route handler once `wsAuthGuard` has authenticated the upgrade. */
  handleConnection(socket: WebSocket, authContext: AuthContext): void {
    if (this.#stopped) {
      socket.close(1001, 'server is shutting down');
      return;
    }

    const conn = new PanelConnection(socket, authContext.authSessionId, this.#deps.logger);
    this.#connections.add(conn);
    if (this.#connections.size === 1) this.#subscribeAudio();

    // Deferred one tick: writing frames synchronously inside the upgrade
    // callback can race the still-in-flight "101 Switching Protocols"
    // response on some transports (observed with the in-process injectWS
    // harness, where a same-tick write gets coalesced into the same chunk
    // as the handshake response and its `head` bytes are discarded).
    setImmediate(() => {
      if (socket.readyState === socket.OPEN) this.#sendSnapshot(conn);
    });

    socket.on('message', () => {
      // Server->client only (events.md §1 "Direction"); any inbound frame is a protocol violation.
      socket.close(1008, 'panel connections do not send frames');
    });
    const forget = (): void => {
      this.#connections.delete(conn);
      if (this.#connections.size === 0) this.#unsubscribeAudio();
    };
    socket.on('close', forget);
    socket.on('error', forget);
  }

  #subscribeAudio(): void {
    if (this.#audioUnsub) return;
    this.#audioUnsub = this.#deps.bus.subscribe('audio.levels', (payload) => this.publish('audio.levels', payload));
  }

  #unsubscribeAudio(): void {
    this.#audioUnsub?.();
    this.#audioUnsub = null;
  }

  /** On-subscribe snapshot (events.md §1): recording, channel.state x3, sources.status x role, storage, health, countdown, current ai.set, open quiz.publication, quiz.session, every uncleared alert — then live deltas. */
  #sendSnapshot(conn: PanelConnection): void {
    const recordingState = this.#deps.recording.getState();
    this.#deliverTo(conn, 'recording.state', recordingState);

    this.#deliverTo(conn, 'channel.state', this.#localChannelState(recordingState));
    for (const status of this.#deps.channels.listStatuses()) {
      this.#deliverTo(conn, 'channel.state', status);
    }

    for (const status of this.#deps.sources.getStatus()) {
      this.#deliverTo(conn, 'sources.status', status);
    }

    this.#deliverTo(conn, 'storage.status', this.#deps.storage.snapshot());
    this.#deliverTo(conn, 'device.health', this.#deps.health.snapshot());
    this.#deliverTo(conn, 'ai.countdown', this.#deps.countdown.snapshot());

    const sessionId = recordingState.sessionId;
    if (sessionId !== null) {
      const currentSet = this.#currentQuestionSetPayload(sessionId);
      if (currentSet) this.#deliverTo(conn, 'ai.set', currentSet);

      const openPublication = this.#openPublicationPayload(sessionId);
      if (openPublication) this.#deliverTo(conn, 'quiz.publication', openPublication);
    }

    this.#deliverTo(conn, 'quiz.session', this.#quizSessionPayload());

    for (const alert of this.#deps.alerts.list(false)) {
      this.#deliverTo(conn, 'system.alert', alert);
    }
  }

  #localChannelState(recordingState: RecordingStatePayload): ChannelStatePayload {
    const config = this.#deps.db.select().from(channelConfigs).where(eq(channelConfigs.channelId, 'local')).get()!;
    return {
      channelId: 'local',
      state: localChannelRuntimeState(recordingState.state),
      presetId: config.presetId as ChannelStatePayload['presetId'],
      ratioA: config.ratioA,
      ratioB: config.ratioB,
      reason: null,
    };
  }

  #currentQuestionSetPayload(sessionId: string): AiSetPayload | null {
    const [latest] = listQuestionSets(this.#deps.db, sessionId);
    if (!latest) return null;
    return {
      setId: latest.id,
      sessionId: latest.sessionId,
      state: latest.state,
      trigger: latest.trigger,
      count: latest.returnedCount,
      error: latest.error as AiSetPayload['error'],
      attempt: 0,
    };
  }

  #openPublicationPayload(sessionId: string): QuizPublicationPayload | null {
    const open = this.#deps.publications.listPublications(sessionId).find((pub) => pub.state === 'open');
    if (!open) return null;
    return {
      publicationId: open.id,
      questionId: open.questionId,
      state: open.state,
      isShowing: open.isShowing,
      projectorState: open.projectorState,
      syncState: open.syncState,
      closeReason: open.closeReason,
    };
  }

  #quizSessionPayload(): QuizSessionPayload {
    const projection = this.#deps.quizSession.snapshot();
    return {
      state: projection.state,
      quizSessionId: projection.quizSessionId,
      joinUrl: projection.joinUrl,
      joinCode: projection.joinCode,
      joinedCount: projection.joinedCount,
      // The emitter always holds a concrete sync state once a session exists; `null` only precedes the first sync attempt (mirrors QuizSessionMachine's own bus-event mapping).
      syncState: projection.syncState ?? 'synced',
    };
  }

  #deliverTo(conn: PanelConnection, event: PanelEventName, payload: unknown): void {
    const candidate = { event, payload, at: this.#deps.clock.now().toISOString(), seq: 0 };
    const parsed = zEventEnvelope.safeParse(candidate);
    if (!parsed.success) {
      this.#deps.logger?.warn('dropped invalid outgoing panel event', { event, issues: parsed.error.issues.map((issue) => issue.message) });
      return;
    }
    conn.send({ ...parsed.data, seq: conn.nextSeq() });
  }
}

function parseProtocolToken(header: string | undefined): string {
  if (!header) throw new ProblemError(401, 'auth.invalid-credentials', 'Missing bearer token');
  const values = header
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (values.length !== 1) {
    throw new ProblemError(401, 'auth.invalid-credentials', 'Expected exactly one Sec-WebSocket-Protocol value');
  }
  return values[0]!;
}

/** WS-transport equivalent of `requireAuth` (DR-05): the raw access JWT travels as the sole `Sec-WebSocket-Protocol` value, never a `?token=` query. */
function wsAuthGuard(authService: AuthService) {
  return async (request: FastifyRequest): Promise<void> => {
    const token = parseProtocolToken(request.headers['sec-websocket-protocol']);
    const context = await authService.authenticate(token);
    if (context.mustResetPassword) {
      throw new ProblemError(403, 'auth.password-reset-required', 'Password reset required');
    }
    request.authContext = context;
  };
}

/** Registers the one B-35 upgrade route: `GET /api/v1/ws` (not a contract operationId — one of B-38's two named WS upgrades). */
export function registerPanelHub(app: FastifyInstance, authService: AuthService, hub: PanelHub): void {
  app.get(
    '/api/v1/ws',
    { websocket: true, preHandler: wsAuthGuard(authService) },
    (socket, request) => {
      hub.handleConnection(socket, request.authContext!);
    },
  );
}
