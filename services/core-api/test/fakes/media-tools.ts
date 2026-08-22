import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ArgvResult, ArgvRunner, ArgvRunOptions } from '../../src/lib/argv-worker.js';

export interface RecordedArgvCall {
  executable: string;
  args: string[];
}

type FfmpegOutcome = 'fail' | 'hang';

/**
 * A controllable stand-in for the real ffprobe/ffmpeg binaries B-13's merge
 * worker shells out to. Never spawns a process — it simulates ffprobe's JSON
 * output from real on-disk file sizes plus test-configured durations, and
 * simulates ffmpeg by writing a real (dummy-content) file to the requested
 * output path so a later `ffprobe` call against that output resolves
 * consistently. Understands exactly the two argv shapes merge-worker.ts
 * emits: `ffmpeg -y -f concat -safe 0 -i <manifest> -c copy <out>` and
 * `ffmpeg -y -i <in> -c copy <out>` — output is always the last argument.
 */
export class FakeMediaTools implements ArgvRunner {
  readonly calls: RecordedArgvCall[] = [];

  readonly #durationMsByPath = new Map<string, number>();
  readonly #ffmpegOutcomeByOutput = new Map<string, FfmpegOutcome>();

  /** Overrides the simulated duration ffprobe reports for `path` (default: file size in bytes, treated as milliseconds — deterministic and non-zero for any non-empty fixture). */
  setDurationMs(path: string, ms: number): void {
    this.#durationMsByPath.set(path, ms);
  }

  /** The next `ffmpeg` call whose output is `outputPath` returns a non-zero exit code and writes nothing. */
  failFfmpegFor(outputPath: string): void {
    this.#ffmpegOutcomeByOutput.set(outputPath, 'fail');
  }

  /** The next `ffmpeg` call whose output is `outputPath` never resolves on its own — it only settles (as a killed process) once its `AbortSignal` fires, for watchdog tests. */
  hangFfmpegFor(outputPath: string): void {
    this.#ffmpegOutcomeByOutput.set(outputPath, 'hang');
  }

  clearFfmpegOutcome(outputPath: string): void {
    this.#ffmpegOutcomeByOutput.delete(outputPath);
  }

  async run(executable: string, args: readonly string[], options: ArgvRunOptions = {}): Promise<ArgvResult> {
    this.calls.push({ executable, args: [...args] });
    if (executable === 'ffprobe') return this.#ffprobe(args);
    if (executable === 'ffmpeg') return this.#ffmpeg(args, options);
    throw new Error(`FakeMediaTools: unexpected executable "${executable}"`);
  }

  #ffprobe(args: readonly string[]): ArgvResult {
    const path = args[args.length - 1]!;
    let size: number;
    try {
      size = statSync(path).size;
    } catch {
      return { code: 1, signal: null, stdout: '', stderr: `ffprobe: No such file or directory: ${path}` };
    }
    if (size === 0) {
      return { code: 1, signal: null, stdout: '', stderr: `ffprobe: Invalid data found when processing input: ${path}` };
    }
    const durationMs = this.#durationMsByPath.get(path) ?? size;
    const stdout = JSON.stringify({
      format: { duration: (durationMs / 1000).toString(), size: String(size) },
      streams: [{ codec_type: 'video' }],
    });
    return { code: 0, signal: null, stdout, stderr: '' };
  }

  async #ffmpeg(args: readonly string[], options: ArgvRunOptions): Promise<ArgvResult> {
    const output = args[args.length - 1]!;
    const outcome = this.#ffmpegOutcomeByOutput.get(output);

    if (outcome === 'fail') {
      this.#ffmpegOutcomeByOutput.delete(output);
      return { code: 1, signal: null, stdout: '', stderr: `ffmpeg: simulated failure for ${output}` };
    }

    if (outcome === 'hang') {
      return new Promise<ArgvResult>((resolve) => {
        options.signal?.addEventListener(
          'abort',
          () => {
            this.#ffmpegOutcomeByOutput.delete(output);
            resolve({ code: null, signal: 'SIGKILL', stdout: '', stderr: 'ffmpeg: killed (simulated hang)' });
          },
          { once: true },
        );
      });
    }

    const inputs = this.#resolveInputs(args);
    let totalDurationMs = 0;
    let totalBytes = 0;
    for (const input of inputs) {
      totalDurationMs += this.#durationMsByPath.get(input) ?? statSync(input).size;
      totalBytes += statSync(input).size;
    }

    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, Buffer.alloc(Math.max(totalBytes, 1)));
    this.#durationMsByPath.set(output, totalDurationMs);

    return { code: 0, signal: null, stdout: '', stderr: '' };
  }

  #resolveInputs(args: readonly string[]): string[] {
    const isConcat = args.includes('-f') && args.includes('concat');
    const inputIndex = args.indexOf('-i');
    const inputPath = args[inputIndex + 1]!;
    if (!isConcat) return [inputPath];

    const manifest = readFileSync(inputPath, 'utf8');
    return manifest
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith("file '"))
      .map((line) => line.slice(6, -1).replace(/'\\''/g, "'"));
  }
}
