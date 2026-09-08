#!/usr/bin/env node
// Real-adapter e2e only: fronts the built Next.js server with a real HTTPS
// listener so the quiz app and the real quiz-service test peer (always
// HTTPS-only, see services/quiz-service/test/helpers/tls-proxy.ts) are
// schemeful-same-site. Without this, the SameSite=Lax participant cookie
// (contracts/quiz-app.yaml) is stored fine but never sent back on any
// subsequent cross-site fetch/WebSocket — the app would silently never
// re-authenticate a returning participant. Mock/default e2e runs never
// invoke this script and are unaffected (see playwright.config.ts).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer as createHttpsServer } from 'node:https';
import { request as httpRequest } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const certDir = path.join(here, '../../../services/quiz-service/test/fixtures/tls');
const cert = readFileSync(path.join(certDir, 'localhost-cert.pem'));
const key = readFileSync(path.join(certDir, 'localhost-key.pem'));

export const HTTP_PORT = Number(process.env.EDUSCOPE_QUIZ_HTTP_PORT ?? 3010);
export const HTTPS_PORT = Number(process.env.EDUSCOPE_QUIZ_HTTPS_PORT ?? 3443);

function waitForHttp(url, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolvePromise, reject) => {
    const attempt = () => {
      const req = httpRequest(url, (res) => {
        res.resume();
        resolvePromise();
      });
      req.on('error', () => {
        if (Date.now() > deadline) {
          reject(new Error(`https-frontend: timed out waiting for ${url}`));
          return;
        }
        setTimeout(attempt, 300);
      });
      req.end();
    };
    attempt();
  });
}

async function main() {
  const next = spawn('pnpm', ['exec', 'next', 'start', '-p', String(HTTP_PORT)], {
    stdio: 'inherit',
    cwd: path.join(here, '..'),
  });
  next.on('exit', (code) => {
    if (code !== 0 && code !== null) process.exit(code);
  });

  await waitForHttp(`http://127.0.0.1:${String(HTTP_PORT)}/j/ABC123`);

  const proxy = createHttpsServer({ cert, key }, (req, res) => {
    const proxyReq = httpRequest(
      { host: '127.0.0.1', port: HTTP_PORT, method: req.method, path: req.url, headers: req.headers },
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

  await new Promise((resolvePromise, reject) => {
    proxy.once('error', reject);
    proxy.listen(HTTPS_PORT, '127.0.0.1', () => {
      process.stdout.write(`https-frontend: ready on https://127.0.0.1:${String(HTTPS_PORT)}\n`);
      resolvePromise();
    });
  });

  const shutdown = () => {
    proxy.close();
    next.kill();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
