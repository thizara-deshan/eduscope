import { createConnection } from 'node:net';
import { z } from 'zod';
import { ProblemError } from '../contracts/problem.js';
import type { Clock } from './clock.js';

const zUuid = z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const zDevNode = z.string().min(6).max(128).regex(/^\/dev\/[A-Za-z0-9._/-]+$/).refine((value) => !value.includes('..'));
// Control chars are exactly what this label filter must reject before the
// value crosses to the privileged helper; matching them is intentional.
// eslint-disable-next-line no-control-regex
const zLabel = z.string().min(1).max(64).regex(/^[^\u0000-\u001f\u007f]+$/);

const zSmartDevNode = zDevNode;

const zHelperRequest = z.discriminatedUnion('verb', [
  z.object({ verb: z.literal('volume.mount'), args: z.object({ uuid: zUuid }).strict(), requestId: z.string().min(1).max(128) }).strict(),
  z.object({ verb: z.literal('volume.unmount'), args: z.object({ uuid: zUuid }).strict(), requestId: z.string().min(1).max(128) }).strict(),
  z.object({ verb: z.literal('volume.format'), args: z.object({ devNode: zDevNode, fs: z.literal('ext4'), label: zLabel }).strict(), requestId: z.string().min(1).max(128) }).strict(),
  z.object({ verb: z.literal('smart.read'), args: z.object({ devNode: zSmartDevNode }).strict(), requestId: z.string().min(1).max(128) }).strict(),
  z.object({ verb: z.literal('system.poweroff'), args: z.object({}).strict(), requestId: z.string().min(1).max(128) }).strict(),
  z.object({
    verb: z.literal('net.apply'),
    args: z
      .object({
        interfaceName: z.string().min(1).max(32).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
        config: z
          .object({
            kind: z.enum(['lan', 'vlan']),
            vlanId: z.number().int().nullable(),
            addressMode: z.enum(['dhcp', 'static']),
            ipv4Address: z.string().nullable(),
            prefixLength: z.number().int().nullable(),
            gateway: z.string().nullable(),
            dnsServers: z.array(z.string()),
          })
          .strict(),
      })
      .strict(),
    requestId: z.string().min(1).max(128),
  }).strict(),
  z.object({ verb: z.literal('relay.reload'), args: z.object({ configDigest: z.string().min(1).max(128) }).strict(), requestId: z.string().min(1).max(128) }).strict(),
  z.object({ verb: z.literal('firmware.check'), args: z.object({ version: z.string().min(1).max(32).optional() }).strict(), requestId: z.string().min(1).max(128) }).strict(),
  z.object({ verb: z.literal('firmware.apply'), args: z.object({ version: z.string().min(1).max(32).optional() }).strict(), requestId: z.string().min(1).max(128) }).strict(),
]);

const zHelperResponse = z.object({ ok: z.boolean(), detail: z.string() }).strict();

export type HelperRequest = z.infer<typeof zHelperRequest>;
export type HelperVerb = HelperRequest['verb'];
export type HelperArgs<V extends HelperVerb> = Extract<HelperRequest, { verb: V }>['args'];

export interface HelperTransport {
  request(line: string, signal: AbortSignal): Promise<string>;
}

const MAX_RESPONSE_BYTES = 64 * 1024;

export class UnixHelperTransport implements HelperTransport {
  constructor(readonly socketPath: string, readonly maxResponseBytes = MAX_RESPONSE_BYTES) {}

  request(line: string, signal: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ path: this.socketPath });
      let settled = false;
      let response = '';
      const finish = (error?: Error, value?: string) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        socket.destroy();
        if (error) reject(error); else resolve(value ?? '');
      };
      const onAbort = () => finish(new Error('helper request aborted'));
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) return onAbort();
      socket.setEncoding('utf8');
      socket.once('connect', () => socket.write(line));
      socket.on('data', (chunk: string) => {
        response += chunk;
        if (Buffer.byteLength(response) > this.maxResponseBytes) return finish(new Error('helper response exceeded limit'));
        const newline = response.indexOf('\n');
        if (newline !== -1) finish(undefined, response.slice(0, newline));
      });
      socket.once('error', (error) => finish(error));
      socket.once('end', () => {
        if (!settled) finish(new Error('helper closed before a complete response line'));
      });
    });
  }
}

export interface HelperClientOptions {
  transport: HelperTransport;
  clock: Clock;
  timeoutMs?: number;
}

export class HelperClient {
  readonly #timeoutMs: number;

  constructor(readonly options: HelperClientOptions) {
    this.#timeoutMs = options.timeoutMs ?? 5_000;
  }

  async request<V extends HelperVerb>(verb: V, args: HelperArgs<V>, requestId: string): Promise<{ ok: true; detail: string }> {
    const parsed = zHelperRequest.safeParse({ verb, args, requestId });
    if (!parsed.success) throw new ProblemError(422, 'validation.invalid', 'Invalid helper request');

    const requestAbort = new AbortController();
    const timerAbort = new AbortController();
    let timedOut = false;
    try {
      const raw = await Promise.race([
        this.options.transport.request(`${JSON.stringify(parsed.data)}\n`, requestAbort.signal),
        this.options.clock.sleep(this.#timeoutMs, timerAbort.signal).then(() => {
          timedOut = true;
          requestAbort.abort();
          throw new Error('helper request timed out');
        }),
      ]);
      const response = zHelperResponse.safeParse(JSON.parse(raw));
      if (!response.success) throw new Error('invalid helper response');
      if (!response.data.ok) throw new ProblemError(422, 'volume.unavailable', response.data.detail);
      return { ok: true, detail: response.data.detail };
    } catch (error) {
      if (timedOut) throw new ProblemError(422, 'volume.unavailable', 'Helper request timed out');
      if (error instanceof ProblemError) throw error;
      throw new ProblemError(422, 'volume.unavailable', 'Helper request failed');
    } finally {
      timerAbort.abort();
      requestAbort.abort();
    }
  }
}
