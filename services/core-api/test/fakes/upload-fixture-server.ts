import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';

async function body(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
function json(reply: ServerResponse, status: number, value: unknown): void {
  reply.writeHead(status, { 'content-type': 'application/json' });
  reply.end(JSON.stringify(value));
}

export class UploadFixtureServer {
  #server?: Server;
  #cutAtPatch: number | undefined;
  #patches = 0;
  #nextPatchFailure: { status: number; error: string } | undefined;
  readonly lectures = new Map<string, { metadata: Record<string, unknown>; parts: Map<string, Buffer>; completed: boolean; deleted: boolean }>();
  readonly payloadKeys: string[] = [];
  completions = 0;

  async listen(): Promise<string> {
    this.#server = createServer((request, reply) => { void this.#handle(request, reply); });
    this.#server.listen(0, '127.0.0.1');
    await once(this.#server, 'listening');
    const address = this.#server.address();
    if (!address || typeof address === 'string') throw new Error('fixture did not bind');
    return `http://127.0.0.1:${address.port}`;
  }
  cutOnPatch(number: number): void { this.#cutAtPatch = number; }
  failNextPatch(status: number, error = 'checksum-mismatch'): void { this.#nextPatchFailure = { status, error }; }
  async close(): Promise<void> { if (this.#server) { this.#server.close(); await once(this.#server, 'close'); } }

  async #handle(request: IncomingMessage, reply: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://fixture');
    if (request.method === 'POST' && url.pathname === '/lectures') {
      const metadata = JSON.parse((await body(request)).toString()) as Record<string, unknown>;
      this.payloadKeys.push(...Object.keys(metadata));
      const id = `lecture-${this.lectures.size + 1}`;
      this.lectures.set(id, { metadata, parts: new Map(), completed: false, deleted: false });
      json(reply, 201, { remoteLectureId: id }); return;
    }
    const match = /^\/lectures\/([^/]+)(?:\/parts\/([^/]+)|\/complete)?$/.exec(url.pathname);
    if (!match) { json(reply, 404, { error: 'missing' }); return; }
    const lecture = this.lectures.get(match[1]!);
    if (!lecture) { json(reply, 404, { error: 'missing' }); return; }
    if (request.method === 'PATCH' && match[2]) {
      this.#patches += 1;
      if (this.#patches === this.#cutAtPatch) { request.socket.destroy(); return; }
      if (this.#nextPatchFailure) { const failure = this.#nextPatchFailure; this.#nextPatchFailure = undefined; json(reply, failure.status, { error: failure.error }); return; }
      const incoming = await body(request);
      const previous = lecture.parts.get(match[2]) ?? Buffer.alloc(0);
      const offset = Number(request.headers['upload-offset'] ?? 0);
      if (offset !== previous.length) { json(reply, 409, { error: 'offset-mismatch', expectedOffset: previous.length }); return; }
      const next = Buffer.concat([previous, incoming]);
      lecture.parts.set(match[2], next);
      json(reply, 200, { offset: next.length, token: `token:${next.length}`, remoteFileId: `remote-${match[2]}` }); return;
    }
    if (request.method === 'POST' && url.pathname.endsWith('/complete')) {
      await body(request); lecture.completed = true; this.completions += 1; json(reply, 200, { completed: true }); return;
    }
    if (request.method === 'DELETE') { lecture.deleted = true; reply.writeHead(204).end(); return; }
    json(reply, 405, { error: 'method' });
  }
}
