import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { eq } from 'drizzle-orm';
import WebSocket from 'ws';
import { zEventEnvelope, zProblem, type EventEnvelope } from '@eduscope/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  answerProjections,
  exportJobs,
  lectureSessions,
  recordingFiles,
  recordings,
  recordingSegments,
  uploadFileParts,
  uploadJobs,
} from '../../src/db/schema.js';
import { startFixtureStack, type FixtureStack } from './fixture-stack.js';

async function waitFor<T>(read: () => T | undefined | false | Promise<T | undefined | false>, timeoutMs = 8_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined && value !== false) return value;
    await delay(10);
  }
  throw new Error('B-38 smoke wait timed out');
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function login(stack: FixtureStack, username: string, password: string) {
  const response = await fetch(`${stack.baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, client: 'panel' }),
  });
  expect(response.status).toBe(200);
  return response.json() as Promise<{ user: { id: string }; tokens: { accessToken: string; refreshToken: string } }>;
}

async function post(stack: FixtureStack, path: string, token: string, payload?: unknown): Promise<Response> {
  return fetch(`${stack.baseUrl}${path}`, {
    method: 'POST',
    headers: { ...auth(token), ...(payload === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
}

async function openPanel(stack: FixtureStack, token: string): Promise<{ ws: WebSocket; frames: EventEnvelope[] }> {
  const frames: EventEnvelope[] = [];
  const ws = new WebSocket(stack.baseUrl.replace(/^http/, 'ws') + '/api/v1/ws', token);
  ws.on('message', (raw) => frames.push(zEventEnvelope.parse(JSON.parse(raw.toString()))));
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  await waitFor(() => frames.length > 0 ? true : false);
  return { ws, frames };
}

describe('B-38 device workflow smoke', () => {
  let stack: FixtureStack | undefined;

  afterEach(async () => {
    await stack?.close();
    stack = undefined;
  });

  it('runs login → record/adopt → pause/resume/stop → media/export/upload-resume over HTTP/WS', async () => {
    stack = await startFixtureStack();
    const evidence: Record<string, unknown> = {
      startedAt: new Date().toISOString(),
      ownership: { rest: 79, panelEvents: 22, previewVariants: 5, syncHello: 1 },
      httpStatuses: [],
      ws: [],
    };
    const statuses = evidence.httpStatuses as number[];

    const lecturerLogin = await login(stack, 'gate-lecturer', 'GatePassphrase1!');
    const me = await fetch(`${stack.baseUrl}/api/v1/auth/me`, { headers: auth(lecturerLogin.tokens.accessToken) });
    statuses.push(me.status);
    expect(me.status).toBe(200);
    const refresh = await fetch(`${stack.baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: lecturerLogin.tokens.refreshToken }),
    });
    statuses.push(refresh.status);
    expect(refresh.status).toBe(200);
    const refreshed = await refresh.json() as { tokens: { accessToken: string; refreshToken: string } };
    const token = refreshed.tokens.accessToken;

    const panel = await openPanel(stack, token);
    expect(panel.frames.every((frame, index, rows) => index === 0 || frame.seq > rows[index - 1]!.seq)).toBe(true);

    const startRequestedAt = Date.now();
    const started = await post(stack, '/api/v1/recording/start', token);
    statuses.push(started.status);
    expect(started.status).toBe(202);
    const starting = await waitFor(() => panel.frames.find((frame) => frame.event === 'recording.state' && frame.payload.state === 'starting'));
    expect(Date.now()).toBeGreaterThanOrEqual(startRequestedAt);
    await waitFor(() => stack!.pm.calls.find((call) => call.path === '/consumers/record'));
    const firstConsumer = 'record:00000001';
    stack.pm.publish('evt.pm.consumer.running', { consumerId: firstConsumer, pgid: 101 });
    stack.pm.setStatus({ consumers: [{ id: firstConsumer, state: 'running', pgid: 101 }] });
    await waitFor(() => panel.frames.find((frame) => frame.event === 'recording.state' && frame.payload.state === 'recording'));

    const firstStart = stack.pm.calls.find((call) => call.path === '/consumers/record')!;
    const firstPath = (firstStart.body as { outputPath: string }).outputPath;
    mkdirSync(dirname(firstPath), { recursive: true });
    writeFileSync(firstPath, Buffer.alloc(96_000, 1));

    const stopCallsBeforeShutdown = stack.pm.calls.filter((call) => call.path.endsWith('/stop')).length;
    panel.ws.close();
    await stack.stopCore('SIGTERM');
    await expect(fetch(`${stack.baseUrl}/healthz`)).rejects.toThrow();
    expect(stack.pm.calls.filter((call) => call.path.endsWith('/stop'))).toHaveLength(stopCallsBeforeShutdown);

    await stack.restartCore();
    const restartedLogin = await login(stack, 'gate-lecturer', 'GatePassphrase1!');
    const restartToken = restartedLogin.tokens.accessToken;
    const restartedPanel = await openPanel(stack, restartToken);
    const adopted = await waitFor(() => restartedPanel.frames.find((frame) => frame.event === 'recording.state' && frame.payload.state === 'recording'));
    expect((adopted.payload as { sessionId: string | null }).sessionId).toBe((starting.payload as { sessionId: string | null }).sessionId);

    const pause = await post(stack, '/api/v1/recording/pause', restartToken);
    statuses.push(pause.status);
    expect(pause.status).toBe(202);
    await waitFor(() => stack!.pm.calls.find((call) => call.path === `/consumers/${firstConsumer}/stop`));
    stack.pm.publish('evt.pm.consumer.eos', { consumerId: firstConsumer });
    stack.pm.setStatus({ consumers: [] });
    await waitFor(() => restartedPanel.frames.find((frame) => frame.event === 'recording.state' && frame.payload.state === 'paused'));

    const resume = await post(stack, '/api/v1/recording/resume', restartToken);
    statuses.push(resume.status);
    expect(resume.status).toBe(202);
    await waitFor(() => stack!.pm.calls.filter((call) => call.path === '/consumers/record').length === 2 ? true : false);
    const secondStart = stack.pm.calls.filter((call) => call.path === '/consumers/record')[1]!;
    const secondPath = (secondStart.body as { outputPath: string }).outputPath;
    mkdirSync(dirname(secondPath), { recursive: true });
    writeFileSync(secondPath, Buffer.alloc(104_000, 2));
    const secondConsumer = 'record:00000002';
    stack.pm.publish('evt.pm.consumer.running', { consumerId: secondConsumer, pgid: 102 });
    stack.pm.setStatus({ consumers: [{ id: secondConsumer, state: 'running', pgid: 102 }] });
    await waitFor(() => restartedPanel.frames.filter((frame) => frame.event === 'recording.state' && frame.payload.state === 'recording').length >= 2 ? true : false);

    stack.upload.cutOnPatch(2);
    const stop = await post(stack, '/api/v1/recording/stop', restartToken);
    statuses.push(stop.status);
    expect(stop.status).toBe(202);
    await waitFor(() => stack!.pm.calls.find((call) => call.path === `/consumers/${secondConsumer}/stop`));
    stack.pm.publish('evt.pm.consumer.eos', { consumerId: secondConsumer });
    stack.pm.setStatus({ consumers: [] });

    const session = await waitFor(() => stack!.app.db.select().from(lectureSessions).all().find((row) => row.state === 'completed'));
    const recording = await waitFor(() => stack!.app.db.select().from(recordings).where(eq(recordings.sessionId, session.id)).get()?.state === 'ready'
      ? stack!.app.db.select().from(recordings).where(eq(recordings.sessionId, session.id)).get()
      : undefined);
    const segments = stack.app.db.select().from(recordingSegments).where(eq(recordingSegments.recordingId, recording.id)).all();
    expect(segments.map((row) => row.state)).toEqual(['finalized', 'finalized']);

    const files = stack.app.db.select().from(recordingFiles).where(eq(recordingFiles.recordingId, recording.id)).all();
    const playable = files.find((file) => file.kind === 'derived')!;
    const media = await fetch(`${stack.baseUrl}/api/v1/recordings/${recording.id}/files/${playable.id}/media`, {
      headers: { ...auth(restartToken), range: 'bytes=0-3' },
    });
    statuses.push(media.status);
    expect(media.status).toBe(206);
    expect(await media.arrayBuffer()).toHaveProperty('byteLength', 4);

    const adminLogin = await login(stack, 'gate-admin', 'GateAdminPassphrase1!');
    const otherPanel = await openPanel(stack, adminLogin.tokens.accessToken);
    const targets = await fetch(`${stack.baseUrl}/api/v1/exports/targets`, { headers: auth(restartToken) });
    expect(targets.status).toBe(200);
    const exported = await post(stack, '/api/v1/exports', restartToken, {
      recordingIds: [recording.id],
      targetDevicePath: stack.usbTargets[1].devicePath,
    });
    statuses.push(exported.status);
    expect(exported.status).toBe(202);
    const exportJob = await exported.json() as { id: string };
    await waitFor(() => stack!.app.db.select().from(exportJobs).where(eq(exportJobs.id, exportJob.id)).get()?.state === 'completed' ? true : false);
    expect(otherPanel.frames.some((frame) => frame.event === 'export.job')).toBe(false);

    const failedUpload = await waitFor(() => stack!.app.db.select().from(uploadJobs).where(eq(uploadJobs.recordingId, recording.id)).get()?.state === 'failed'
      ? stack!.app.db.select().from(uploadJobs).where(eq(uploadJobs.recordingId, recording.id)).get()
      : undefined);
    const checkpoint = stack.app.db.select().from(uploadFileParts).where(eq(uploadFileParts.uploadJobId, failedUpload.id)).get()!;
    expect(Number(checkpoint.bytesSent)).toBeGreaterThan(0);
    stack.app.db.update(uploadJobs).set({ nextAttemptAt: new Date(Date.now() - 1_000).toISOString() }).where(eq(uploadJobs.id, failedUpload.id)).run();

    restartedPanel.ws.close();
    otherPanel.ws.close();
    await stack.stopCore('SIGTERM');
    await stack.restartCore();
    await waitFor(() => stack!.app.db.select().from(uploadJobs).where(eq(uploadJobs.id, failedUpload.id)).get()?.state === 'done' ? true : false);
    const finalPart = stack.app.db.select().from(uploadFileParts).where(eq(uploadFileParts.uploadJobId, failedUpload.id)).get()!;
    const remoteLecture = stack.upload.lectures.get(failedUpload.remoteLectureId!)!;
    expect(remoteLecture.parts.get(finalPart.recordingFileId)).toHaveLength(Number(finalPart.bytesTotal));
    expect(stack.app.db.select().from(uploadJobs).where(eq(uploadJobs.recordingId, recording.id)).all()).toHaveLength(1);
    expect(stack.app.db.select().from(answerProjections).all()).toHaveLength(0);

    const finalLogin = await login(stack, 'gate-lecturer', 'GatePassphrase1!');
    const logout = await post(stack, '/api/v1/auth/logout', finalLogin.tokens.accessToken);
    statuses.push(logout.status);
    expect(logout.status).toBe(204);
    const revoked = await fetch(`${stack.baseUrl}/api/v1/auth/me`, { headers: auth(finalLogin.tokens.accessToken) });
    expect(revoked.status).toBe(401);
    expect(zProblem.safeParse(await revoked.json()).success).toBe(true);

    evidence.ws = restartedPanel.frames.map(({ event, seq, at }) => ({ event, seq, at }));
    evidence.sessionId = session.id;
    evidence.recordingId = recording.id;
    evidence.segments = segments.map((row) => ({ id: row.id, index: row.index, state: row.state }));
    evidence.media = { status: media.status, contentRange: media.headers.get('content-range') };
    evidence.export = { id: exportJob.id, target: stack.usbTargets[1].devicePath };
    evidence.upload = { id: failedUpload.id, checkpoint: Number(checkpoint.bytesSent), finalBytes: Number(finalPart.bytesSent) };
    evidence.finishedAt = new Date().toISOString();
    evidence.verdict = 'PASS';
    const evidencePath = join(stack.dir, 'b38-evidence.json');
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    expect(statSync(evidencePath).size).toBeGreaterThan(0);
  }, 30_000);
});
