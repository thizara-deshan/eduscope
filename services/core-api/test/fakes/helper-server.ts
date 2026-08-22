import { createServer, type Server } from 'node:net';
import type { HelperTransport } from '../../src/lib/helper-client.js';

export interface HelperLedgerEntry {
  verb: string;
  args: Record<string, unknown>;
  requestId: string;
}

export class InMemoryHelperTransport implements HelperTransport {
  readonly ledger: HelperLedgerEntry[] = [];
  failureVerb: string | null = null;
  hang = false;

  async request(line: string, signal: AbortSignal): Promise<string> {
    if (this.hang) {
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    }
    const request = JSON.parse(line.trim()) as HelperLedgerEntry;
    this.ledger.push(request);
    return JSON.stringify(this.failureVerb === request.verb
      ? { ok: false, detail: `${request.verb} failed` }
      : { ok: true, detail: 'ok' });
  }
}

export async function startFakeHelperServer(socketPath: string): Promise<{ server: Server; ledger: HelperLedgerEntry[] }> {
  const ledger: HelperLedgerEntry[] = [];
  const server = createServer((socket) => {
    let input = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      input += chunk;
      const newline = input.indexOf('\n');
      if (newline === -1) return;
      ledger.push(JSON.parse(input.slice(0, newline)) as HelperLedgerEntry);
      socket.end(`${JSON.stringify({ ok: true, detail: 'ok' })}\n`);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => { server.off('error', reject); resolve(); });
  });
  return { server, ledger };
}
