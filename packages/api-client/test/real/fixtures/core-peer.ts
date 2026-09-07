import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const USE_PROCESS_GROUPS = process.platform !== 'win32';

function signalPeerTree(child: ChildProcess, signal: NodeJS.Signals): boolean {
  if (child.pid === undefined) return false;
  if (USE_PROCESS_GROUPS) {
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }
  return child.kill(signal);
}

function peerTreeIsAlive(child: ChildProcess): boolean {
  if (child.pid === undefined) return false;
  if (!USE_PROCESS_GROUPS) return child.exitCode === null && child.signalCode === null;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

async function waitForPeerTreeExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (peerTreeIsAlive(child) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !peerTreeIsAlive(child);
}

export interface PeerProcess<TReady> {
  readonly ready: TReady;
  close(): Promise<void>;
}

export interface CorePeerReady {
  readonly type: 'ready';
  readonly service: 'core';
  readonly baseUrl: string;
  readonly controlUrl: string;
  readonly fixtureIds: {
    readonly lecturerUsername: string;
    readonly adminUsername: string;
    readonly resetUsername: string;
    readonly disabledUsername: string;
  };
}

interface PeerError {
  readonly type: 'error';
  readonly message: string;
}

function isPeerError(value: unknown): value is PeerError {
  return typeof value === 'object' && value !== null
    && (value as { type?: unknown }).type === 'error'
    && typeof (value as { message?: unknown }).message === 'string';
}

export async function spawnJsonPeer<TReady extends { type: 'ready' }>(
  packageName: string,
  packageDirectory: string,
  entry: string,
  env: Record<string, string>,
): Promise<PeerProcess<TReady>> {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', entry],
    {
      cwd: `${REPOSITORY_ROOT}/${packageDirectory}`,
      detached: USE_PROCESS_GROUPS,
      env: { ...process.env, ...env },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const stderr: string[] = [];
  child.stderr!.setEncoding('utf8');
  const collectStderr = (chunk: string): void => { stderr.push(chunk); };
  child.stderr!.on('data', collectStderr);

  const ready = await new Promise<TReady>((resolve, reject) => {
    const lines = createInterface({ input: child.stdout! });
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${packageName} peer did not become ready; stderr: ${stderr.join('').slice(-2000)}`));
    }, 120_000);
    timeout.unref();

    const fail = (error: Error): void => {
      clearTimeout(timeout);
      lines.close();
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      reject(error);
    };

    child.once('error', fail);
    child.once('exit', (code, signal) => {
      fail(new Error(
        `${packageName} peer exited before ready (${String(code ?? signal)}); stderr: ${stderr.join('').slice(-2000)}`,
      ));
    });
    lines.on('line', (line) => {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        return;
      }
      if (isPeerError(value)) {
        fail(new Error(`${packageName} peer: ${value.message}`));
        return;
      }
      if (typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'ready') {
        clearTimeout(timeout);
        child.removeListener('error', fail);
        lines.close();
        child.stdout!.resume();
        child.stderr!.off('data', collectStderr);
        child.stderr!.resume();
        resolve(value as TReady);
      }
    });
  });

  return {
    ready,
    close: () => stopPeer(child),
  };
}

async function stopPeer(child: ChildProcess): Promise<void> {
  if (!peerTreeIsAlive(child)) return;
  child.kill('SIGTERM');
  if (await waitForPeerTreeExit(child, 10_000)) return;
  signalPeerTree(child, 'SIGKILL');
  if (!await waitForPeerTreeExit(child, 5_000)) {
    throw new Error('real peer process tree did not exit after SIGKILL');
  }
}

export function startCorePeer(env: Record<string, string>): Promise<PeerProcess<CorePeerReady>> {
  return spawnJsonPeer('@eduscope/core-api', 'services/core-api', 'test/peers/e2e-process-entry.ts', env);
}
