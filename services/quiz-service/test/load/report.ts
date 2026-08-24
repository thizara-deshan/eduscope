import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface TimingSummary {
  count: number;
  p50: number;
  p95: number;
  max: number;
}

/** Nearest-rank percentile over a copy of `values`; `values` is left untouched. */
export function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[Math.max(0, index)]!;
}

export function summarizeTimings(values: readonly number[]): TimingSummary {
  return {
    count: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: values.length === 0 ? 0 : Math.max(...values),
  };
}

/** Collects named latency samples across the load run's phases. */
export class TimingCollector {
  readonly #samples = new Map<string, number[]>();

  record(phase: string, milliseconds: number): void {
    const bucket = this.#samples.get(phase);
    if (bucket) bucket.push(milliseconds);
    else this.#samples.set(phase, [milliseconds]);
  }

  summary(): Record<string, TimingSummary> {
    const result: Record<string, TimingSummary> = {};
    for (const [phase, values] of this.#samples) {
      result[phase] = summarizeTimings(values);
    }
    return result;
  }
}

/** Writes evidence JSON atomically-enough for a local/staging run; creates parent directories. */
export async function writeEvidence(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}
