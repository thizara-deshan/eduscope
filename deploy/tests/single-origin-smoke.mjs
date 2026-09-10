import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const { WebSocket, WebSocketServer } = createRequire(join(root, 'services/core-api/package.json'))('ws');
const originIndex = process.argv.indexOf('--origin');
let fixture;

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolveListen, reject) => server.listen(0, '127.0.0.1', resolveListen).once('error', reject));
  const { port } = server.address();
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function startFixture() {
  const prefix = await mkdtemp(join(tmpdir(), 'eduscope-single-origin-'));
  const backendPort = await unusedPort();
  const nginxPort = await unusedPort();
  const marker = 'via-eduscope-nginx';
  const backend = http.createServer((request, response) => {
    if (request.url === '/healthz') {
      response.writeHead(200, { 'content-type': 'application/json', 'x-fixture-marker': marker });
      response.end('{"ok":true}');
      return;
    }
    if (request.url === '/api/v1/recordings/__smoke_range__' && request.headers.range === 'bytes=0-0') {
      response.writeHead(206, { 'content-range': 'bytes 0-0/4', 'content-length': '1', 'x-fixture-marker': marker });
      response.end('x');
      return;
    }
    response.writeHead(404).end();
  });
  const websocket = new WebSocketServer({ noServer: true });
  backend.on('upgrade', (request, socket, head) => {
    if (!['/api/v1/events', '/api/v1/pipeline/events'].includes(request.url)) return socket.destroy();
    websocket.handleUpgrade(request, socket, head, (client) => websocket.emit('connection', client, request));
  });
  websocket.on('connection', (client) => client.send(marker));
  await new Promise((resolveListen, reject) => backend.listen(backendPort, '127.0.0.1', resolveListen).once('error', reject));

  const panel = join(prefix, 'panel');
  const run = join(prefix, 'run');
  const logs = join(prefix, 'logs');
  await Promise.all([mkdir(panel), mkdir(run), mkdir(logs)]);
  await writeFile(join(panel, 'index.html'), '<!doctype html><title>fixture</title>');
  await writeFile(join(run, 'config.json'), '{"fixture":true}');
  let config = await readFile(join(root, 'deploy/nginx/eduscope.conf'), 'utf8');
  config = config
    .replace('listen 127.0.0.1:80 default_server;', `listen 127.0.0.1:${nginxPort} default_server;`)
    .replace('root /opt/eduscope/current/apps/panel/dist;', `root ${panel};`)
    .replace('alias /run/eduscope/config.json;', `alias ${join(run, 'config.json')};`)
    .replaceAll('http://127.0.0.1:5000', `http://127.0.0.1:${backendPort}`);
  await writeFile(join(prefix, 'nginx.conf'), `error_log logs/error.log;\nevents {}\nhttp {\naccess_log logs/access.log;\n${config}\n}\n`);
  const syntax = spawnSync('nginx', ['-t', '-p', prefix, '-c', 'nginx.conf', '-g', `pid ${join(run, 'nginx.pid')};`], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, `temporary nginx syntax failed: ${syntax.stderr}`);
  const nginx = spawn('nginx', ['-p', prefix, '-c', 'nginx.conf', '-g', `pid ${join(run, 'nginx.pid')}; daemon off; error_log stderr;`], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  nginx.stderr.on('data', (chunk) => { stderr += chunk; });
  await Promise.race([
    new Promise((resolveReady, reject) => {
      const attempt = async () => {
        try { await fetch(`http://127.0.0.1:${nginxPort}/healthz`); resolveReady(); }
        catch { if (nginx.exitCode === null) setTimeout(attempt, 20); else reject(new Error(stderr)); }
      };
      attempt();
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`temporary nginx timeout: ${stderr}`)), 5000)),
  ]);
  return {
    marker,
    origin: `http://127.0.0.1:${nginxPort}`,
    async close() {
      nginx.kill('SIGTERM');
      await Promise.allSettled([
        new Promise((resolveExit) => nginx.once('exit', resolveExit)),
        new Promise((resolveClose) => websocket.close(resolveClose)),
        new Promise((resolveClose) => backend.close(resolveClose)),
      ]);
      await rm(prefix, { recursive: true, force: true });
    },
  };
}

try {
  fixture = originIndex === -1 ? await startFixture() : { origin: process.argv[originIndex + 1], marker: null, close: async () => {} };
  const health = await fetch(`${fixture.origin}/healthz`);
  assert.equal(health.status, 200, 'REST health failed');
  if (fixture.marker) assert.equal(health.headers.get('x-fixture-marker'), fixture.marker);
  const range = await fetch(`${fixture.origin}/api/v1/recordings/__smoke_range__`, { headers: { Range: 'bytes=0-0' } });
  assert.equal(range.status, 206, 'Range proxy failed');
  assert.equal(range.headers.get('content-range'), 'bytes 0-0/4');

  for (const path of ['/api/v1/events', '/api/v1/pipeline/events']) {
    const message = await new Promise((resolveMessage, reject) => {
      const ws = new WebSocket(`${fixture.origin.replace(/^http/, 'ws')}${path}`);
      const timer = setTimeout(() => { ws.terminate(); reject(new Error(`WS timeout: ${path}`)); }, 5000);
      ws.once('message', (data) => { clearTimeout(timer); ws.close(); resolveMessage(data.toString()); });
      ws.once('error', reject);
    });
    if (fixture.marker) assert.equal(message, fixture.marker);
  }
  console.log('PASS single-origin REST WS RANGE');
} finally {
  await fixture?.close();
}
