import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedCall {
  method: string;
  path: string;
  authorization: string | null;
  body?: unknown;
}

function formatSse(id: number, event: string, data: unknown): string {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw.length > 0 ? JSON.parse(raw) : {};
}

class FakeSseService {
  readonly calls: RecordedCall[] = [];

  readonly #server: Server;
  readonly #bearerToken: string;
  readonly #subscribers = new Set<ServerResponse>();
  #sequence = 0;
  #offline = false;

  constructor(bearerToken: string, extraHandlers: (req: IncomingMessage, res: ServerResponse, url: URL, call: RecordedCall) => Promise<boolean>) {
    this.#bearerToken = bearerToken;
    this.#server = createServer((req, res) => {
      void this.#handle(req, res, extraHandlers);
    });
  }

  async listen(): Promise<string> {
    await new Promise<void>((resolve) => this.#server.listen(0, '127.0.0.1', resolve));
    const address = this.#server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }

  async close(): Promise<void> {
    for (const res of this.#subscribers) res.end();
    this.#subscribers.clear();
    const closed = new Promise<void>((resolve) => this.#server.close(() => resolve()));
    this.#server.closeAllConnections();
    await closed;
  }

  setOffline(offline: boolean): void {
    this.#offline = offline;
  }

  get openConnectionCount(): number {
    return this.#subscribers.size;
  }

  emit(event: string, data: unknown): void {
    this.#sequence += 1;
    const frame = formatSse(this.#sequence, event, data);
    for (const res of this.#subscribers) res.write(frame);
  }

  async #handle(
    req: IncomingMessage,
    res: ServerResponse,
    extraHandlers: (req: IncomingMessage, res: ServerResponse, url: URL, call: RecordedCall) => Promise<boolean>,
  ): Promise<void> {
    if (this.#offline) {
      req.socket.destroy();
      return;
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const authorization = req.headers.authorization ?? null;
    if (authorization !== `Bearer ${this.#bearerToken}`) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 'unauthorized', title: 'unauthorized', status: 401 }));
      return;
    }

    const call: RecordedCall = { method: req.method ?? '', path: url.pathname, authorization };
    if (req.method !== 'GET' || url.pathname !== '/events') {
      this.calls.push(call);
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      this.#subscribers.add(res);
      req.on('close', () => this.#subscribers.delete(res));
      return;
    }

    if (await extraHandlers(req, res, url, call)) return;

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 'not_found', title: 'not found', status: 404 }));
  }
}

/**
 * Minimal in-process stand-ins for the three AI services (docs/design/ai-services.md
 * §0/§1.4/§2.3/§3.4): bearer auth, `GET /status`, `GET /events` SSE, session
 * lifecycle for stt/slide, and `GET /probe` for question-service. Records
 * every call so B-29 tests can assert exactly what core-api sent.
 */
export class FakeAiServices {
  readonly bearerToken: string;
  readonly #stt: FakeSseService;
  readonly #slide: FakeSseService;
  readonly #question: Server;
  readonly questionCalls: RecordedCall[] = [];
  #questionReachable = true;
  #questionOffline = false;

  constructor(options: { bearerToken: string }) {
    this.bearerToken = options.bearerToken;

    this.#stt = new FakeSseService(this.bearerToken, async (req, res, url, call) => {
      if (req.method === 'GET' && url.pathname === '/status') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ state: 'idle', sessionId: null, model: 'vosk', modelVersion: 'v1', samplesConsumed: 0, lastSegmentAt: null, audioSource: null }));
        return true;
      }
      if (req.method === 'POST' && url.pathname === '/sessions') {
        call.body = await readJsonBody(req);
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ state: 'listening' }));
        return true;
      }
      const pauseMatch = /^\/sessions\/([^/]+)\/pause$/.exec(url.pathname);
      if (req.method === 'POST' && pauseMatch) {
        call.body = await readJsonBody(req);
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ state: 'paused' }));
        return true;
      }
      const resumeMatch = /^\/sessions\/([^/]+)\/resume$/.exec(url.pathname);
      if (req.method === 'POST' && resumeMatch) {
        call.body = await readJsonBody(req);
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ state: 'listening' }));
        return true;
      }
      const deleteMatch = /^\/sessions\/([^/]+)$/.exec(url.pathname);
      if (req.method === 'DELETE' && deleteMatch) {
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ state: 'idle' }));
        return true;
      }
      return false;
    });

    this.#slide = new FakeSseService(this.bearerToken, async (req, res, url, call) => {
      if (req.method === 'GET' && url.pathname === '/status') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ state: 'idle', sessionId: null, slideCount: 0, lastCaptureAt: null, ocrBacklog: 0 }));
        return true;
      }
      if (req.method === 'POST' && url.pathname === '/sessions') {
        call.body = await readJsonBody(req);
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ state: 'watching' }));
        return true;
      }
      const deleteMatch = /^\/sessions\/([^/]+)$/.exec(url.pathname);
      if (req.method === 'DELETE' && deleteMatch) {
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ state: 'idle' }));
        return true;
      }
      return false;
    });

    this.#question = createServer((req, res) => {
      void this.#handleQuestion(req, res);
    });
  }

  async listen(): Promise<{ stt: string; slide: string; question: string }> {
    const [stt, slide, question] = await Promise.all([
      this.#stt.listen(),
      this.#slide.listen(),
      new Promise<string>((resolve) => {
        this.#question.listen(0, '127.0.0.1', () => {
          const address = this.#question.address() as AddressInfo;
          resolve(`http://127.0.0.1:${address.port}`);
        });
      }),
    ]);
    return { stt, slide, question };
  }

  async close(): Promise<void> {
    await Promise.all([
      this.#stt.close(),
      this.#slide.close(),
      new Promise<void>((resolve) => {
        this.#question.close(() => resolve());
        this.#question.closeAllConnections();
      }),
    ]);
  }

  get sttCalls(): RecordedCall[] {
    return this.#stt.calls;
  }

  get slideCalls(): RecordedCall[] {
    return this.#slide.calls;
  }

  get sttOpenConnectionCount(): number {
    return this.#stt.openConnectionCount;
  }

  get slideOpenConnectionCount(): number {
    return this.#slide.openConnectionCount;
  }

  setSttOffline(offline: boolean): void {
    this.#stt.setOffline(offline);
  }

  setSlideOffline(offline: boolean): void {
    this.#slide.setOffline(offline);
  }

  emitSttSegment(data: unknown): void {
    this.#stt.emit('evt.stt.segment', data);
  }

  emitSlideCaptured(data: unknown): void {
    this.#slide.emit('evt.slide.captured', data);
  }

  /** Toggles what `GET /probe` reports (`T-LLM-PROBE`, Q-06 recovery). */
  setQuestionReachable(reachable: boolean): void {
    this.#questionReachable = reachable;
  }

  setQuestionOffline(offline: boolean): void {
    this.#questionOffline = offline;
  }

  async #handleQuestion(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (this.#questionOffline) {
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
    this.questionCalls.push({ method: req.method ?? '', path: url.pathname, authorization });

    if (req.method === 'GET' && url.pathname === '/probe') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ reachable: this.#questionReachable, latencyMs: this.#questionReachable ? 12 : null }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/status') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ promptVersions: ['mcq/v1'], llmEndpoint: null, lastGenerationAt: null, lastError: null }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/generate') {
      await readJsonBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ questionSetId: 'fake', promptVersion: 'mcq/v1', modelId: 'fake-model', requested: 3, returned: 3, droppedInvalid: 0, questions: [] }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 'not_found', title: 'not found', status: 404 }));
  }
}
