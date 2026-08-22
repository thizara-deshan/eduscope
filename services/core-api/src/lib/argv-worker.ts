import { spawn } from 'node:child_process';

export interface ArgvResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export interface ArgvRunOptions {
  cwd?: string;
  signal?: AbortSignal;
  /** Bounds captured stdout/stderr so a runaway process can't grow memory unbounded. */
  maxBufferBytes?: number;
}

/** The seam machine-1b's merge worker (and any future argv tool caller) depends on — real `ArgvWorker` in production, `test/fakes/media-tools.ts` in tests. */
export interface ArgvRunner {
  run(executable: string, args: readonly string[], options?: ArgvRunOptions): Promise<ArgvResult>;
}

const DEFAULT_MAX_BUFFER_BYTES = 64 * 1024;

function appendBounded(buffer: string, chunk: string, maxBytes: number): string {
  const combined = buffer + chunk;
  return combined.length > maxBytes ? combined.slice(combined.length - maxBytes) : combined;
}

/**
 * The only code that spawns ffprobe/ffmpeg. Executable-plus-argv, `shell: false`
 * (binding rule #2 / workstream gate: no shell, no command-string interpolation).
 */
export class ArgvWorker implements ArgvRunner {
  run(executable: string, args: readonly string[], options: ArgvRunOptions = {}): Promise<ArgvResult> {
    const maxBytes = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;

    return new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new Error(`argv worker: ${executable} aborted before start`));
        return;
      }

      const child = spawn(executable, [...args], {
        shell: false,
        ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout = appendBounded(stdout, chunk.toString('utf8'), maxBytes);
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = appendBounded(stderr, chunk.toString('utf8'), maxBytes);
      });

      child.once('error', (error: unknown) => {
        reject(error instanceof Error ? error : new Error(String(error)));
      });
      child.once('close', (code, signal) => {
        resolve({ code, signal, stdout, stderr });
      });
    });
  }
}
