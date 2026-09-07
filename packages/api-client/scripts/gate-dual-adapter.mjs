#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const root = new URL('../../../', import.meta.url);
const cwd = decodeURIComponent(root.pathname);
const coreCwd = `${cwd}/services/core-api`;
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const useProcessGroups = process.platform !== 'win32';

function signalTree(child, signal) {
  if (child.pid === undefined) return false;
  if (useProcessGroups) {
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
  return child.kill(signal);
}

function treeIsAlive(child) {
  if (child.pid === undefined) return false;
  if (!useProcessGroups) return child.exitCode === null && child.signalCode === null;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

async function waitForTreeExit(child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (treeIsAlive(child) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !treeIsAlive(child);
}

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...(options.env ?? {}) },
      shell: false,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} failed (${String(code ?? signal)})`));
    });
  });
}

export function startStack(options = {}) {
  const child = spawn(
    process.execPath,
    [
      '--import', 'tsx',
      '../../packages/api-client/test/real/fixtures/real-stack.ts',
    ],
    {
      cwd: coreCwd,
      detached: useProcessGroups,
      env: { ...process.env, ...(options.env ?? {}) },
      shell: false,
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );
  const signalHandlers = new Map();
  const removeSignalHandlers = () => {
    for (const [event, handler] of signalHandlers) process.off(event, handler);
    signalHandlers.clear();
  };
  for (const event of ['SIGINT', 'SIGTERM']) {
    const handler = () => child.kill(event);
    signalHandlers.set(event, handler);
    process.once(event, handler);
  }
  child.once('exit', removeSignalHandlers);
  const ready = new Promise((resolve, reject) => {
    const lines = createInterface({ input: child.stdout });
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('real stack did not become ready'));
    }, 150_000);
    child.once('error', reject);
    child.once('exit', (code, signal) => reject(new Error(`real stack exited before ready (${String(code ?? signal)})`)));
    lines.on('line', (line) => {
      let message;
      try { message = JSON.parse(line); } catch { process.stdout.write(`${line}\n`); return; }
      if (message?.type === 'error') {
        clearTimeout(timeout);
        reject(new Error(`real stack: ${String(message.message)}`));
      } else if (message?.type === 'ready') {
        clearTimeout(timeout);
        lines.close();
        child.stdout.resume();
        resolve({ child, descriptor: message.descriptor });
      }
    });
  });
  return ready;
}

export async function stopStack(child) {
  if (!treeIsAlive(child)) return;
  child.kill('SIGTERM');
  if (await waitForTreeExit(child, 15_000)) return;
  signalTree(child, 'SIGKILL');
  if (!await waitForTreeExit(child, 5_000)) {
    throw new Error('real stack process tree did not exit after SIGKILL');
  }
}

async function main() {
  await run(pnpm, [
    '--filter', '@eduscope/api-client', 'test', '--',
    'test/mock', 'test/scenario', 'test/student-quiz-v0-6.test.ts',
  ]);

  const stack = await startStack();
  let failure;
  try {
    await run(pnpm, [
      '--filter', '@eduscope/api-client', 'test', '--',
      'test/real/contract-honesty.test.ts', 'test/real/parity.test.ts',
    ], {
      env: {
        EDUSCOPE_REAL_STACK_DESCRIPTOR: JSON.stringify(stack.descriptor),
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
      },
    });
  } catch (error) {
    failure = error;
  } finally {
    await stopStack(stack.child);
  }
  if (failure) throw failure;
  process.stdout.write('PASS gate:dual (mock + real adapters; teardown complete)\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
