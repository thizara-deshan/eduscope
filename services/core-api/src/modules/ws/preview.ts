import type { FastifyInstance } from 'fastify';
import type WebSocket from 'ws';
import {
  zPreviewClientMessage,
  zPreviewServerMessage,
  type PreviewServerMessage,
  type SourceRoleId,
  type SourcesStatusPayload,
} from '@eduscope/shared';
import type { DomainBus, Unsubscribe } from '../../lib/domain-bus.js';
import type { LifecycleComponent, LifecycleStopReason } from '../../lifecycle.js';
import type { AuthContext, AuthService } from '../auth/service.js';
import { PipelineManagerError, type PmThumbnailAnswerData, type PmThumbnailErrorData, type PmThumbnailIceData } from '../recording/pm/types.js';
import type { PipelineManagerClient } from '../recording/pm/client.js';
import { wsAuthGuard } from './panel-hub.js';

export interface PreviewBrokerLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface PreviewBrokerDeps {
  pm: PipelineManagerClient;
  bus: DomainBus;
  sources: { getStatus(): SourcesStatusPayload[] };
  logger?: PreviewBrokerLogger;
}

type PreviewErrorCode = Extract<PreviewServerMessage, { type: 'error' }>['code'];

/** One panel connection on the preview socket; at most one active negotiation (events.md §3 "one negotiation per open preview"). */
class PreviewConnection {
  readonly socket: WebSocket;
  readonly authSessionId: string;
  negotiationId: string | null = null;
  readonly #logger: PreviewBrokerLogger | undefined;

  constructor(socket: WebSocket, authSessionId: string, logger?: PreviewBrokerLogger) {
    this.socket = socket;
    this.authSessionId = authSessionId;
    this.#logger = logger;
  }

  send(message: PreviewServerMessage): void {
    const parsed = zPreviewServerMessage.safeParse(message);
    if (!parsed.success) {
      this.#logger?.warn('dropped invalid outgoing preview message', { issues: parsed.error.issues.map((issue) => issue.message) });
      return;
    }
    this.socket.send(JSON.stringify(parsed.data));
  }
}

interface NegotiationEntry {
  conn: PreviewConnection;
  roleId: SourceRoleId;
}

/**
 * Preview signaling broker (events.md §3, design/core-api.md §9.4). Validates
 * the role is `online` (machine 5a's own B-09 projection — never PM's stub
 * response) before forwarding `offer`/`ice`/`close` 1:1 to pipeline-manager's
 * thumbnail endpoints, and fans `evt.pm.thumbnail.*` back to the owning
 * connection by `negotiationId`. Media stays entirely in A; this hub only
 * brokers the signaling envelope (ADR-022/CG-2 — the real transport is
 * Wave-8 board work, not this task's scope).
 */
export class PreviewBroker implements LifecycleComponent {
  readonly name = 'preview-broker';

  readonly #deps: PreviewBrokerDeps;
  readonly #connections = new Set<PreviewConnection>();
  readonly #negotiations = new Map<string, NegotiationEntry>();
  #unsubAnswer: Unsubscribe | null = null;
  #unsubIce: Unsubscribe | null = null;
  #unsubError: Unsubscribe | null = null;
  #unsubSources: Unsubscribe | null = null;
  #stopped = false;
  #capabilityEnabled = false;

  constructor(deps: PreviewBrokerDeps) {
    this.#deps = deps;
  }

  async start(): Promise<void> {
    this.#unsubAnswer = this.#deps.bus.subscribe('evt.pm.thumbnail.answer', (data) => this.#onPmAnswer(data));
    this.#unsubIce = this.#deps.bus.subscribe('evt.pm.thumbnail.ice', (data) => this.#onPmIce(data));
    this.#unsubError = this.#deps.bus.subscribe('evt.pm.thumbnail.error', (data) => this.#onPmError(data));
    this.#unsubSources = this.#deps.bus.subscribe('sources.status', (payload) => this.#onSourceStatus(payload));
  }

  /** Stops upgrades, closes active sockets and every open peer negotiation (B-36 lifecycle-table obligation). */
  async stop(_reason: LifecycleStopReason): Promise<void> {
    this.#stopped = true;
    this.#unsubAnswer?.();
    this.#unsubIce?.();
    this.#unsubError?.();
    this.#unsubSources?.();
    this.#unsubAnswer = null;
    this.#unsubIce = null;
    this.#unsubError = null;
    this.#unsubSources = null;

    for (const negotiationId of [...this.#negotiations.keys()]) {
      await this.#deps.pm.closeThumbnailNegotiation(negotiationId).catch(() => undefined);
    }
    this.#negotiations.clear();

    for (const conn of this.#connections) conn.socket.close(1001, 'server is shutting down');
    this.#connections.clear();
  }

  handleConnection(socket: WebSocket, authContext: AuthContext): void {
    if (this.#stopped) {
      socket.close(1001, 'server is shutting down');
      return;
    }

    const conn = new PreviewConnection(socket, authContext.authSessionId, this.#deps.logger);
    this.#connections.add(conn);

    socket.on('message', (raw: Buffer) => this.#onMessage(conn, raw));
    const forget = (): void => this.#teardownConnection(conn);
    socket.on('close', forget);
    socket.on('error', forget);
  }

  #onMessage(conn: PreviewConnection, raw: Buffer): void {
    let json: unknown;
    try {
      json = JSON.parse(raw.toString('utf8'));
    } catch {
      conn.socket.close(1008, 'invalid JSON');
      return;
    }
    const parsed = zPreviewClientMessage.safeParse(json);
    if (!parsed.success) {
      conn.socket.close(1008, 'invalid preview message');
      return;
    }
    const message = parsed.data;
    if (message.type === 'offer') {
      void this.#handleOffer(conn, message.negotiationId, message.roleId, message.sdp);
    } else if (message.type === 'ice') {
      void this.#handleIce(conn, message.negotiationId, message.candidate, message.sdpMid, message.sdpMLineIndex);
    } else {
      void this.#handleClose(conn, message.negotiationId);
    }
  }

  async #handleOffer(conn: PreviewConnection, negotiationId: string, roleId: SourceRoleId, sdp: string): Promise<void> {
    // A new offer implicitly closes the previous negotiation on this connection (events.md §3 rules).
    if (conn.negotiationId !== null) {
      await this.#closeNegotiation(conn.negotiationId);
      conn.negotiationId = null;
    }

    const status = this.#deps.sources.getStatus().find((candidate) => candidate.roleId === roleId);
    if (!status || status.state === 'unbound') {
      conn.send({ type: 'error', negotiationId, code: 'source-unbound', message: `${roleId} has no enabled binding` });
      return;
    }
    if (status.state !== 'online') {
      conn.send({ type: 'error', negotiationId, code: 'source-offline', message: `${roleId} is not online` });
      return;
    }

    this.#negotiations.set(negotiationId, { conn, roleId });
    conn.negotiationId = negotiationId;
    try {
      await this.#ensureCapabilityEnabled();
      await this.#deps.pm.offerThumbnail({ negotiationId, roleId, sdp });
    } catch (error) {
      this.#negotiations.delete(negotiationId);
      if (conn.negotiationId === negotiationId) conn.negotiationId = null;
      conn.send({ type: 'error', negotiationId, code: this.#mapPmErrorCode(error), message: this.#describeError(error) });
    }
  }

  /** Enables PM's preview capability on the first-ever negotiation, not at boot — most app instances (recording/library/every other test) never open a preview socket, and eagerly calling this on every `start()` was one more outbound PM round-trip on every single app boot for no benefit. */
  async #ensureCapabilityEnabled(): Promise<void> {
    if (this.#capabilityEnabled) return;
    await this.#deps.pm.startThumbnails();
    this.#capabilityEnabled = true;
  }

  async #handleIce(conn: PreviewConnection, negotiationId: string, candidate: string, sdpMid: string | null, sdpMLineIndex: number | null): Promise<void> {
    if (conn.negotiationId !== negotiationId) return; // stale/unknown negotiation — silently dropped, never forwarded
    try {
      await this.#deps.pm.iceThumbnail(negotiationId, { candidate, sdpMid, sdpMLineIndex });
    } catch (error) {
      conn.send({ type: 'error', negotiationId, code: this.#mapPmErrorCode(error), message: this.#describeError(error) });
    }
  }

  async #handleClose(conn: PreviewConnection, negotiationId: string): Promise<void> {
    if (conn.negotiationId !== negotiationId) return;
    conn.negotiationId = null;
    await this.#closeNegotiation(negotiationId);
  }

  #teardownConnection(conn: PreviewConnection): void {
    this.#connections.delete(conn);
    const negotiationId = conn.negotiationId;
    if (negotiationId === null) return;
    conn.negotiationId = null;
    void this.#closeNegotiation(negotiationId);
  }

  async #closeNegotiation(negotiationId: string): Promise<void> {
    this.#negotiations.delete(negotiationId);
    await this.#deps.pm.closeThumbnailNegotiation(negotiationId).catch(() => undefined);
  }

  #onPmAnswer(data: PmThumbnailAnswerData): void {
    const entry = this.#negotiations.get(data.negotiationId);
    if (!entry) return;
    entry.conn.send({ type: 'answer', negotiationId: data.negotiationId, sdp: data.sdp });
  }

  #onPmIce(data: PmThumbnailIceData): void {
    const entry = this.#negotiations.get(data.negotiationId);
    if (!entry) return;
    entry.conn.send({ type: 'ice', negotiationId: data.negotiationId, candidate: data.candidate, sdpMid: data.sdpMid, sdpMLineIndex: data.sdpMLineIndex });
  }

  #onPmError(data: PmThumbnailErrorData): void {
    const entry = this.#negotiations.get(data.negotiationId);
    if (!entry) return;
    this.#negotiations.delete(data.negotiationId);
    if (entry.conn.negotiationId === data.negotiationId) entry.conn.negotiationId = null;
    const code: PreviewErrorCode = data.code === 'source-offline' || data.code === 'source-unbound' || data.code === 'busy' ? data.code : 'internal';
    entry.conn.send({ type: 'error', negotiationId: data.negotiationId, code, message: data.message });
  }

  /** Source loss mid-negotiation (design/core-api.md §9.4): B-09's own projection is authoritative, so this never waits on PM to notice. */
  #onSourceStatus(payload: SourcesStatusPayload): void {
    if (payload.state === 'online') return;
    for (const [negotiationId, entry] of [...this.#negotiations]) {
      if (entry.roleId !== payload.roleId) continue;
      this.#negotiations.delete(negotiationId);
      if (entry.conn.negotiationId === negotiationId) entry.conn.negotiationId = null;
      entry.conn.send({ type: 'error', negotiationId, code: 'source-offline', message: `${payload.roleId} went offline` });
      void this.#deps.pm.closeThumbnailNegotiation(negotiationId).catch(() => undefined);
    }
  }

  #mapPmErrorCode(error: unknown): PreviewErrorCode {
    if (error instanceof PipelineManagerError) {
      if (error.problem.code === 'encoder_budget_exceeded') return 'busy';
      if (error.problem.code === 'publisher_not_running') return 'source-offline';
    }
    return 'internal';
  }

  #describeError(error: unknown): string {
    return error instanceof Error ? error.message : 'pipeline-manager request failed';
  }
}

/** Registers the one B-36 upgrade route: `GET /api/v1/ws/preview` (not a contract operationId — the second of B-38's two named WS upgrades). */
export function registerPreviewBroker(app: FastifyInstance, authService: AuthService, broker: PreviewBroker): void {
  app.get(
    '/api/v1/ws/preview',
    { websocket: true, preHandler: wsAuthGuard(authService) },
    (socket, request) => {
      broker.handleConnection(socket, request.authContext!);
    },
  );
}
