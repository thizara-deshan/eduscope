import { readFileSync } from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Committed localhost-only self-signed certificate (test fixture only, never shipped). */
export const TLS_TEST_CERT = readFileSync(path.join(here, '../fixtures/tls/localhost-cert.pem'));
const TLS_TEST_KEY = readFileSync(path.join(here, '../fixtures/tls/localhost-key.pem'));

export interface TlsProxy {
  readonly port: number;
  close(): Promise<void>;
}

/**
 * Fronts `targetPort` on loopback with a real Node HTTPS server, mirroring
 * the campus Nginx proxy: forwards `X-Forwarded-Proto`/`X-Forwarded-For` and
 * terminates TLS itself so tests can prove the app works behind it without
 * the app ever binding a public port.
 */
export function startTlsProxy(targetPort: number, targetHost = '127.0.0.1'): Promise<TlsProxy> {
  return new Promise((resolvePromise, reject) => {
    const server = https.createServer({ cert: TLS_TEST_CERT, key: TLS_TEST_KEY }, (req, res) => {
      const proxyReq = http.request(
        {
          host: targetHost,
          port: targetPort,
          method: req.method,
          path: req.url,
          headers: {
            ...req.headers,
            'x-forwarded-proto': 'https',
            'x-forwarded-for': req.socket.remoteAddress ?? '127.0.0.1',
          },
        },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
          proxyRes.pipe(res);
        },
      );
      proxyReq.on('error', (error) => {
        res.writeHead(502);
        res.end(String(error));
      });
      req.pipe(proxyReq);
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('tls proxy failed to bind a loopback port'));
        return;
      }
      resolvePromise({
        port: address.port,
        close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
      });
    });
  });
}
