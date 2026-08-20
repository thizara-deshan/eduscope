import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedCall {
  method: string;
  path: string;
  authorization: string | null;
  contractVersion: string | null;
  body?: unknown;
}

interface QueuedResponse {
  status: number;
  body?: unknown;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw.length > 0 ? (JSON.parse(raw) as unknown) : {};
}

/**
 * A minimal in-process stand-in for quiz-service's `quiz-sync` REST family
 * (contracts/openapi.yaml tag `quiz-sync`, events.md §4): `POST
 * /device/v1/publications` (Q-30/31) and `POST
 * /device/v1/publications/{id}/close` (Q-33/34/35) for B-32;
 * `/device/v1/quiz-sessions` create/close (Z-01/Z-05) for B-33. Records every
 * call so tests can assert on exactly what core-api sent, including the
 * deviceAuth bearer and `x-eduscope-contract` header (DR-10).
 */
export class FakeQuizService {
  readonly bearerToken: string;
  readonly calls: RecordedCall[] = [];

  readonly #server: Server;
  #offline = false;
  #delayMs = 0;
  #nextPublishResponse: QueuedResponse | null = null;
  #nextCloseResponse: QueuedResponse | null = null;
  #nextCreateSessionResponse: QueuedResponse | null = null;
  #sessionIdCounter = 0;

  constructor(options: { bearerToken: string }) {
    this.bearerToken = options.bearerToken;
    this.#server = createServer((req, res) => {
      void this.#handle(req, res);
    });
  }

  async listen(): Promise<string> {
    await new Promise<void>((resolve) => this.#server.listen(0, '127.0.0.1', resolve));
    const address = this.#server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }

  async close(): Promise<void> {
    const closed = new Promise<void>((resolve) => this.#server.close(() => resolve()));
    this.#server.closeAllConnections();
    await closed;
  }

  /** Simulates the quiz server being unreachable — every connection is destroyed with no response. */
  setOffline(offline: boolean): void {
    this.#offline = offline;
  }

  /** Delays every response by this many milliseconds — for T-PUBLISH-ACK timeout tests. */
  setResponseDelay(ms: number): void {
    this.#delayMs = ms;
  }

  queuePublishResponse(response: QueuedResponse): void {
    this.#nextPublishResponse = response;
  }

  queueCloseResponse(response: QueuedResponse): void {
    this.#nextCloseResponse = response;
  }

  queueCreateSessionResponse(response: QueuedResponse): void {
    this.#nextCreateSessionResponse = response;
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (this.#offline) {
      req.socket.destroy();
      return;
    }
    if (this.#delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.#delayMs));
    }

    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const authorization = req.headers.authorization ?? null;
    const contractVersion = (req.headers['x-eduscope-contract'] as string | undefined) ?? null;
    if (authorization !== `Bearer ${this.bearerToken}`) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 'unauthorized', title: 'unauthorized', status: 401 }));
      return;
    }

    const call: RecordedCall = { method: req.method ?? '', path: url.pathname, authorization, contractVersion };
    const body = await readJsonBody(req);
    call.body = body;
    this.calls.push(call);

    if (req.method === 'POST' && url.pathname === '/device/v1/publications') {
      const queued = this.#nextPublishResponse;
      this.#nextPublishResponse = null;
      if (queued) {
        res.writeHead(queued.status, { 'content-type': 'application/json' });
        res.end(queued.body !== undefined ? JSON.stringify(queued.body) : undefined);
        return;
      }
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end();
      return;
    }

    const closeMatch = req.method === 'POST' ? /^\/device\/v1\/publications\/([^/]+)\/close$/.exec(url.pathname) : null;
    if (closeMatch) {
      const queued = this.#nextCloseResponse;
      this.#nextCloseResponse = null;
      if (queued) {
        res.writeHead(queued.status, { 'content-type': 'application/json' });
        res.end(queued.body !== undefined ? JSON.stringify(queued.body) : undefined);
        return;
      }
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'POST' && url.pathname === '/device/v1/quiz-sessions') {
      const queued = this.#nextCreateSessionResponse;
      this.#nextCreateSessionResponse = null;
      if (queued) {
        res.writeHead(queued.status, { 'content-type': 'application/json' });
        res.end(queued.body !== undefined ? JSON.stringify(queued.body) : undefined);
        return;
      }
      this.#sessionIdCounter += 1;
      // `zUlid` requires exactly 26 Crockford-base32 chars — a real quiz-service mints a genuine ULID here.
      const id = `01QZSESS${String(this.#sessionIdCounter).padStart(18, '0')}`;
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id,
          lectureSessionId: (body as { lectureSessionId?: string }).lectureSessionId ?? '',
          state: 'open',
          joinCode: 'AB12CD',
          joinUrl: `https://quiz.example.edu/j/${id}`,
          openedAt: new Date().toISOString(),
        }),
      );
      return;
    }

    const closeSessionMatch = req.method === 'POST' ? /^\/device\/v1\/quiz-sessions\/([^/]+)\/close$/.exec(url.pathname) : null;
    if (closeSessionMatch) {
      res.writeHead(204);
      res.end();
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 'not-found', title: 'not found', status: 404 }));
  }
}
