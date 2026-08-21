import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { PmStatus } from '../../src/modules/recording/pm/types.js';

export interface RecordedCall {
  method: string;
  path: string;
  authorization: string | null;
  body?: unknown;
}

interface QueuedResponse {
  status: number;
  body: unknown;
}

interface HistoryEvent {
  sequence: number;
  kind: string;
  data: unknown;
}

function defaultStatus(): PmStatus {
  return {
    platform: 'rk3588',
    encodeLedger: { capacity: 3, inUse: 0, reservedBy: [] },
    publishers: {
      usb: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
      rtsp: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
      rtsp2: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
      audio: { state: 'online', bound: true, fps: null, rms: 0.1, lastError: null },
    },
    consumers: [],
    device: { captureCardState: 'present', led: 'off' },
    sequence: 0,
  };
}

function formatSse(event: HistoryEvent): string {
  return `id: ${event.sequence}\nevent: ${event.kind}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

/**
 * A minimal in-process stand-in for pipeline-manager's internal API
 * (docs/design/pipeline-manager.md §3), exposing A-14's exact current wire
 * shapes: bearer auth, `GET /status`, `GET /events` SSE with `Last-Event-ID`
 * replay (mirrors `api/events.py`'s `EventBroker.replay_since` exactly),
 * `POST /consumers/record`, and `POST /device/led`. Records every call so
 * B-04/B-05 tests can assert on what the bridge/executor actually sent.
 */
export class FakePipelineManager {
  readonly bearerToken: string;
  readonly calls: RecordedCall[] = [];

  readonly #server: Server;
  readonly #replaySize: number;
  readonly #subscribers = new Set<ServerResponse>();
  readonly #history: HistoryEvent[] = [];
  #sequence = 0;
  #status: PmStatus = defaultStatus();
  #nextRecordResponse: QueuedResponse | null = null;
  #nextLiveResponse: QueuedResponse | null = null;
  #nextMeetingResponse: QueuedResponse | null = null;
  #nextBindingResponse: QueuedResponse | null = null;
  #nextAudioResponse: QueuedResponse | null = null;
  #nextProjectorResponse: QueuedResponse | null = null;
  #recordIdCounter = 0;
  #liveIdCounter = 0;
  #meetingIdCounter = 0;
  #offline = false;
  #nextThumbnailOfferResponse: QueuedResponse | null = null;
  readonly #openNegotiations = new Set<string>();

  constructor(options: { bearerToken: string; replaySize?: number }) {
    this.bearerToken = options.bearerToken;
    this.#replaySize = options.replaySize ?? 512;
    this.#server = createServer((req, res) => this.#handle(req, res));
  }

  async listen(): Promise<string> {
    await new Promise<void>((resolve) => this.#server.listen(0, '127.0.0.1', resolve));
    const address = this.#server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }

  async close(): Promise<void> {
    for (const res of this.#subscribers) {
      res.end();
    }
    this.#subscribers.clear();
    const closed = new Promise<void>((resolve) => this.#server.close(() => resolve()));
    // Idle keep-alive sockets from short-lived requests (/status, /device/led,
    // ...) otherwise hold `close()` open until Node's default 5s keep-alive
    // timeout — this speeds up test teardown, it isn't behavior under test.
    this.#server.closeAllConnections();
    await closed;
  }

  setStatus(patch: Partial<Omit<PmStatus, 'sequence'>>): void {
    this.#status = { ...this.#status, ...patch };
  }

  /** Publishes one internal event to every open `/events` subscriber, incrementing the shared sequence. */
  publish(kind: string, data: unknown): number {
    this.#sequence += 1;
    const event: HistoryEvent = { sequence: this.#sequence, kind, data };
    this.#history.push(event);
    if (this.#history.length > this.#replaySize) {
      this.#history.shift();
    }
    const frame = formatSse(event);
    for (const res of this.#subscribers) {
      res.write(frame);
    }
    return event.sequence;
  }

  /** Re-sends an already-published history event verbatim (same sequence) to every open subscriber — simulates an overlapping replay/live delivery race for duplicate-suppression tests. */
  replayHistoryEvent(sequence: number): void {
    const event = this.#history.find((candidate) => candidate.sequence === sequence);
    if (!event) {
      throw new Error(`FakePipelineManager: no history event with sequence ${sequence}`);
    }
    const frame = formatSse(event);
    for (const res of this.#subscribers) {
      res.write(frame);
    }
  }

  /** Sends `evt.pm.resync-required` and closes the stream, matching `routes.py`'s replay-gap path. */
  forceResyncRequired(): void {
    const frame = `id: ${this.#sequence}\nevent: evt.pm.resync-required\ndata: {}\n\n`;
    for (const res of [...this.#subscribers]) {
      res.write(frame);
      res.end();
      this.#subscribers.delete(res);
    }
  }

  /** Destroys every open `/events` connection with no graceful marker — simulates a network drop. */
  dropConnections(): void {
    for (const res of [...this.#subscribers]) {
      res.destroy();
      this.#subscribers.delete(res);
    }
  }

  get openConnectionCount(): number {
    return this.#subscribers.size;
  }

  /** Makes the next `POST /consumers/record` return this status/body instead of the default 202. */
  queueRecordResponse(response: QueuedResponse): void {
    this.#nextRecordResponse = response;
  }

  /** Makes the next `POST /consumers/live` return this status/body instead of the default 202. */
  queueLiveResponse(response: QueuedResponse): void {
    this.#nextLiveResponse = response;
  }

  /** Makes the next `POST /consumers/meeting` return this status/body instead of the default 202. */
  queueMeetingResponse(response: QueuedResponse): void {
    this.#nextMeetingResponse = response;
  }

  /** Makes the next `PUT /publishers/{id}/binding` return this status/body instead of the default 202. */
  queueBindingResponse(response: QueuedResponse): void {
    this.#nextBindingResponse = response;
  }

  /** Makes the next `PUT /audio/controls/mic-lecturer` return this status/body instead of the default 200/applied. */
  queueAudioResponse(response: QueuedResponse): void {
    this.#nextAudioResponse = response;
  }

  /** Makes the next `POST /consumers/projector` return this status/body instead of the default 202. */
  queueProjectorResponse(response: QueuedResponse): void {
    this.#nextProjectorResponse = response;
  }

  /** Makes the next `POST /consumers/thumbnails/offer` return this status/body instead of the default 202 accepted. */
  queueThumbnailOfferResponse(response: QueuedResponse): void {
    this.#nextThumbnailOfferResponse = response;
  }

  /** Negotiation ids currently open per `offer`/`{id}/ice`/DELETE `{id}` bookkeeping (mirrors A's `ThumbnailController.negotiations`). */
  get openNegotiationIds(): string[] {
    return [...this.#openNegotiations];
  }

  /** When true, every request's socket is destroyed with no response — simulates the service being unreachable (connection-refused-like), not a graceful 4xx/5xx. */
  setOffline(offline: boolean): void {
    this.#offline = offline;
  }

  #handle(req: IncomingMessage, res: ServerResponse): void {
    if (this.#offline) {
      req.socket.destroy();
      return;
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const authorization = req.headers.authorization ?? null;
    if (authorization !== `Bearer ${this.bearerToken}`) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 'unauthorized', title: 'unauthorized', status: 401 }));
      return;
    }

    const call: RecordedCall = { method: req.method ?? '', path: url.pathname, authorization };
    this.calls.push(call);

    if (req.method === 'GET' && url.pathname === '/status') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ...this.#status, sequence: this.#sequence }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      this.#handleEvents(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/consumers/record') {
      this.#readJsonBody(req).then((body) => {
        call.body = body;
        const queued = this.#nextRecordResponse;
        this.#nextRecordResponse = null;
        if (queued) {
          res.writeHead(queued.status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(queued.body));
          return;
        }
        this.#recordIdCounter += 1;
        const consumerId = `record:${String(this.#recordIdCounter).padStart(8, '0')}`;
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ consumerId, state: 'starting' }));
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/consumers/live') {
      this.#readJsonBody(req).then((body) => {
        call.body = body;
        const queued = this.#nextLiveResponse;
        this.#nextLiveResponse = null;
        if (queued) {
          res.writeHead(queued.status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(queued.body));
          return;
        }
        this.#liveIdCounter += 1;
        const consumerId = `live:${String(this.#liveIdCounter).padStart(8, '0')}`;
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ consumerId, state: 'starting' }));
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/consumers/meeting') {
      this.#readJsonBody(req).then((body) => {
        call.body = body;
        const queued = this.#nextMeetingResponse;
        this.#nextMeetingResponse = null;
        if (queued) {
          res.writeHead(queued.status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(queued.body));
          return;
        }
        this.#meetingIdCounter += 1;
        const consumerId = `meeting:${String(this.#meetingIdCounter).padStart(8, '0')}`;
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ consumerId, state: 'starting' }));
      });
      return;
    }

    const stopMatch = req.method === 'POST' ? /^\/consumers\/([^/]+)\/stop$/.exec(url.pathname) : null;
    if (stopMatch) {
      this.#readJsonBody(req).then((body) => {
        call.body = body;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ consumerId: stopMatch[1], state: 'stopping' }));
      });
      return;
    }

    const bindingMatch = req.method === 'PUT' ? /^\/publishers\/([^/]+)\/binding$/.exec(url.pathname) : null;
    if (bindingMatch) {
      this.#readJsonBody(req).then((body) => {
        call.body = body;
        const queued = this.#nextBindingResponse;
        this.#nextBindingResponse = null;
        if (queued) {
          res.writeHead(queued.status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(queued.body));
          return;
        }
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ publisherId: bindingMatch[1], state: 'offline' }));
      });
      return;
    }

    if (req.method === 'PUT' && url.pathname === '/audio/controls/mic-lecturer') {
      this.#readJsonBody(req).then((body) => {
        call.body = body;
        const queued = this.#nextAudioResponse;
        this.#nextAudioResponse = null;
        if (queued) {
          res.writeHead(queued.status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(queued.body));
          return;
        }
        const { gain, muted } = body as { gain: number; muted: boolean };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ roleId: 'mic-lecturer', appliedGain: gain, appliedMuted: muted, appliedState: 'applied', lastError: null }));
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/consumers/projector') {
      this.#readJsonBody(req).then((body) => {
        call.body = body;
        const queued = this.#nextProjectorResponse;
        this.#nextProjectorResponse = null;
        if (queued) {
          res.writeHead(queued.status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(queued.body));
          return;
        }
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ consumerId: 'projector:00000001', state: 'running' }));
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/consumers/thumbnails/start') {
      this.#readJsonBody(req).then((body) => {
        call.body = body;
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end();
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/consumers/thumbnails/offer') {
      this.#readJsonBody(req).then((body) => {
        call.body = body;
        const queued = this.#nextThumbnailOfferResponse;
        this.#nextThumbnailOfferResponse = null;
        if (queued) {
          res.writeHead(queued.status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(queued.body));
          return;
        }
        const { negotiationId } = body as { negotiationId: string };
        this.#openNegotiations.add(negotiationId);
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ consumerId: `thumbnails:${negotiationId}`, state: 'starting' }));
      });
      return;
    }

    const thumbnailIceMatch = req.method === 'POST' ? /^\/consumers\/thumbnails\/([^/]+)\/ice$/.exec(url.pathname) : null;
    if (thumbnailIceMatch) {
      this.#readJsonBody(req).then((body) => {
        call.body = body;
        const negotiationId = thumbnailIceMatch[1]!;
        if (!this.#openNegotiations.has(negotiationId)) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ code: 'consumer_not_found', title: 'Unknown negotiation', status: 404, meta: { negotiationId } }));
          return;
        }
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end();
      });
      return;
    }

    const thumbnailCloseMatch = req.method === 'DELETE' ? /^\/consumers\/thumbnails\/([^/]+)$/.exec(url.pathname) : null;
    if (thumbnailCloseMatch) {
      this.#openNegotiations.delete(thumbnailCloseMatch[1]!);
      res.writeHead(202, { 'content-type': 'application/json' });
      res.end();
      return;
    }

    if (req.method === 'POST' && url.pathname === '/device/led') {
      this.#readJsonBody(req).then((body) => {
        call.body = body;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ mode: (body as { mode: string }).mode }));
      });
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 'consumer_not_found', title: 'not found', status: 404 }));
  }

  #handleEvents(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });

    const lastEventIdHeader = req.headers['last-event-id'];
    if (lastEventIdHeader !== undefined) {
      const lastEventId = Number(Array.isArray(lastEventIdHeader) ? lastEventIdHeader[0] : lastEventIdHeader);
      const replay = this.#replaySince(lastEventId);
      if (replay === null) {
        res.write(`id: ${this.#sequence}\nevent: evt.pm.resync-required\ndata: {}\n\n`);
        res.end();
        return;
      }
      for (const event of replay) {
        res.write(formatSse(event));
      }
    }

    this.#subscribers.add(res);
    req.on('close', () => {
      this.#subscribers.delete(res);
    });
  }

  #replaySince(lastEventId: number): HistoryEvent[] | null {
    if (lastEventId >= this.#sequence) return [];
    if (this.#history.length === 0) return lastEventId > 0 ? null : [];
    const oldestRetained = this.#history[0]!.sequence;
    if (lastEventId < oldestRetained - 1) return null;
    return this.#history.filter((event) => event.sequence > lastEventId);
  }

  async #readJsonBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    return raw.length > 0 ? JSON.parse(raw) : {};
  }
}
