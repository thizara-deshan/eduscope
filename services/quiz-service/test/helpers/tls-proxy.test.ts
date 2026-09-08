import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { startTlsProxy, type TlsProxy } from './tls-proxy.js';

describe('startTlsProxy', () => {
  let target: ReturnType<typeof createServer>;
  let wss: WebSocketServer;
  let proxy: TlsProxy | undefined;

  afterEach(async () => {
    await proxy?.close();
    wss.close();
    target.close();
  });

  it('forwards a WebSocket upgrade end-to-end, not just plain HTTP', async () => {
    // The proxy is expected to resolve or reject this promptly; a hang here
    // means the upgrade was silently dropped (the bug this test guards).
    target = createServer();
    wss = new WebSocketServer({ server: target });
    wss.on('connection', (socket) => {
      socket.on('message', (data) => socket.send(`echo:${data.toString()}`));
    });
    target.listen(0, '127.0.0.1');
    await once(target, 'listening');
    const targetPort = (target.address() as AddressInfo).port;

    proxy = await startTlsProxy(targetPort);

    const socket = new WebSocket(`wss://127.0.0.1:${String(proxy.port)}/`, { rejectUnauthorized: false });
    await once(socket, 'open');
    socket.send('hello');
    const [reply] = (await once(socket, 'message')) as [Buffer];
    expect(reply.toString()).toBe('echo:hello');
    socket.close();
  }, 5_000);
});
